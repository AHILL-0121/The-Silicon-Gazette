import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";

import { merged, rawStartQuery, tsInDays, type RollupTable } from "./daily";

// ---------------------------------------------------------------------------
// Ranges are whole UTC days, both ends inclusive. Days older than the raw
// window that have been rolled up are read from the rollup tables; every
// other day (the last 24–48 h, or days the rollup hasn't reached) is
// aggregated from raw events with the same SQL the rollup uses. Visitor and
// session counts are distinct per UTC day and summed across days.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

async function rows(query: SQL): Promise<Row[]> {
    const result = await db.execute(query);
    return result.rows as Row[];
}

function num(value: unknown): number {
    return Number(value ?? 0);
}

/** One table's rows for [from, to], ready for `FROM (...) m`. */
async function sourceFor(from: string, to: string) {
    const [first] = await rows(rawStartQuery(from, to));
    const rawFrom = (first?.raw_from as string | null) ?? null;
    return (table: RollupTable) => merged(table, from, to, rawFrom);
}

// ---------------------------------------------------------------------------
// Summary (headline KPIs)
// ---------------------------------------------------------------------------
export interface SummaryResult {
    views: number;
    visitors: number;
    sessions: number;
    shares: number;
    repoClicks: number;
    avgReadDepth: number;
    completionRate: number;
}

export async function querySummary(fromUtc: string, toUtc: string): Promise<SummaryResult> {
    const source = await sourceFor(fromUtc, toUtc);
    const [[s], [e]] = await Promise.all([
        rows(sql`
      SELECT COALESCE(SUM(views), 0) AS views,
             COALESCE(SUM(visitors), 0) AS visitors,
             COALESCE(SUM(sessions), 0) AS sessions,
             COALESCE(SUM(complete_sessions), 0) AS complete_sessions,
             COALESCE(SUM(story_sessions), 0) AS story_sessions
      FROM (${source("daily_session_stats")}) m`),
        rows(sql`
      SELECT COALESCE(SUM(count) FILTER (WHERE name = 'share'), 0) AS shares,
             COALESCE(SUM(count) FILTER (WHERE name = 'repo_click'), 0) AS repo_clicks,
             COALESCE(SUM(CASE WHEN name = 'read_depth' THEN key::int * count END), 0) AS depth_sum,
             COALESCE(SUM(count) FILTER (WHERE name = 'read_depth'), 0) AS depth_n
      FROM (${source("daily_event_stats")}) m`)
    ]);

    const storySessions = num(s?.story_sessions);
    const depthN = num(e?.depth_n);
    return {
        views: num(s?.views),
        visitors: num(s?.visitors),
        sessions: num(s?.sessions),
        shares: num(e?.shares),
        repoClicks: num(e?.repo_clicks),
        avgReadDepth: depthN > 0 ? Math.round(num(e?.depth_sum) / depthN) : 0,
        completionRate: storySessions > 0 ? Math.round((num(s?.complete_sessions) * 100) / storySessions) : 0
    };
}

// ---------------------------------------------------------------------------
// Timeseries (zero-filled)
// ---------------------------------------------------------------------------
export interface TimeseriesPoint {
    /** ISO 8601 UTC start of the bucket. */
    t: string;
    views: number;
    visitors: number;
}

export async function queryTimeseries(
    fromUtc: string,
    toUtc: string,
    granularity: "hour" | "day" | "week"
): Promise<TimeseriesPoint[]> {
    let result: Row[];

    if (granularity === "hour") {
        // Hourly buckets always come from raw events. Visitors are distinct per hour.
        result = await rows(sql`
      SELECT to_char(g.t, 'YYYY-MM-DD"T"HH24:00:00"Z"') AS t,
             COALESCE(v.views, 0) AS views,
             COALESCE(v.visitors, 0) AS visitors
      FROM generate_series(
        (${fromUtc}::date)::timestamp,
        LEAST(((${toUtc}::date) + 1)::timestamp - INTERVAL '1 hour', date_trunc('hour', now() AT TIME ZONE 'UTC')),
        INTERVAL '1 hour'
      ) AS g(t)
      LEFT JOIN (
        SELECT date_trunc('hour', ts AT TIME ZONE 'UTC') AS t,
               COUNT(*)::int AS views,
               COUNT(DISTINCT visitor_hash)::int AS visitors
        FROM events
        WHERE ${tsInDays(fromUtc, toUtc)} AND name = 'pageview'
        GROUP BY 1
      ) v ON v.t = g.t
      ORDER BY g.t`);
    } else {
        const source = await sourceFor(fromUtc, toUtc);
        const bucket = granularity === "week" ? sql`date_trunc('week', day)::date` : sql`day`;
        result = await rows(sql`
      SELECT to_char(${bucket}, 'YYYY-MM-DD"T"00:00:00"Z"') AS t,
             SUM(views)::int AS views,
             SUM(visitors)::int AS visitors
      FROM (${source("daily_session_stats")}) m
      GROUP BY 1
      ORDER BY 1`);
    }

    return result.map((row) => ({ t: String(row.t), views: num(row.views), visitors: num(row.visitors) }));
}

