import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";

import { isMissingTable } from "./counters";
import { pearson } from "./insights";

// ---------------------------------------------------------------------------
// Pipeline analytics: what the edition pipeline costs and how clean its output
// is. Reads api_usage and fact_checks (written by lib/usage.ts) joined with
// the editions table and reader events. Every query returns null when its
// table has not been created yet, so the panels can show setup instructions.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const rows = async (query: SQL): Promise<Row[]> => (await db.execute(query)).rows as Row[];
const num = (value: unknown) => Number(value ?? 0);

async function guarded<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
        return await fn();
    } catch (error) {
        if (isMissingTable(error)) return null;
        throw error;
    }
}

// ---------------------------------------------------------------------------
// API usage
// ---------------------------------------------------------------------------
export interface UsageResult {
    byModel: {
        provider: string;
        model: string;
        kind: string;
        calls: number;
        failures: number;
        promptTokens: number;
        completionTokens: number;
        credits: number;
        avgLatencyMs: number | null;
    }[];
    daily: { day: string; tokens: number; credits: number; calls: number }[];
    /** Tavily credits used this UTC month against the plan's monthly allowance. */
    tavily: { monthCredits: number; monthlyLimit: number; usedPct: number };
    /** Tokens used today across providers (UTC). */
    todayTokens: number;
    since: string | null;
}

export async function queryUsage(from: string, to: string): Promise<UsageResult | null> {
    return guarded(async () => {
        const range = sql`ts >= ((${from}::date)::timestamp AT TIME ZONE 'UTC')
      AND ts < (((${to}::date) + 1)::timestamp AT TIME ZONE 'UTC')`;
        const [byModel, daily, month, today, first] = await Promise.all([
            rows(sql`
        SELECT provider, model, kind,
               COUNT(*)::int AS calls,
               (COUNT(*) FILTER (WHERE NOT ok))::int AS failures,
               COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
               COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
               COALESCE(SUM(credits), 0)::int AS credits,
               AVG(latency_ms) AS avg_latency
        FROM api_usage WHERE ${range}
        GROUP BY provider, model, kind ORDER BY calls DESC`),
            rows(sql`
        SELECT ((ts AT TIME ZONE 'UTC')::date)::text AS day,
               COALESCE(SUM(COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0)), 0)::bigint AS tokens,
               COALESCE(SUM(credits), 0)::int AS credits,
               COUNT(*)::int AS calls
        FROM api_usage WHERE ${range} GROUP BY 1 ORDER BY 1`),
            rows(sql`
        SELECT COALESCE(SUM(credits), 0)::int AS credits FROM api_usage
        WHERE provider = 'tavily' AND ts >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`),
            rows(sql`
        SELECT COALESCE(SUM(COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0)), 0)::bigint AS tokens
        FROM api_usage WHERE ts >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`),
            rows(sql`SELECT MIN(ts)::date::text AS since FROM api_usage`)
        ]);
        const monthlyLimit = Number(process.env.TAVILY_MONTHLY_CREDITS) || 1000;
        const monthCredits = num(month[0]?.credits);
        return {
            byModel: byModel.map((row) => ({
                provider: String(row.provider),
                model: String(row.model),
                kind: String(row.kind),
                calls: num(row.calls),
                failures: num(row.failures),
                promptTokens: num(row.prompt_tokens),
                completionTokens: num(row.completion_tokens),
                credits: num(row.credits),
                avgLatencyMs: row.avg_latency === null || row.avg_latency === undefined ? null : Math.round(num(row.avg_latency))
            })),
            daily: daily.map((row) => ({ day: String(row.day), tokens: num(row.tokens), credits: num(row.credits), calls: num(row.calls) })),
            tavily: { monthCredits, monthlyLimit, usedPct: Math.round((monthCredits / monthlyLimit) * 1000) / 10 },
            todayTokens: num(today[0]?.tokens),
            since: (first[0]?.since as string | null | undefined) ?? null
        };
    });
}

// ---------------------------------------------------------------------------
// Fact-check history
// ---------------------------------------------------------------------------
export interface FactCheckRow {
    date: string;
    model: string;
    storiesIn: number;
    storiesOut: number;
    droppedStories: number;
    trimmedSentences: number;
    headlinesReplaced: number;
    fallbackSummaries: number;
    droppedRepos: number;
    repoFixes: number;
    sourceRelabeled: number;
    marketBriefReplaced: boolean;
    dropped: { headline: string; reason: string }[];
}

export interface FactChecksResult {
    rows: FactCheckRow[];
    totals: { editions: number; droppedStories: number; trimmedSentences: number; headlinesReplaced: number; cleanEditions: number };
}

