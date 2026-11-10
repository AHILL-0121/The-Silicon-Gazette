import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";

import { tsInDays } from "./daily";
import { andFilter, type Filters } from "./filters";

// ---------------------------------------------------------------------------
// Read-only insight queries behind /api/analytics/insights.
//
// All of them read raw events (kept forever) and the editions table, so they
// need no new tables. Days are UTC days, both ends inclusive, like the rest of
// the dashboard. Only visitor_hash (re-salted daily) identifies anyone.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

async function rows(query: SQL): Promise<Row[]> {
    return (await db.execute(query)).rows as Row[];
}

const num = (value: unknown) => Number(value ?? 0);
const iso = (value: unknown) => new Date(value as string | Date).toISOString();

export type Tz = "UTC" | "IST";
const tzName = (tz: Tz) => (tz === "IST" ? "Asia/Kolkata" : "UTC");

// ---------------------------------------------------------------------------
// Heatmap: pageviews by weekday x hour, in the chosen display zone.
// ---------------------------------------------------------------------------
export interface HeatmapResult {
    /** cells[weekday 0=Mon..6=Sun][hour 0..23] */
    cells: number[][];
    total: number;
    max: number;
}

export async function queryHeatmap(from: string, to: string, tz: Tz, filters?: Filters): Promise<HeatmapResult> {
    const zone = tzName(tz);
    const result = await rows(sql`
    SELECT (EXTRACT(ISODOW FROM (ts AT TIME ZONE ${zone}))::int - 1) AS dow,
           EXTRACT(HOUR FROM (ts AT TIME ZONE ${zone}))::int AS hour,
           COUNT(*)::int AS views
    FROM events
    WHERE ${tsInDays(from, to)} AND name = 'pageview' ${andFilter(filters)}
    GROUP BY 1, 2`);
    const cells = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    let total = 0;
    let max = 0;
    for (const row of result) {
        const dow = num(row.dow);
        const hour = num(row.hour);
        const views = num(row.views);
        cells[dow][hour] = views;
        total += views;
        max = Math.max(max, views);
    }
    return { cells, total, max };
}

// ---------------------------------------------------------------------------
// Editions: engagement per edition, joined with how it was produced.
// ---------------------------------------------------------------------------
export interface EditionRow {
    date: string;
    views: number;
    visitors: number;
    completions: number;
    shares: number;
    avgSeconds: number | null;
    generatedAt: string | null;
    model: string | null;
    stories: number | null;
}

export async function queryEditionTable(from: string, to: string, filters?: Filters): Promise<EditionRow[]> {
    const result = await rows(sql`
    SELECT p.edition_date::text AS date,
           p.views, p.visitors, p.completions, p.shares, p.avg_seconds,
           ed.generated_at, ed.model,
           jsonb_array_length(ed.content->'stories') AS stories
    FROM (
      SELECT edition_date,
             (COUNT(*) FILTER (WHERE name = 'pageview'))::int AS views,
             (COUNT(DISTINCT visitor_hash) FILTER (WHERE name = 'pageview'))::int AS visitors,
             (COUNT(*) FILTER (WHERE name = 'read_complete'))::int AS completions,
             (COUNT(*) FILTER (WHERE name = 'share'))::int AS shares,
             AVG((props->>'seconds')::numeric) FILTER (WHERE name = 'page_exit') AS avg_seconds
      FROM events
      WHERE ${tsInDays(from, to)} AND edition_date IS NOT NULL ${andFilter(filters)}
      GROUP BY edition_date
    ) p
    LEFT JOIN editions ed ON ed.date = p.edition_date
    WHERE p.views > 0
    ORDER BY p.edition_date DESC
    LIMIT 90`);
    return result.map((row) => ({
        date: String(row.date),
        views: num(row.views),
        visitors: num(row.visitors),
        completions: num(row.completions),
        shares: num(row.shares),
        avgSeconds: row.avg_seconds === null || row.avg_seconds === undefined ? null : Math.round(num(row.avg_seconds)),
        generatedAt: row.generated_at ? iso(row.generated_at) : null,
        model: row.model ? String(row.model) : null,
        stories: row.stories === null || row.stories === undefined ? null : num(row.stories)
    }));
}