// ---------------------------------------------------------------------------
// Top lists
// ---------------------------------------------------------------------------
export interface TopRow {
    label: string;
    views: number;
    visitors: number;
    extra?: Record<string, unknown>;
}

export type TopKind = "editions" | "stories" | "paths" | "referrers" | "countries" | "devices";

const DIM_FOR: Partial<Record<TopKind, string>> = {
    referrers: "referrer",
    countries: "country",
    devices: "device"
};

export async function queryTop(
    fromUtc: string,
    toUtc: string,
    kind: TopKind,
    limit = 10
): Promise<TopRow[]> {
    const limitN = Math.min(Math.max(1, limit), 50);
    const source = await sourceFor(fromUtc, toUtc);
    const toTop = (row: Row): TopRow => ({ label: String(row.label ?? ""), views: num(row.views), visitors: num(row.visitors) });

    const dim = DIM_FOR[kind];
    if (dim) {
        const result = await rows(sql`
      SELECT value AS label, SUM(views)::int AS views, SUM(visitors)::int AS visitors
      FROM (${source("daily_dim_stats")}) m
      WHERE dim = ${dim}
      GROUP BY 1 ORDER BY views DESC, label LIMIT ${limitN}`);
        return result.map(toTop);
    }

    if (kind === "editions") {
        const result = await rows(sql`
      SELECT edition_date::text AS label, SUM(views)::int AS views, SUM(visitors)::int AS visitors
      FROM (${source("daily_page_stats")}) m
      WHERE edition_date IS NOT NULL AND page_type IN ('edition', 'story')
      GROUP BY 1 HAVING SUM(views) > 0
      ORDER BY views DESC, label DESC LIMIT ${limitN}`);
        return result.map(toTop);
    }

    if (kind === "stories") {
        const result = await rows(sql`
      SELECT story_slug AS label,
             MAX(edition_date)::text AS edition_date,
             SUM(views)::int AS views,
             SUM(visitors)::int AS visitors,
             SUM(completions)::int AS completions,
             SUM(shares)::int AS shares
      FROM (${source("daily_page_stats")}) m
      WHERE story_slug IS NOT NULL AND page_type = 'story'
      GROUP BY 1 HAVING SUM(views) > 0
      ORDER BY views DESC, label LIMIT ${limitN}`);
        return result.map((row) => {
            const top = toTop(row);
            const completions = num(row.completions);
            return {
                ...top,
                extra: {
                    editionDate: row.edition_date ?? null,
                    completionPct: top.views > 0 ? Math.round((completions / top.views) * 100) : 0,
                    shares: num(row.shares)
                }
            };
        });
    }

    // paths
    const result = await rows(sql`
    SELECT path AS label, SUM(views)::int AS views, SUM(visitors)::int AS visitors
    FROM (${source("daily_page_stats")}) m
    GROUP BY 1 HAVING SUM(views) > 0
    ORDER BY views DESC, label LIMIT ${limitN}`);
    return result.map(toTop);
}

// ---------------------------------------------------------------------------
// Events (counts, funnel, search, operations)
// ---------------------------------------------------------------------------
export interface EventCountRow {
    name: string;
    count: number;
    visitors: number;
}

export interface FunnelStep {
    label: string;
    sessions: number;
}

export interface SearchStats {
    paletteOpens: number;
    paletteSearches: number;
    paletteChose: number;
    archiveSearches: number;
    archiveZeroResults: number;
}

export interface OperationsStats {
    generateRequests: { status: string; count: number }[];
    notFoundViews: number;
    notFoundPaths: { path: string; views: number }[];
}

export interface EventsResult {
    counts: EventCountRow[];
    funnel: FunnelStep[];
    search: SearchStats;
    operations: OperationsStats;
}

