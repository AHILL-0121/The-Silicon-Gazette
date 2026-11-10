import { z } from "zod";

import { callGemini, isGeminiConfigured } from "@/lib/gemini";
import { extractNumbers, numbersMatch } from "@/lib/grounding";

import {
    queryAnomalies,
    queryEditionTable,
    queryHeatmap,
    queryMetricCounts,
    queryStoryRanking
} from "./insights";
import { querySources, querySummary, queryTimeseries, queryTop } from "./queries";

// ---------------------------------------------------------------------------
// Gemini-written analytics text, with every figure checked against the data.
//
// Two rules keep it honest, as with the edition fact-check: the model only
// ever sees data this module fetched, and any sentence containing a number
// that is not in that data is deleted before the text reaches the dashboard.
// The "ask" box can only choose among the whitelisted queries below; it never
// writes SQL.
// ---------------------------------------------------------------------------

export class AiUnavailableError extends Error {}

/** A failure whose message is safe and useful to show on the dashboard. */
export class AiRequestError extends Error {}

/** Turns a raw failure into a message for the user: busy model, unusable answer, or unknown. */
export function describeAiFailure(error: unknown): string {
    if (error instanceof AiRequestError) return error.message;
    const message = error instanceof Error ? error.message : String(error);
    if (/Gemini API error: (429|503)/.test(message)) return "Gemini is busy right now. Try again in a minute.";
    if (/Gemini API error: (400|401|403)/.test(message)) return "Gemini rejected the request. Check GEMINI_API_KEY and the model name.";
    if (/aborted|timeout/i.test(message)) return "Gemini took too long to answer. Try again.";
    return "The AI request failed. The server log has the details.";
}

const DAY_MS = 86_400_000;
const START = "2024-01-01";

export function aiConfigured(): boolean {
    return isGeminiConfigured();
}

function assertConfigured() {
    if (!isGeminiConfigured()) throw new AiUnavailableError("GEMINI_API_KEY is not configured.");
}

/** Sentences of `text` whose significant numbers all appear in `facts` (any JSON). */
export function keepSupportedSentences(text: string, facts: unknown): { text: string; dropped: number } {
    const known = extractNumbers(JSON.stringify(facts));
    const supported = (sentence: string) =>
        extractNumbers(sentence)
            .filter((n) => n.significant)
            .every((n) => known.some((f) => numbersMatch({ ...n, percent: false }, { ...f, percent: false })));
    const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/).filter(Boolean);
    const kept = sentences.filter(supported);
    return { text: kept.join(" "), dropped: sentences.length - kept.length };
}

function pctChange(current: number, previous: number): number | null {
    // Percentages on tiny samples are noise: the dashboard greys them out too.
    if (previous < 20 && current < 20) return null;
    return previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
}

/**
 * The dashboard can use a different (less busy) Gemini model than edition
 * generation: set GEMINI_ANALYTICS_MODEL. Unset, it uses GEMINI_MODEL.
 */
const ANALYTICS_MODEL = process.env.GEMINI_ANALYTICS_MODEL || undefined;

const SYSTEM = `You write short, factual summaries of website analytics for the site's owner.
Use ONLY the numbers present in the JSON you are given. Never calculate new numbers, never guess causes,
never give advice or predictions. If a value is null or missing, do not mention it. Plain text, no markdown.`;

// ---------------------------------------------------------------------------
// Weekly narrative
// ---------------------------------------------------------------------------
export interface NarrativeResult {
    text: string;
    droppedSentences: number;
    facts: unknown;
}

