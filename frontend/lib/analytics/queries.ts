import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

import { dailyDimStats, dailyEventStats, dailyPageStats, events } from "./schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const TWO_DAYS_MS = 48 * 60 * 60 * 1000;

function useRaw(fromUtc: string, toUtc: string): boolean {
    const now = Date.now();
    const toMs = new Date(toUtc + "T23:59:59Z").getTime();
    return now - toMs < TWO_DAYS_MS;
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
    // Always read from raw events for summaries (simpler, good enough for <3 yr range)
    const rows = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE name = 'pageview') AS views,
      COUNT(DISTINCT visitor_hash) FILTER (WHERE name = 'pageview') AS visitors,
      COUNT(DISTINCT session_id) FILTER (WHERE name = 'pageview') AS sessions,
      COUNT(*) FILTER (WHERE name = 'share') AS shares,
      COUNT(*) FILTER (WHERE name = 'repo_click') AS repo_clicks,
      COALESCE(AVG((props->>'depth')::int) FILTER (WHERE name = 'read_depth'), 0) AS avg_read_depth,
      COALESCE(
        COUNT(DISTINCT session_id) FILTER (WHERE name = 'read_complete') * 100.0 /
        NULLIF(COUNT(DISTINCT session_id) FILTER (WHERE name = 'pageview' AND page_type = 'story'), 0),
        0
      ) AS completion_rate
    FROM events
    WHERE ts >= ${fromUtc}::timestamptz
      AND ts <= ${toUtc}::timestamptz + INTERVAL '1 day'
  `);

    const r = rows.rows[0] as Record<string, string | null>;
    return {
        views: Number(r.views ?? 0),
        visitors: Number(r.visitors ?? 0),
        sessions: Number(r.sessions ?? 0),
        shares: Number(r.shares ?? 0),
        repoClicks: Number(r.repo_clicks ?? 0),
        avgReadDepth: Math.round(Number(r.avg_read_depth ?? 0)),
        completionRate: Math.round(Number(r.completion_rate ?? 0))
    };
}

// ---------------------------------------------------------------------------
// Timeseries
// ---------------------------------------------------------------------------
export interface TimeseriesPoint {
    t: string;
    views: number;
    visitors: number;
}

export async function queryTimeseries(
    fromUtc: string,
    toUtc: string,
    granularity: "hour" | "day" | "week"
): Promise<TimeseriesPoint[]> {
    const trunc = granularity === "hour" ? "hour" : granularity === "week" ? "week" : "day";
    const rows = await db.execute(sql`
    SELECT
      date_trunc(${trunc}, ts AT TIME ZONE 'UTC') AS t,
      COUNT(*) FILTER (WHERE name = 'pageview') AS views,
      COUNT(DISTINCT visitor_hash) FILTER (WHERE name = 'pageview') AS visitors
    FROM events
    WHERE ts >= ${fromUtc}::timestamptz
      AND ts <= ${toUtc}::timestamptz + INTERVAL '1 day'
    GROUP BY 1
    ORDER BY 1
  `);

    return rows.rows.map((r) => {
        const row = r as Record<string, unknown>;
        return { t: String(row.t), views: Number(row.views ?? 0), visitors: Number(row.visitors ?? 0) };
    });
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

export async function queryTop(
    fromUtc: string,
    toUtc: string,
    kind: TopKind,
    limit = 10
): Promise<TopRow[]> {
    const limitN = Math.min(Math.max(1, limit), 50);

    if (kind === "referrers") {
        const rows = await db.execute(sql`
      SELECT referrer_host AS label,
             COUNT(*) AS views,
             COUNT(DISTINCT visitor_hash) AS visitors
      FROM events
      WHERE ts >= ${fromUtc}::timestamptz
        AND ts <= ${toUtc}::timestamptz + INTERVAL '1 day'
        AND name = 'pageview'
        AND referrer_host IS NOT NULL
      GROUP BY 1 ORDER BY views DESC LIMIT ${limitN}
    `);
        return rows.rows.map((r) => {
            const row = r as Record<string, unknown>;
            return { label: String(row.label ?? ""), views: Number(row.views ?? 0), visitors: Number(row.visitors ?? 0) };
        });
    }

    if (kind === "countries") {
        const rows = await db.execute(sql`
      SELECT COALESCE(country, 'Unknown') AS label,
             COUNT(*) AS views,
             COUNT(DISTINCT visitor_hash) AS visitors
      FROM events
      WHERE ts >= ${fromUtc}::timestamptz
        AND ts <= ${toUtc}::timestamptz + INTERVAL '1 day'
        AND name = 'pageview'
      GROUP BY 1 ORDER BY views DESC LIMIT ${limitN}
    `);
        return rows.rows.map((r) => {
            const row = r as Record<string, unknown>;
            return { label: String(row.label ?? ""), views: Number(row.views ?? 0), visitors: Number(row.visitors ?? 0) };
        });
    }

    if (kind === "devices") {
        const rows = await db.execute(sql`
      SELECT device AS label, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
      FROM events
      WHERE ts >= ${fromUtc}::timestamptz
        AND ts <= ${toUtc}::timestamptz + INTERVAL '1 day'
        AND name = 'pageview'
      GROUP BY 1 ORDER BY views DESC
    `);
        return rows.rows.map((r) => {
            const row = r as Record<string, unknown>;
            return { label: String(row.label ?? ""), views: Number(row.views ?? 0), visitors: Number(row.visitors ?? 0) };
        });
    }

    if (kind === "editions") {
        const rows = await db.execute(sql`
      SELECT edition_date AS label, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
      FROM events
      WHERE ts >= ${fromUtc}::timestamptz
        AND ts <= ${toUtc}::timestamptz + INTERVAL '1 day'
        AND name = 'pageview'
        AND edition_date IS NOT NULL
        AND page_type IN ('edition', 'story')
      GROUP BY 1 ORDER BY views DESC LIMIT ${limitN}
    `);
        return rows.rows.map((r) => {
            const row = r as Record<string, unknown>;
            return { label: String(row.label ?? ""), views: Number(row.views ?? 0), visitors: Number(row.visitors ?? 0) };
        });
    }

    if (kind === "stories") {
        const rows = await db.execute(sql`
      SELECT story_slug AS label,
             COUNT(*) FILTER (WHERE name = 'pageview') AS views,
             COUNT(DISTINCT visitor_hash) FILTER (WHERE name = 'pageview') AS visitors,
             COUNT(*) FILTER (WHERE name = 'read_complete') AS completions,
             COUNT(*) FILTER (WHERE name = 'share') AS shares
      FROM events
      WHERE ts >= ${fromUtc}::timestamptz
        AND ts <= ${toUtc}::timestamptz + INTERVAL '1 day'
        AND story_slug IS NOT NULL
      GROUP BY 1 ORDER BY views DESC LIMIT ${limitN}
    `);
        return rows.rows.map((r) => {
            const row = r as Record<string, unknown>;
            const views = Number(row.views ?? 0);
            const completions = Number(row.completions ?? 0);
            return {
                label: String(row.label ?? ""),
                views,
                visitors: Number(row.visitors ?? 0),
                extra: { completionPct: views > 0 ? Math.round((completions / views) * 100) : 0, shares: Number(row.shares ?? 0) }
            };
        });
    }

    // paths (default)
    const rows = await db.execute(sql`
    SELECT path AS label, COUNT(*) AS views, COUNT(DISTINCT visitor_hash) AS visitors
    FROM events
    WHERE ts >= ${fromUtc}::timestamptz
      AND ts <= ${toUtc}::timestamptz + INTERVAL '1 day'
      AND name = 'pageview'
    GROUP BY 1 ORDER BY views DESC LIMIT ${limitN}
  `);
    return rows.rows.map((r) => {
        const row = r as Record<string, unknown>;
        return { label: String(row.label ?? ""), views: Number(row.views ?? 0), visitors: Number(row.visitors ?? 0) };
    });
}

// ---------------------------------------------------------------------------
// Events (counts + funnel)
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

export interface EventsResult {
    counts: EventCountRow[];
    funnel: FunnelStep[];
}

export async function queryEvents(fromUtc: string, toUtc: string): Promise<EventsResult> {
    const countsRows = await db.execute(sql`
    SELECT name, COUNT(*) AS count, COUNT(DISTINCT visitor_hash) AS visitors
    FROM events
    WHERE ts >= ${fromUtc}::timestamptz
      AND ts <= ${toUtc}::timestamptz + INTERVAL '1 day'
    GROUP BY name ORDER BY count DESC
  `);

    const funnelRows = await db.execute(sql`
    SELECT
      COUNT(DISTINCT session_id) FILTER (WHERE name = 'pageview') AS step1,
      COUNT(DISTINCT session_id) FILTER (WHERE name = 'story_open') AS step2,
      COUNT(DISTINCT session_id) FILTER (WHERE name = 'read_depth' AND (props->>'depth')::int >= 75) AS step3,
      COUNT(DISTINCT session_id) FILTER (WHERE name = 'share') AS step4
    FROM events
    WHERE ts >= ${fromUtc}::timestamptz
      AND ts <= ${toUtc}::timestamptz + INTERVAL '1 day'
  `);

    const f = funnelRows.rows[0] as Record<string, string | null>;
    return {
        counts: countsRows.rows.map((r) => {
            const row = r as Record<string, unknown>;
            return { name: String(row.name ?? ""), count: Number(row.count ?? 0), visitors: Number(row.visitors ?? 0) };
        }),
        funnel: [
            { label: "Page views", sessions: Number(f.step1 ?? 0) },
            { label: "Opened story", sessions: Number(f.step2 ?? 0) },
            { label: "Read 75%+", sessions: Number(f.step3 ?? 0) },
            { label: "Shared", sessions: Number(f.step4 ?? 0) }
        ]
    };
}

// ---------------------------------------------------------------------------
// Live (last 30 min)
// ---------------------------------------------------------------------------
export interface LiveResult {
    activeSessions: number;
    topPaths: { path: string; sessions: number }[];
}

export async function queryLive(): Promise<LiveResult> {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    const totalRows = await db.execute(sql`
    SELECT COUNT(DISTINCT session_id) AS sessions
    FROM events
    WHERE ts >= ${cutoff}::timestamptz
  `);

    const pathRows = await db.execute(sql`
    SELECT path, COUNT(DISTINCT session_id) AS sessions
    FROM events
    WHERE ts >= ${cutoff}::timestamptz
    GROUP BY path ORDER BY sessions DESC LIMIT 10
  `);

    const t = totalRows.rows[0] as Record<string, unknown>;
    return {
        activeSessions: Number(t.sessions ?? 0),
        topPaths: pathRows.rows.map((r) => {
            const row = r as Record<string, unknown>;
            return { path: String(row.path ?? ""), sessions: Number(row.sessions ?? 0) };
        })
    };
}

// Export the unused import to fix tree-shaking
export { dailyDimStats, dailyEventStats, dailyPageStats, useRaw };