export async function queryEvents(fromUtc: string, toUtc: string): Promise<EventsResult> {
    const source = await sourceFor(fromUtc, toUtc);

    const [countRows, funnelRows, keyRows, notFoundRows, notFoundTotal] = await Promise.all([
        rows(sql`
      SELECT name, SUM(count)::int AS count, SUM(visitors)::int AS visitors
      FROM (${source("daily_event_stats")}) m
      WHERE name <> 'link_preview'
      GROUP BY name ORDER BY count DESC, name`),
        rows(sql`
      SELECT COALESCE(SUM(sessions), 0) AS step1,
             COALESCE(SUM(open_sessions), 0) AS step2,
             COALESCE(SUM(deep_sessions), 0) AS step3,
             COALESCE(SUM(share_sessions), 0) AS step4
      FROM (${source("daily_session_stats")}) m`),
        rows(sql`
      SELECT name, key, SUM(count)::int AS count
      FROM (${source("daily_event_stats")}) m
      WHERE name IN ('palette_open', 'palette_search', 'archive_search', 'generate_request')
      GROUP BY name, key`),
        rows(sql`
      SELECT path, SUM(views)::int AS views
      FROM (${source("daily_page_stats")}) m
      WHERE page_type = '404'
      GROUP BY path HAVING SUM(views) > 0
      ORDER BY views DESC, path LIMIT 5`),
        rows(sql`
      SELECT COALESCE(SUM(views), 0) AS views
      FROM (${source("daily_page_stats")}) m
      WHERE page_type = '404'`)
    ]);

    const sumKeys = (name: string, key?: string) =>
        keyRows
            .filter((row) => row.name === name && (key === undefined || row.key === key))
            .reduce((total, row) => total + num(row.count), 0);

    const f = funnelRows[0] ?? {};

    return {
        counts: countRows.map((row) => ({ name: String(row.name ?? ""), count: num(row.count), visitors: num(row.visitors) })),
        funnel: [
            { label: "Page views", sessions: num(f.step1) },
            { label: "Opened story", sessions: num(f.step2) },
            { label: "Read 75%+", sessions: num(f.step3) },
            { label: "Shared", sessions: num(f.step4) }
        ],
        search: {
            paletteOpens: sumKeys("palette_open"),
            paletteSearches: sumKeys("palette_search"),
            paletteChose: sumKeys("palette_search", "true"),
            archiveSearches: sumKeys("archive_search"),
            archiveZeroResults: sumKeys("archive_search", "zero")
        },
        operations: {
            generateRequests: keyRows
                .filter((row) => row.name === "generate_request")
                .map((row) => ({ status: String(row.key || "unknown"), count: num(row.count) }))
                .sort((a, b) => b.count - a.count),
            notFoundViews: num(notFoundTotal[0]?.views),
            notFoundPaths: notFoundRows.map((row) => ({ path: String(row.path ?? ""), views: num(row.views) }))
        }
    };
}

// ---------------------------------------------------------------------------
// Sources (sessions by where they came from; see lib/analytics/sources)
// ---------------------------------------------------------------------------
export interface SourceRow {
    channel: string;
    platform: string;
    sessions: number;
    visitors: number;
    views: number;
    storySessions: number;
    completeSessions: number;
    shareSessions: number;
}

export interface CampaignRow {
    campaign: string;
    platform: string;
    medium: string;
    sessions: number;
    storySessions: number;
    completeSessions: number;
}

export interface SourcesResult {
    totalSessions: number;
    channels: { channel: string; sessions: number; visitors: number }[];
    platforms: SourceRow[];
    campaigns: CampaignRow[];
    /** Share-menu clicks by target and where the menu was (story, edition, footer). */
    shares: { method: string; placement: string; count: number }[];
    /** Link-preview fetches by platform: where links were pasted. */
    previews: { platform: string; count: number }[];
}