export async function weeklyNarrative(from: string, to: string): Promise<NarrativeResult> {
    assertConfigured();
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
    const prevTo = new Date(Date.parse(`${from}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
    const prevFrom = new Date(Date.parse(`${from}T00:00:00Z`) - days * DAY_MS).toISOString().slice(0, 10);

    const [cur, prev, editions, stories, countries, devices, sources, anomalies, series] = await Promise.all([
        querySummary(from, to),
        querySummary(prevFrom, prevTo),
        queryEditionTable(from, to),
        queryTop(from, to, "stories", 3),
        queryTop(from, to, "countries", 3),
        queryTop(from, to, "devices", 3),
        querySources(from, to),
        queryAnomalies(from, to),
        queryTimeseries(from, to, "day")
    ]);

    const best = [...series].sort((a, b) => b.views - a.views)[0];
    const facts = {
        period: { from, to, days },
        views: { current: cur.views, previous: prev.views, changePercent: pctChange(cur.views, prev.views) },
        visitorDays: { current: cur.visitors, previous: prev.visitors, changePercent: pctChange(cur.visitors, prev.visitors) },
        sessions: { current: cur.sessions, previous: prev.sessions },
        completionRatePercent: cur.completionRate,
        shares: cur.shares,
        repoClicks: cur.repoClicks,
        busiestDay: best && best.views > 0 ? { day: best.t.slice(0, 10), views: best.views } : null,
        topEditions: [...editions].sort((a, b) => b.views - a.views).slice(0, 3).map((e) => ({ date: e.date, views: e.views, completions: e.completions })),
        topStories: stories.map((s) => ({ slug: s.label, views: s.views })),
        topCountries: countries.map((c) => ({ country: c.label, views: c.views })),
        devices: devices.map((d) => ({ device: d.label, views: d.views })),
        topSources: sources.platforms.slice(0, 3).map((p) => ({ platform: p.platform, sessions: p.sessions })),
        unusualDays: anomalies.filter((d) => d.flag).map((d) => ({ day: d.day, views: d.views, usualViews: d.expected, direction: d.flag }))
    };

    const raw = await callGemini(
        `Write a 4 to 6 sentence summary of how the site did in this period, comparing with the previous period only where changePercent is given.\n\nJSON:\n${JSON.stringify(facts)}`,
        { system: SYSTEM, json: false, maxTokens: 4096, model: ANALYTICS_MODEL }
    );
    const checked = keepSupportedSentences(raw, facts);
    return { text: checked.text, droppedSentences: checked.dropped, facts };
}

// ---------------------------------------------------------------------------
// Ask box: the model picks one whitelisted query; the server runs it.
// ---------------------------------------------------------------------------
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Models fill unused params with null, "", or a near-miss value. Rather than
 * fail the whole question, drop anything that is not a valid value for its key.
 */
export function cleanPlan(raw: unknown): unknown {
    if (!raw || typeof raw !== "object") return raw;
    const plan = raw as Record<string, unknown>;
    const params = plan.params && typeof plan.params === "object" ? (plan.params as Record<string, unknown>) : {};
    const clean: Record<string, unknown> = {};
    for (const key of ["from", "to"] as const) {
        if (typeof params[key] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params[key] as string)) clean[key] = params[key];
    }
    if (typeof params.country === "string" && /^[a-zA-Z]{2}$/.test(params.country)) clean.country = params.country.toUpperCase();
    if (typeof params.device === "string" && ["mobile", "tablet", "desktop"].includes(params.device.toLowerCase())) clean.device = params.device.toLowerCase();
    if (typeof params.tz === "string" && ["UTC", "IST"].includes(params.tz.toUpperCase())) clean.tz = params.tz.toUpperCase();
    return { query: plan.query, params: clean, title: typeof plan.title === "string" && plan.title.trim() ? plan.title.trim().slice(0, 140) : "Result" };
}

const planSchema = z.object({
    query: z.enum(["story_ranking", "traffic_by_day", "top_sources", "top_countries", "edition_table", "busiest_hours", "summary"]),
    params: z
        .object({
            from: day.optional(),
            to: day.optional(),
            country: z.string().length(2).optional(),
            device: z.enum(["mobile", "tablet", "desktop"]).optional(),
            tz: z.enum(["UTC", "IST"]).optional()
        })
        .default({}),
    title: z.string().max(140).default("Result")
});

export type AskPlan = z.infer<typeof planSchema>;

const CATALOG = `Available queries (choose exactly one):
- story_ranking: stories ranked by finished reads. params: from, to, country (ISO 2-letter, optional), device (mobile|tablet|desktop, optional)
- traffic_by_day: page views and visitors per day. params: from, to
- top_sources: where visitors came from. params: from, to
- top_countries: views by country. params: from, to
- edition_table: views, finished reads and shares per edition. params: from, to
- busiest_hours: weekday x hour heatmap of views. params: from, to, tz (UTC or IST)
- summary: headline totals. params: from, to`;

function clampRange(from: string | undefined, to: string | undefined, today: string): { from: string; to: string } {
    let f = from && from >= START && from <= today ? from : new Date(Date.parse(`${today}T00:00:00Z`) - 6 * DAY_MS).toISOString().slice(0, 10);
    let t = to && to >= START && to <= today ? to : today;
    if (f > t) [f, t] = [t, f];
    return { from: f, to: t };
}

async function execute(plan: AskPlan, today: string): Promise<unknown> {
    const { from, to } = clampRange(plan.params.from, plan.params.to, today);
    switch (plan.query) {
        case "story_ranking":
            return { from, to, rows: await queryStoryRanking(from, to, { country: plan.params.country, device: plan.params.device }, 10) };
        case "traffic_by_day":
            return { from, to, rows: (await queryTimeseries(from, to, "day")).map((p) => ({ day: p.t.slice(0, 10), views: p.views, visitors: p.visitors })) };
        case "top_sources":
            return { from, to, rows: (await querySources(from, to)).platforms.slice(0, 10) };
        case "top_countries":
            return { from, to, rows: await queryTop(from, to, "countries", 10) };
        case "edition_table":
            return { from, to, rows: (await queryEditionTable(from, to)).slice(0, 15) };
        case "busiest_hours": {
            const heat = await queryHeatmap(from, to, plan.params.tz ?? "UTC");
            const cells = heat.cells.flatMap((hours, dow) => hours.map((views, hour) => ({ weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][dow], hour, views })));
            return { from, to, rows: cells.filter((c) => c.views > 0).sort((a, b) => b.views - a.views).slice(0, 8) };
        }
        case "summary":
            return { from, to, summary: await querySummary(from, to), counts: await queryMetricCounts(from, to) };
    }
}

export interface AskResult {
    title: string;
    query: AskPlan["query"];
    data: unknown;
    answer: string;
    /** True when Gemini could not write the sentence (e.g. busy); the data is still valid. */
    answerUnavailable?: boolean;
}

export async function askAnalytics(question: string): Promise<AskResult> {
    assertConfigured();
    const today = new Date().toISOString().slice(0, 10);

    const planRaw = await callGemini(
        `Today is ${today} (UTC). Pick the one query that best answers the question and fill its params.\n${CATALOG}\n\nRespond with JSON only: {"query": string, "params": object, "title": string}. Use ISO dates (YYYY-MM-DD). "Last week" means the 7 days ending yesterday. Convert country names to ISO 2-letter codes.\n\nQuestion: ${question.slice(0, 300)}`,
        { system: "You translate analytics questions into one structured query. You never write SQL.", maxTokens: 2048, model: ANALYTICS_MODEL }
    );
    let parsed: unknown;
    try {
        parsed = JSON.parse(planRaw.replace(/```json|```/g, "").trim());
    } catch {
        throw new AiRequestError("Gemini did not return a usable query. Try rephrasing the question.");
    }
    const planned = planSchema.safeParse(cleanPlan(parsed));
    if (!planned.success) {
        throw new AiRequestError("That question does not match anything this box can look up. Try asking about stories, traffic by day, sources, countries, editions, busiest hours or totals.");
    }
    const plan = planned.data;
    const data = await execute(plan, today);

    // The data is already in hand, so a busy model at this step must not lose it.
    try {
        const answerRaw = await callGemini(
            `Question: ${question.slice(0, 300)}\n\nData (JSON):\n${JSON.stringify(data).slice(0, 6000)}\n\nAnswer in at most 2 sentences using only numbers from the data. If the data is empty, say there is no data for that period.`,
            { system: SYSTEM, json: false, maxTokens: 2048, model: ANALYTICS_MODEL }
        );
        return { title: plan.title, query: plan.query, data, answer: keepSupportedSentences(answerRaw, data).text };
    } catch {
        return { title: plan.title, query: plan.query, data, answer: "", answerUnavailable: true };
    }
}