export async function queryFactChecks(limit = 60): Promise<FactChecksResult | null> {
    return guarded(async () => {
        const result = await rows(sql`
      SELECT date::text AS date, model, stories_in, stories_out, dropped_stories, trimmed_sentences,
             headlines_replaced, fallback_summaries, dropped_repos, repo_fixes, source_relabeled,
             market_brief_replaced, dropped
      FROM fact_checks ORDER BY date DESC LIMIT ${limit}`);
        const list: FactCheckRow[] = result.map((row) => ({
            date: String(row.date),
            model: String(row.model),
            storiesIn: num(row.stories_in),
            storiesOut: num(row.stories_out),
            droppedStories: num(row.dropped_stories),
            trimmedSentences: num(row.trimmed_sentences),
            headlinesReplaced: num(row.headlines_replaced),
            fallbackSummaries: num(row.fallback_summaries),
            droppedRepos: num(row.dropped_repos),
            repoFixes: num(row.repo_fixes),
            sourceRelabeled: num(row.source_relabeled),
            marketBriefReplaced: Boolean(row.market_brief_replaced),
            dropped: Array.isArray(row.dropped) ? (row.dropped as { headline: string; reason: string }[]) : []
        }));
        const sum = (pick: (r: FactCheckRow) => number) => list.reduce((total, r) => total + pick(r), 0);
        return {
            rows: list,
            totals: {
                editions: list.length,
                droppedStories: sum((r) => r.droppedStories),
                trimmedSentences: sum((r) => r.trimmedSentences),
                headlinesReplaced: sum((r) => r.headlinesReplaced),
                cleanEditions: list.filter((r) => r.droppedStories + r.trimmedSentences + r.headlinesReplaced + r.droppedRepos === 0).length
            }
        };
    });
}

// ---------------------------------------------------------------------------
// Source reliability: of the stories the model wrote from each site, how many
// survived the fact check. Hosts the model never used are not listed.
// ---------------------------------------------------------------------------
export interface ReliabilityRow {
    host: string;
    kept: number;
    dropped: number;
    editions: number;
    /** kept / (kept + dropped), 0-100. */
    keptPct: number;
}

export async function queryReliability(): Promise<ReliabilityRow[] | null> {
    return guarded(async () => {
        const result = await rows(sql`
      SELECT s->>'host' AS host,
             SUM((s->>'kept')::int)::int AS kept,
             SUM((s->>'dropped')::int)::int AS dropped,
             COUNT(DISTINCT fc.date)::int AS editions
      FROM fact_checks fc, jsonb_array_elements(fc.sources) s
      WHERE s->>'host' <> ''
      GROUP BY 1
      ORDER BY (SUM((s->>'kept')::int) + SUM((s->>'dropped')::int)) DESC, 1
      LIMIT 40`);
        return result.map((row) => {
            const kept = num(row.kept);
            const dropped = num(row.dropped);
            return {
                host: String(row.host),
                kept,
                dropped,
                editions: num(row.editions),
                keptPct: kept + dropped > 0 ? Math.round((kept * 100) / (kept + dropped)) : 0
            };
        });
    });
}

// ---------------------------------------------------------------------------
// Quality vs engagement: do editions the fact check had to fix get read less?
// ---------------------------------------------------------------------------
export interface QualityEngagementRow {
    date: string;
    /** Dropped stories + trimmed sentences + replaced headlines + dropped repos. */
    fixes: number;
    droppedStories: number;
    views48h: number;
    completions48h: number;
}

export interface QualityEngagementResult {
    editions: QualityEngagementRow[];
    correlations: { trait: string; r: number | null }[];
    /** Average first-48h views of editions needing no fixes vs those that did. */
    cleanAvgViews: number | null;
    fixedAvgViews: number | null;
}

export async function queryQualityEngagement(limit = 60): Promise<QualityEngagementResult | null> {
    return guarded(async () => {
        const result = await rows(sql`
      SELECT fc.date::text AS date,
             (fc.dropped_stories + fc.trimmed_sentences + fc.headlines_replaced + fc.dropped_repos) AS fixes,
             fc.dropped_stories,
             COALESCE(v.views, 0) AS views,
             COALESCE(v.completions, 0) AS completions
      FROM fact_checks fc
      LEFT JOIN editions ed ON ed.date = fc.date
      LEFT JOIN (
        SELECT e.edition_date,
               (COUNT(*) FILTER (WHERE e.name = 'pageview'))::int AS views,
               (COUNT(*) FILTER (WHERE e.name = 'read_complete'))::int AS completions
        FROM events e JOIN editions x ON x.date = e.edition_date
        WHERE e.ts >= x.generated_at AND e.ts < x.generated_at + INTERVAL '48 hours'
        GROUP BY 1
      ) v ON v.edition_date = fc.date
      ORDER BY fc.date DESC LIMIT ${limit}`);
        const editions: QualityEngagementRow[] = result.map((row) => ({
            date: String(row.date),
            fixes: num(row.fixes),
            droppedStories: num(row.dropped_stories),
            views48h: num(row.views),
            completions48h: num(row.completions)
        }));
        // The latest two editions have had little time to collect views.
        const settled = editions.slice(2);
        const views = settled.map((e) => e.views48h);
        const avg = (list: QualityEngagementRow[]) => (list.length > 0 ? Math.round(list.reduce((t, e) => t + e.views48h, 0) / list.length) : null);
        return {
            editions,
            correlations: [
                { trait: "Fixes the fact check made", r: pearson(settled.map((e) => e.fixes), views) },
                { trait: "Stories dropped", r: pearson(settled.map((e) => e.droppedStories), views) }
            ],
            cleanAvgViews: avg(settled.filter((e) => e.fixes === 0)),
            fixedAvgViews: avg(settled.filter((e) => e.fixes > 0))
        };
    });
}