// ---------------------------------------------------------------------------
// Publish-to-peak: views by hours since the edition was generated.
// ---------------------------------------------------------------------------
export interface PeakResult {
    /** views[h] = pageviews of editions in range, h hours after their generation (0..71). */
    hours: number[];
    editions: number;
    total: number;
    peakHour: number | null;
    shareFirst24h: number;
    shareFirst48h: number;
}

export async function queryPeakCurve(from: string, to: string, filters?: Filters): Promise<PeakResult> {
    const [curve, count] = await Promise.all([
        rows(sql`
      SELECT FLOOR(EXTRACT(EPOCH FROM (e.ts - ed.generated_at)) / 3600)::int AS h, COUNT(*)::int AS views
      FROM events e
      JOIN editions ed ON ed.date = e.edition_date
      WHERE e.name = 'pageview'
        AND ed.date BETWEEN ${from}::date AND ${to}::date
        AND e.ts >= ed.generated_at
        AND e.ts < ed.generated_at + INTERVAL '72 hours' ${andFilter(filters)}
      GROUP BY 1`),
        rows(sql`SELECT COUNT(*)::int AS n FROM editions WHERE date BETWEEN ${from}::date AND ${to}::date`)
    ]);
    const hours = Array<number>(72).fill(0);
    for (const row of curve) hours[Math.min(71, Math.max(0, num(row.h)))] += num(row.views);
    const total = hours.reduce((a, b) => a + b, 0);
    const peak = total > 0 ? hours.indexOf(Math.max(...hours)) : null;
    const within = (n: number) => (total > 0 ? Math.round((hours.slice(0, n).reduce((a, b) => a + b, 0) * 100) / total) : 0);
    return { hours, editions: num(count[0]?.n), total, peakHour: peak, shareFirst24h: within(24), shareFirst48h: within(48) };
}

// ---------------------------------------------------------------------------
// Story drill-down
// ---------------------------------------------------------------------------
export interface StoryDetail {
    slug: string;
    views: number;
    visitors: number;
    completions: number;
    avgSeconds: number | null;
    /** Sessions that reached each scroll depth. */
    depth: { depth: number; sessions: number }[];
    shares: { method: string; count: number }[];
    sources: { platform: string; sessions: number }[];
    countries: { country: string; views: number }[];
    daily: { day: string; views: number }[];
}

export async function queryStory(from: string, to: string, slug: string, filters?: Filters): Promise<StoryDetail> {
    const where = sql`${tsInDays(from, to)} AND story_slug = ${slug} ${andFilter(filters)}`;
    const [[totals], depth, shares, sources, countries, daily] = await Promise.all([
        rows(sql`
      SELECT (COUNT(*) FILTER (WHERE name = 'pageview'))::int AS views,
             (COUNT(DISTINCT visitor_hash) FILTER (WHERE name = 'pageview'))::int AS visitors,
             (COUNT(*) FILTER (WHERE name = 'read_complete'))::int AS completions,
             AVG((props->>'seconds')::numeric) FILTER (WHERE name = 'page_exit') AS avg_seconds
      FROM events WHERE ${where}`),
        rows(sql`
      SELECT (props->>'depth')::int AS depth, COUNT(DISTINCT session_id)::int AS sessions
      FROM events WHERE ${where} AND name = 'read_depth'
      GROUP BY 1 ORDER BY 1`),
        rows(sql`
      SELECT COALESCE(props->>'method', 'unknown') AS method, COUNT(*)::int AS count
      FROM events WHERE ${where} AND name = 'share' GROUP BY 1 ORDER BY 2 DESC`),
        rows(sql`
      SELECT COALESCE(source_platform, 'Direct') AS platform, COUNT(DISTINCT session_id)::int AS sessions
      FROM events WHERE ${where} AND name = 'pageview' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`),
        rows(sql`
      SELECT COALESCE(country::text, 'Unknown') AS country, COUNT(*)::int AS views
      FROM events WHERE ${where} AND name = 'pageview' GROUP BY 1 ORDER BY 2 DESC LIMIT 6`),
        rows(sql`
      SELECT ((ts AT TIME ZONE 'UTC')::date)::text AS day, COUNT(*)::int AS views
      FROM events WHERE ${where} AND name = 'pageview' GROUP BY 1 ORDER BY 1`)
    ]);
    const byDepth = new Map(depth.map((row) => [num(row.depth), num(row.sessions)]));
    return {
        slug,
        views: num(totals?.views),
        visitors: num(totals?.visitors),
        completions: num(totals?.completions),
        avgSeconds: totals?.avg_seconds === null || totals?.avg_seconds === undefined ? null : Math.round(num(totals.avg_seconds)),
        depth: [25, 50, 75, 100].map((d) => ({ depth: d, sessions: byDepth.get(d) ?? 0 })),
        shares: shares.map((row) => ({ method: String(row.method), count: num(row.count) })),
        sources: sources.map((row) => ({ platform: String(row.platform), sessions: num(row.sessions) })),
        countries: countries.map((row) => ({ country: String(row.country), views: num(row.views) })),
        daily: daily.map((row) => ({ day: String(row.day), views: num(row.views) }))
    };
}