export async function querySources(fromUtc: string, toUtc: string): Promise<SourcesResult> {
    const source = await sourceFor(fromUtc, toUtc);

    const [channelRows, platformRows, campaignRows, eventRows] = await Promise.all([
        rows(sql`
      SELECT channel, SUM(sessions)::int AS sessions, SUM(visitors)::int AS visitors
      FROM (${source("daily_source_stats")}) m
      GROUP BY channel ORDER BY sessions DESC, channel`),
        rows(sql`
      SELECT channel, platform,
             SUM(sessions)::int AS sessions, SUM(visitors)::int AS visitors, SUM(views)::int AS views,
             SUM(story_sessions)::int AS story_sessions, SUM(complete_sessions)::int AS complete_sessions,
             SUM(share_sessions)::int AS share_sessions
      FROM (${source("daily_source_stats")}) m
      GROUP BY channel, platform ORDER BY sessions DESC, platform LIMIT 30`),
        rows(sql`
      SELECT campaign, platform, medium,
             SUM(sessions)::int AS sessions, SUM(story_sessions)::int AS story_sessions,
             SUM(complete_sessions)::int AS complete_sessions
      FROM (${source("daily_source_stats")}) m
      WHERE campaign <> ''
      GROUP BY campaign, platform, medium ORDER BY sessions DESC, campaign LIMIT 20`),
        rows(sql`
      SELECT name, key, SUM(count)::int AS count
      FROM (${source("daily_event_stats")}) m
      WHERE name IN ('share', 'link_preview')
      GROUP BY name, key ORDER BY count DESC, key`)
    ]);

    const channels = channelRows.map((row) => ({
        channel: String(row.channel ?? ""),
        sessions: num(row.sessions),
        visitors: num(row.visitors)
    }));

    return {
        totalSessions: channels.reduce((total, c) => total + c.sessions, 0),
        channels,
        platforms: platformRows.map((row) => ({
            channel: String(row.channel ?? ""),
            platform: String(row.platform ?? ""),
            sessions: num(row.sessions),
            visitors: num(row.visitors),
            views: num(row.views),
            storySessions: num(row.story_sessions),
            completeSessions: num(row.complete_sessions),
            shareSessions: num(row.share_sessions)
        })),
        campaigns: campaignRows.map((row) => ({
            campaign: String(row.campaign ?? ""),
            platform: String(row.platform ?? ""),
            medium: String(row.medium ?? ""),
            sessions: num(row.sessions),
            storySessions: num(row.story_sessions),
            completeSessions: num(row.complete_sessions)
        })),
        shares: eventRows
            .filter((row) => row.name === "share")
            .map((row) => {
                // Keys are "method|placement"; shares from before the menu have no placement.
                const [method, placement = ""] = String(row.key ?? "").split("|");
                return { method: method === "clipboard" ? "copy" : method || "unknown", placement, count: num(row.count) };
            }),
        previews: eventRows
            .filter((row) => row.name === "link_preview")
            .map((row) => ({ platform: String(row.key || "unknown"), count: num(row.count) }))
    };
}

// ---------------------------------------------------------------------------
// Live (last 30 min, raw)
// ---------------------------------------------------------------------------
export interface LiveResult {
    activeSessions: number;
    topPaths: { path: string; sessions: number }[];
}

export async function queryLive(): Promise<LiveResult> {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const [totalRows, pathRows] = await Promise.all([
        rows(sql`
      SELECT COUNT(DISTINCT session_id) AS sessions
      FROM events
      WHERE ts >= ${cutoff}::timestamptz AND name NOT IN ('generate_request', 'link_preview')`),
        rows(sql`
      SELECT path, COUNT(DISTINCT session_id) AS sessions
      FROM events
      WHERE ts >= ${cutoff}::timestamptz AND name = 'pageview'
      GROUP BY path ORDER BY sessions DESC LIMIT 10`)
    ]);

    return {
        activeSessions: num(totalRows[0]?.sessions),
        topPaths: pathRows.map((row) => ({ path: String(row.path ?? ""), sessions: num(row.sessions) }))
    };
}

// ---------------------------------------------------------------------------
// CSV exports
// ---------------------------------------------------------------------------

/** Raw events in [from, to], oldest first. */
export async function exportEvents(fromUtc: string, toUtc: string): Promise<Row[]> {
    return rows(sql`
    SELECT ts, name, path, page_type, edition_date, story_slug,
           visitor_hash, session_id, referrer_host, utm_source, utm_medium, utm_campaign,
           in_app, source_channel, source_platform, country, device, viewport_w, props
    FROM events
    WHERE ${tsInDays(fromUtc, toUtc)}
    ORDER BY ts, id`);
}

/** Per-day, per-path page stats in [from, to], rolled-up and raw days merged. */
export async function exportDaily(fromUtc: string, toUtc: string): Promise<Row[]> {
    const source = await sourceFor(fromUtc, toUtc);
    return rows(sql`
    SELECT day::text AS day, path, page_type, views, visitors, sessions, completions, shares
    FROM (${source("daily_page_stats")}) m
    ORDER BY day, path`);
}

/** Per-day sessions by source in [from, to], rolled-up and raw days merged. */
export async function exportSources(fromUtc: string, toUtc: string): Promise<Row[]> {
    const source = await sourceFor(fromUtc, toUtc);
    return rows(sql`
    SELECT day::text AS day, channel, platform, medium, campaign, sessions, visitors, views,
           story_sessions, complete_sessions, share_sessions
    FROM (${source("daily_source_stats")}) m
    ORDER BY day, sessions DESC, platform`);
}
