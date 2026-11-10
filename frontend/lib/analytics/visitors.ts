import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";

import { tsInDays } from "./daily";
import { andFilter, type Filters } from "./filters";

// ---------------------------------------------------------------------------
// Visitor summary, read from raw events.
//
// What this can and cannot say: visitor_hash is salted per UTC day (the IP is
// never stored), so one person is a different "visitor" on each day. Rows here
// are therefore visitor-days. City, browser and OS are not collected; only
// country and device class are.
// ---------------------------------------------------------------------------

export interface VisitorRow {
    /** First 6 characters of the daily hash: tells rows apart, identifies nobody. */
    id: string;
    lastSeen: string;
    firstSeen: string;
    country: string | null;
    device: string;
    channel: string;
    platform: string;
    views: number;
    sessions: number;
    /** Deepest scroll depth reported, 0-100, or null if none was reported. */
    maxDepth: number | null;
    completed: boolean;
}

export interface VisitorSummary {
    visitors: number;
    viewsPerVisitor: number;
    /** Share of visitors who viewed exactly one page. */
    singlePagePct: number;
    /** Share of visitors who scrolled to 75% or finished a story. */
    engagedPct: number;
    devices: { device: string; visitors: number }[];
    countries: { country: string; visitors: number }[];
    sources: { platform: string; visitors: number }[];
}

export interface VisitorsResult {
    summary: VisitorSummary;
    rows: VisitorRow[];
    /** True when more visitors exist than `rows` holds. */
    truncated: boolean;
}

type Row = Record<string, unknown>;

const num = (value: unknown) => Number(value ?? 0);

/** One row per visitor_hash with at least one pageview in the range. */
function visitorCte(from: string, to: string, filters?: Filters) {
    return sql`
    WITH v AS (
      SELECT visitor_hash,
             MAX(ts) AS last_seen,
             MIN(ts) AS first_seen,
             (COUNT(*) FILTER (WHERE name = 'pageview'))::int AS views,
             (COUNT(DISTINCT session_id) FILTER (WHERE name = 'pageview'))::int AS sessions,
             (array_agg(country ORDER BY ts) FILTER (WHERE country IS NOT NULL))[1] AS country,
             (array_agg(device ORDER BY ts))[1] AS device,
             (array_agg(source_channel ORDER BY ts) FILTER (WHERE name = 'pageview' AND source_channel IS NOT NULL))[1] AS channel,
             (array_agg(source_platform ORDER BY ts) FILTER (WHERE name = 'pageview' AND source_platform IS NOT NULL))[1] AS platform,
             MAX((props->>'depth')::int) FILTER (WHERE name = 'read_depth') AS max_depth,
             BOOL_OR(name = 'read_complete') AS completed
      FROM events
      WHERE ${tsInDays(from, to)} ${andFilter(filters)}
      GROUP BY visitor_hash
      HAVING COUNT(*) FILTER (WHERE name = 'pageview') > 0
    )`;
}

export async function queryVisitors(from: string, to: string, limit: number, filters?: Filters): Promise<VisitorsResult> {
    const cte = visitorCte(from, to, filters);
    const run = async (query: SQL) => (await db.execute(query)).rows as Row[];

    const [[totals], devices, countries, sources, list] = await Promise.all([
        run(sql`${cte}
      SELECT COUNT(*)::int AS visitors,
             COALESCE(AVG(views), 0)::float AS views_per_visitor,
             (COUNT(*) FILTER (WHERE views = 1))::int AS single_page,
             (COUNT(*) FILTER (WHERE completed OR COALESCE(max_depth, 0) >= 75))::int AS engaged
      FROM v`),
        run(sql`${cte} SELECT device, COUNT(*)::int AS visitors FROM v GROUP BY 1 ORDER BY 2 DESC`),
        run(sql`${cte} SELECT COALESCE(country, '??') AS country, COUNT(*)::int AS visitors FROM v GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5`),
        run(sql`${cte} SELECT COALESCE(platform, 'Direct') AS platform, COUNT(*)::int AS visitors FROM v GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5`),
        run(sql`${cte}
      SELECT visitor_hash, last_seen, first_seen, country, device, channel, platform, views, sessions, max_depth, completed
      FROM v ORDER BY last_seen DESC LIMIT ${limit + 1}`)
    ]);

    const visitors = num(totals?.visitors);
    const pct = (part: number) => (visitors > 0 ? Math.round((part * 100) / visitors) : 0);

    return {
        summary: {
            visitors,
            viewsPerVisitor: Math.round(num(totals?.views_per_visitor) * 10) / 10,
            singlePagePct: pct(num(totals?.single_page)),
            engagedPct: pct(num(totals?.engaged)),
            devices: devices.map((row) => ({ device: String(row.device), visitors: num(row.visitors) })),
            countries: countries.map((row) => ({ country: String(row.country), visitors: num(row.visitors) })),
            sources: sources.map((row) => ({ platform: String(row.platform), visitors: num(row.visitors) }))
        },
        rows: list.slice(0, limit).map((row) => ({
            id: String(row.visitor_hash).slice(0, 6),
            lastSeen: new Date(row.last_seen as string | Date).toISOString(),
            firstSeen: new Date(row.first_seen as string | Date).toISOString(),
            country: row.country ? String(row.country) : null,
            device: String(row.device),
            channel: String(row.channel ?? "direct"),
            platform: String(row.platform ?? "Direct"),
            views: num(row.views),
            sessions: num(row.sessions),
            maxDepth: row.max_depth === null || row.max_depth === undefined ? null : num(row.max_depth),
            completed: Boolean(row.completed)
        })),
        truncated: list.length > limit
    };
}