// ---------------------------------------------------------------------------
// Navigation paths: what readers view next.
// ---------------------------------------------------------------------------
export interface NavResult {
    transitions: { from: string; to: string; count: number }[];
    /** Share of views of each page type that ended the session. */
    exits: { type: string; views: number; exitPct: number }[];
}

export async function queryNavPaths(from: string, to: string, filters?: Filters): Promise<NavResult> {
    const [transitions, exits] = await Promise.all([
        rows(sql`
      WITH pv AS (
        SELECT page_type, LEAD(page_type) OVER (PARTITION BY session_id ORDER BY ts) AS next
        FROM events WHERE ${tsInDays(from, to)} AND name = 'pageview' ${andFilter(filters)}
      )
      SELECT page_type AS from_type, COALESCE(next, 'exit') AS to_type, COUNT(*)::int AS count
      FROM pv GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 14`),
        rows(sql`
      WITH pv AS (
        SELECT page_type, LEAD(page_type) OVER (PARTITION BY session_id ORDER BY ts) AS next
        FROM events WHERE ${tsInDays(from, to)} AND name = 'pageview' ${andFilter(filters)}
      )
      SELECT page_type AS type, COUNT(*)::int AS views, (COUNT(*) FILTER (WHERE next IS NULL))::int AS exits
      FROM pv GROUP BY 1 ORDER BY 2 DESC`)
    ]);
    return {
        transitions: transitions.map((row) => ({ from: String(row.from_type), to: String(row.to_type), count: num(row.count) })),
        exits: exits.map((row) => ({
            type: String(row.type),
            views: num(row.views),
            exitPct: num(row.views) > 0 ? Math.round((num(row.exits) * 100) / num(row.views)) : 0
        }))
    };
}

// ---------------------------------------------------------------------------
// 404 trend with suggested redirects.
// ---------------------------------------------------------------------------
export interface NotFoundResult {
    daily: { day: string; views: number }[];
    paths: { path: string; views: number; suggestion: string | null }[];
}

function bigrams(text: string): Set<string> {
    const clean = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const set = new Set<string>();
    for (let i = 0; i < clean.length - 1; i += 1) set.add(clean.slice(i, i + 2));
    return set;
}

/** Dice coefficient over character bigrams: 1 = identical, 0 = nothing shared. */
export function similarity(a: string, b: string): number {
    const ba = bigrams(a);
    const bb = bigrams(b);
    if (ba.size === 0 || bb.size === 0) return 0;
    let shared = 0;
    for (const gram of ba) if (bb.has(gram)) shared += 1;
    return (2 * shared) / (ba.size + bb.size);
}

export async function queryNotFound(from: string, to: string): Promise<NotFoundResult> {
    const [daily, paths, real] = await Promise.all([
        rows(sql`
      SELECT ((ts AT TIME ZONE 'UTC')::date)::text AS day, COUNT(*)::int AS views
      FROM events WHERE ${tsInDays(from, to)} AND name = 'pageview' AND page_type = '404'
      GROUP BY 1 ORDER BY 1`),
        rows(sql`
      SELECT path, COUNT(*)::int AS views
      FROM events WHERE ${tsInDays(from, to)} AND name = 'pageview' AND page_type = '404'
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
        rows(sql`
      SELECT path FROM events
      WHERE name = 'pageview' AND page_type <> '404' AND page_type <> 'other'
      GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 200`)
    ]);
    const known = real.map((row) => String(row.path));
    return {
        daily: daily.map((row) => ({ day: String(row.day), views: num(row.views) })),
        paths: paths.map((row) => {
            const path = String(row.path);
            let best: string | null = null;
            let score = 0;
            for (const candidate of known) {
                const s = similarity(path, candidate);
                if (s > score) {
                    score = s;
                    best = candidate;
                }
            }
            return { path, views: num(row.views), suggestion: score >= 0.5 ? best : null };
        })
    };
}

// ---------------------------------------------------------------------------
// Tracking health.
// ---------------------------------------------------------------------------
export interface QualityResult {
    hourly: { t: string; events: number }[];
    lastEvent: string | null;
    lastPageview: string | null;
    eventsLast24h: number;
    avgEventsPerDay7d: number;
    silentHours24h: number;
}

export async function queryQuality(): Promise<QualityResult> {
    const [hourly, [last], [week]] = await Promise.all([
        rows(sql`
      SELECT to_char(g.t, 'YYYY-MM-DD"T"HH24:00:00"Z"') AS t, COALESCE(v.n, 0) AS events
      FROM generate_series(
        date_trunc('hour', now() AT TIME ZONE 'UTC') - INTERVAL '47 hours',
        date_trunc('hour', now() AT TIME ZONE 'UTC'),
        INTERVAL '1 hour') AS g(t)
      LEFT JOIN (
        SELECT date_trunc('hour', ts AT TIME ZONE 'UTC') AS t, COUNT(*)::int AS n
        FROM events
        WHERE ts > now() - INTERVAL '49 hours' AND name NOT IN ('link_preview', 'generate_request')
        GROUP BY 1
      ) v ON v.t = g.t
      ORDER BY g.t`),
        rows(sql`
      SELECT MAX(ts) AS last_event, MAX(ts) FILTER (WHERE name = 'pageview') AS last_pageview
      FROM events WHERE name NOT IN ('link_preview', 'generate_request')`),
        rows(sql`
      SELECT (COUNT(*) / 7.0)::float AS per_day
      FROM events WHERE ts > now() - INTERVAL '7 days' AND name NOT IN ('link_preview', 'generate_request')`)
    ]);
    const series = hourly.map((row) => ({ t: String(row.t), events: num(row.events) }));
    const last24 = series.slice(-24);
    return {
        hourly: series,
        lastEvent: last?.last_event ? iso(last.last_event) : null,
        lastPageview: last?.last_pageview ? iso(last.last_pageview) : null,
        eventsLast24h: last24.reduce((a, b) => a + b.events, 0),
        avgEventsPerDay7d: Math.round(num(week?.per_day)),
        silentHours24h: last24.filter((h) => h.events === 0).length
    };
}

// ---------------------------------------------------------------------------
// Link previews vs visits from the same platform.
// ---------------------------------------------------------------------------
export interface PreviewResult {
    platforms: { platform: string; previews: number; visits: number }[];
    pages: { path: string; previews: number }[];
}

export async function queryPreviews(from: string, to: string): Promise<PreviewResult> {
    const [previews, visits, pages] = await Promise.all([
        rows(sql`
      SELECT COALESCE(props->>'platform', 'unknown') AS platform, COUNT(*)::int AS n
      FROM events WHERE ${tsInDays(from, to)} AND name = 'link_preview' GROUP BY 1`),
        rows(sql`
      SELECT source_platform AS platform, COUNT(DISTINCT session_id)::int AS n
      FROM events WHERE ${tsInDays(from, to)} AND name = 'pageview' AND source_platform IS NOT NULL
      GROUP BY 1`),
        rows(sql`
      SELECT path, COUNT(*)::int AS n FROM events
      WHERE ${tsInDays(from, to)} AND name = 'link_preview' GROUP BY 1 ORDER BY 2 DESC LIMIT 8`)
    ]);
    const visitMap = new Map(visits.map((row) => [String(row.platform).toLowerCase(), num(row.n)]));
    return {
        platforms: previews
            .map((row) => ({
                platform: String(row.platform),
                previews: num(row.n),
                visits: visitMap.get(String(row.platform).toLowerCase()) ?? 0
            }))
            .sort((a, b) => b.previews - a.previews),
        pages: pages.map((row) => ({ path: String(row.path), previews: num(row.n) }))
    };
}

// ---------------------------------------------------------------------------
// Anomalies: each day against the same weekday in the previous 8 weeks.
// ---------------------------------------------------------------------------
export interface AnomalyDay {
    day: string;
    views: number;
    expected: number;
    ratio: number | null;
    flag: "high" | "low" | null;
}

const DAY_MS = 86_400_000;

export function detectAnomalies(series: Map<string, number>, from: string, to: string): AnomalyDay[] {
    const result: AnomalyDay[] = [];
    for (let ms = Date.parse(`${from}T00:00:00Z`); ms <= Date.parse(`${to}T00:00:00Z`); ms += DAY_MS) {
        const day = new Date(ms).toISOString().slice(0, 10);
        const views = series.get(day) ?? 0;
        const baseline = Array.from({ length: 8 }, (_, k) => series.get(new Date(ms - (k + 1) * 7 * DAY_MS).toISOString().slice(0, 10)) ?? 0);
        const mean = baseline.reduce((a, b) => a + b, 0) / baseline.length;
        const sd = Math.sqrt(baseline.reduce((a, b) => a + (b - mean) ** 2, 0) / baseline.length);
        // Tiny baselines swing wildly by chance, so nothing is flagged below 10 views a day.
        const flag: AnomalyDay["flag"] =
            mean < 10 ? null : views > mean + 2 * sd && views >= mean * 1.5 ? "high" : views < mean - 2 * sd && views <= mean * 0.5 ? "low" : null;
        result.push({ day, views, expected: Math.round(mean), ratio: mean > 0 ? Math.round((views / mean) * 100) / 100 : null, flag });
    }
    return result;
}

export async function queryAnomalies(from: string, to: string, filters?: Filters): Promise<AnomalyDay[]> {
    const start = new Date(Date.parse(`${from}T00:00:00Z`) - 56 * DAY_MS).toISOString().slice(0, 10);
    const result = await rows(sql`
    SELECT ((ts AT TIME ZONE 'UTC')::date)::text AS day, COUNT(*)::int AS views
    FROM events WHERE ${tsInDays(start, to)} AND name = 'pageview' ${andFilter(filters)} GROUP BY 1`);
    return detectAnomalies(new Map(result.map((row) => [String(row.day), num(row.views)])), from, to);
}

// ---------------------------------------------------------------------------
// Edition markers for the chart, and pipeline health.
// ---------------------------------------------------------------------------
export interface Marker {
    t: string;
    label: string;
}

export async function queryMarkers(from: string, to: string): Promise<Marker[]> {
    const [editionMarkers, notes] = await Promise.all([queryEditionMarkers(from, to), queryAnnotationMarkers(from, to)]);
    return [...editionMarkers, ...notes].sort((a, b) => a.t.localeCompare(b.t));
}

/** Your own notes on the chart; empty until the annotations table exists. */
async function queryAnnotationMarkers(from: string, to: string): Promise<Marker[]> {
    try {
        const result = await rows(sql`
      SELECT day::text AS day, label FROM analytics_annotations
      WHERE day >= ${from}::date AND day <= ${to}::date ORDER BY day, id`);
        return result.map((row) => ({ t: `${row.day}T12:00:00.000Z`, label: `Note: ${row.label}` }));
    } catch {
        return [];
    }
}

async function queryEditionMarkers(from: string, to: string): Promise<Marker[]> {
    const result = await rows(sql`
    SELECT date::text AS date, generated_at FROM editions
    WHERE generated_at >= ((${from}::date)::timestamp AT TIME ZONE 'UTC')
      AND generated_at < (((${to}::date) + 1)::timestamp AT TIME ZONE 'UTC')
    ORDER BY generated_at`);
    return result.map((row) => ({ t: iso(row.generated_at), label: `Edition ${row.date} generated` }));
}

export interface PipelineRow {
    date: string;
    model: string;
    latencySeconds: number | null;
    stories: number;
    repos: number;
    linkedStories: number;
    sourceHosts: number;
    generatedAt: string;
    /** Pageviews in the first 48 hours after generation. */
    views48h: number;
    completions48h: number;
}

export interface PipelineResult {
    editions: PipelineRow[];
    /** Pearson correlation of each production trait with first-48h views (null if under 8 editions). */
    correlations: { trait: string; r: number | null }[];
}

export function pearson(xs: number[], ys: number[]): number | null {
    const n = xs.length;
    if (n < 8) return null;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i += 1) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
        syy += (ys[i] - my) ** 2;
    }
    return sxx === 0 || syy === 0 ? null : Math.round((sxy / Math.sqrt(sxx * syy)) * 100) / 100;
}

export async function queryPipeline(limit = 30): Promise<PipelineResult> {
    const result = await rows(sql`
    SELECT ed.date::text AS date, ed.model, ed.latency_ms, ed.generated_at,
           jsonb_array_length(ed.content->'stories') AS stories,
           jsonb_array_length(ed.content->'repos') AS repos,
           (SELECT COUNT(*) FROM jsonb_array_elements(ed.content->'stories') s WHERE s->>'url' IS NOT NULL)::int AS linked,
           (SELECT COUNT(DISTINCT regexp_replace(s->>'url', '^https?://(www\\.)?([^/]+).*$', '\\2'))
              FROM jsonb_array_elements(ed.content->'stories') s WHERE s->>'url' IS NOT NULL)::int AS hosts,
           COALESCE(v.views, 0) AS views,
           COALESCE(v.completions, 0) AS completions
    FROM editions ed
    LEFT JOIN (
      SELECT e.edition_date,
             (COUNT(*) FILTER (WHERE e.name = 'pageview'))::int AS views,
             (COUNT(*) FILTER (WHERE e.name = 'read_complete'))::int AS completions
      FROM events e JOIN editions x ON x.date = e.edition_date
      WHERE e.ts >= x.generated_at AND e.ts < x.generated_at + INTERVAL '48 hours'
      GROUP BY 1
    ) v ON v.edition_date = ed.date
    ORDER BY ed.date DESC LIMIT ${limit}`);
    const editionsOut: PipelineRow[] = result.map((row) => ({
        date: String(row.date),
        model: String(row.model),
        latencySeconds: row.latency_ms === null || row.latency_ms === undefined ? null : Math.round(num(row.latency_ms) / 1000),
        stories: num(row.stories),
        repos: num(row.repos),
        linkedStories: num(row.linked),
        sourceHosts: num(row.hosts),
        generatedAt: iso(row.generated_at),
        views48h: num(row.views),
        completions48h: num(row.completions)
    }));
    // The latest edition has had no time to collect views yet.
    const settled = editionsOut.slice(2);
    const views = settled.map((e) => e.views48h);
    return {
        editions: editionsOut,
        correlations: [
            { trait: "Stories published", r: pearson(settled.map((e) => e.stories), views) },
            { trait: "Stories with a source link", r: pearson(settled.map((e) => e.linkedStories), views) },
            { trait: "Distinct source sites", r: pearson(settled.map((e) => e.sourceHosts), views) },
            { trait: "Generation time", r: pearson(settled.map((e) => e.latencySeconds ?? 0), views) }
        ]
    };
}

// ---------------------------------------------------------------------------
// Base counts for custom metrics.
// ---------------------------------------------------------------------------
import { METRIC_KEYS, type MetricKey } from "./metric-keys";

export { METRIC_KEYS, type MetricKey };

export async function queryMetricCounts(from: string, to: string): Promise<Record<MetricKey, number>> {
    const [row] = await rows(sql`
    SELECT (COUNT(*) FILTER (WHERE name = 'pageview'))::int AS views,
           (COUNT(DISTINCT visitor_hash) FILTER (WHERE name = 'pageview'))::int AS visitors,
           (COUNT(DISTINCT session_id) FILTER (WHERE name = 'pageview'))::int AS sessions,
           (COUNT(*) FILTER (WHERE name = 'read_complete'))::int AS completions,
           (COUNT(*) FILTER (WHERE name = 'share'))::int AS shares,
           (COUNT(*) FILTER (WHERE name = 'repo_click'))::int AS repo_clicks,
           (COUNT(*) FILTER (WHERE name = 'source_click'))::int AS source_clicks,
           (COUNT(*) FILTER (WHERE name = 'story_open'))::int AS story_opens,
           (COUNT(DISTINCT session_id) FILTER (WHERE name = 'read_depth' AND (props->>'depth')::int >= 75))::int AS deep_sessions,
           (COUNT(*) FILTER (WHERE name = 'palette_open'))::int AS palette_opens,
           (COUNT(*) FILTER (WHERE name = 'archive_search'))::int AS archive_searches,
           COALESCE(SUM((props->>'seconds')::int) FILTER (WHERE name = 'page_exit'), 0)::int AS exits_seconds
    FROM events WHERE ${tsInDays(from, to)}`);
    return {
        views: num(row?.views), visitors: num(row?.visitors), sessions: num(row?.sessions),
        completions: num(row?.completions), shares: num(row?.shares), repo_clicks: num(row?.repo_clicks),
        source_clicks: num(row?.source_clicks), story_opens: num(row?.story_opens),
        deep_sessions: num(row?.deep_sessions), palette_opens: num(row?.palette_opens),
        archive_searches: num(row?.archive_searches), exits_seconds: num(row?.exits_seconds)
    };
}

// ---------------------------------------------------------------------------
// Event explorer.
// ---------------------------------------------------------------------------
export interface ExplorerFilters {
    name?: string;
    path?: string;
    country?: string;
    device?: string;
    session?: string;
}

export interface ExplorerRow {
    ts: string;
    name: string;
    path: string;
    visitor: string;
    sessionId: string;
    country: string | null;
    device: string;
    platform: string | null;
    props: Record<string, unknown>;
}

export async function queryExplorer(from: string, to: string, filters: ExplorerFilters, limit: number, offset: number): Promise<{ rows: ExplorerRow[]; hasMore: boolean }> {
    const clauses: SQL[] = [tsInDays(from, to), sql`name NOT IN ('link_preview')`];
    if (filters.name) clauses.push(sql`name = ${filters.name}`);
    if (filters.path) clauses.push(sql`path ILIKE ${`%${filters.path.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
    if (filters.country) clauses.push(sql`country = ${filters.country.toUpperCase()}`);
    if (filters.device) clauses.push(sql`device = ${filters.device}`);
    if (filters.session) clauses.push(sql`session_id = ${filters.session}`);
    const where = clauses.reduce((acc, clause, i) => (i === 0 ? clause : sql`${acc} AND ${clause}`));
    const order = filters.session ? sql`ts ASC` : sql`ts DESC`;
    const result = await rows(sql`
    SELECT ts, name, path, visitor_hash, session_id, country, device, source_platform, props
    FROM events WHERE ${where} ORDER BY ${order} LIMIT ${limit + 1} OFFSET ${offset}`);
    return {
        hasMore: result.length > limit,
        rows: result.slice(0, limit).map((row) => ({
            ts: iso(row.ts),
            name: String(row.name),
            path: String(row.path),
            visitor: String(row.visitor_hash).slice(0, 6),
            sessionId: String(row.session_id),
            country: row.country ? String(row.country) : null,
            device: String(row.device),
            platform: row.source_platform ? String(row.source_platform) : null,
            props: (row.props ?? {}) as Record<string, unknown>
        }))
    };
}

// ---------------------------------------------------------------------------
// Whitelisted queries for the "ask" box (lib/analytics/ai.ts picks one by name).
// ---------------------------------------------------------------------------
export interface StoryRankRow {
    slug: string;
    views: number;
    completions: number;
    shares: number;
}

export async function queryStoryRanking(
    from: string,
    to: string,
    filters: { country?: string; device?: string },
    limit = 10
): Promise<StoryRankRow[]> {
    const clauses: SQL[] = [tsInDays(from, to), sql`story_slug IS NOT NULL`];
    if (filters.country) clauses.push(sql`country = ${filters.country.toUpperCase()}`);
    if (filters.device) clauses.push(sql`device = ${filters.device}`);
    const where = clauses.reduce((acc, clause, i) => (i === 0 ? clause : sql`${acc} AND ${clause}`));
    const result = await rows(sql`
    SELECT story_slug AS slug,
           (COUNT(*) FILTER (WHERE name = 'pageview'))::int AS views,
           (COUNT(*) FILTER (WHERE name = 'read_complete'))::int AS completions,
           (COUNT(*) FILTER (WHERE name = 'share'))::int AS shares
    FROM events WHERE ${where}
    GROUP BY 1 HAVING COUNT(*) FILTER (WHERE name = 'pageview') > 0
    ORDER BY completions DESC, views DESC LIMIT ${Math.min(Math.max(1, limit), 25)}`);
    return result.map((row) => ({ slug: String(row.slug), views: num(row.views), completions: num(row.completions), shares: num(row.shares) }));
}

// ---------------------------------------------------------------------------
// Alerts shown as a banner.
// ---------------------------------------------------------------------------
export interface AlertItem {
    id: string;
    severity: "warning" | "info";
    message: string;
}

export async function queryAlerts(): Promise<AlertItem[]> {
    const alerts: AlertItem[] = [];
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);

    const [[latest], [notFound], [recentViews], anomalies] = await Promise.all([
        rows(sql`SELECT date::text AS date, generated_at FROM editions ORDER BY date DESC LIMIT 1`),
        rows(sql`
      SELECT (COUNT(*) FILTER (WHERE ${tsInDays(today, today)}))::int AS today,
             (COUNT(*) FILTER (WHERE ts >= now() - INTERVAL '8 days' AND ts < ((${today}::date)::timestamp AT TIME ZONE 'UTC')))::int AS prior
      FROM events WHERE name = 'pageview' AND page_type = '404'`),
        rows(sql`
      SELECT (COUNT(*) FILTER (WHERE ts > now() - INTERVAL '24 hours'))::int AS day,
             (COUNT(*) FILTER (WHERE ts > now() - INTERVAL '8 days'))::int AS week
      FROM events WHERE name = 'pageview'`),
        queryAnomalies(yesterday, yesterday)
    ]);

    if (!latest || latest.date !== today) {
        if (now.getUTCHours() >= 12) {
            alerts.push({ id: "edition-late", severity: "warning", message: `Today's edition (${today}) has not been published yet. Latest is ${latest?.date ?? "none"}.` });
        }
    }
    const priorPerDay = num(notFound?.prior) / 7;
    if (num(notFound?.today) >= 10 && num(notFound?.today) >= priorPerDay * 3) {
        alerts.push({ id: "404-spike", severity: "warning", message: `404 pages are spiking: ${num(notFound?.today)} views today against about ${Math.round(priorPerDay)} a day recently.` });
    }
    if (num(recentViews?.week) >= 21 && num(recentViews?.day) === 0) {
        alerts.push({ id: "no-traffic", severity: "warning", message: "No page views in the last 24 hours although the previous week averaged " + Math.round(num(recentViews?.week) / 7) + " a day. Tracking may be down." });
    }
    const flagged = anomalies[0];
    if (flagged?.flag) {
        alerts.push({
            id: `traffic-${flagged.flag}`,
            severity: flagged.flag === "low" ? "warning" : "info",
            message: `Yesterday had ${flagged.views} views, ${flagged.flag === "low" ? "well below" : "well above"} the usual ${flagged.expected} for that weekday.`
        });
    }
    return alerts;
}
