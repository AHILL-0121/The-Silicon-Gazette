import { sql, type SQL } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Per-UTC-day aggregations of raw events.
//
// Each builder returns rows with exactly the columns of one rollup table. The
// nightly rollup inserts these rows, and the dashboard runs the same builders
// over days that aren't rolled up yet, so rollup numbers and raw numbers can
// never drift apart. Days are UTC regardless of the database's TimeZone.
// ---------------------------------------------------------------------------

/** `ts` inside the UTC days [from, to], both inclusive. */
export function tsInDays(from: string, to: string): SQL {
    return sql`ts >= ((${from}::date)::timestamp AT TIME ZONE 'UTC')
      AND ts < (((${to}::date) + 1)::timestamp AT TIME ZONE 'UTC')`;
}

const EVENT_DAY = sql`(ts AT TIME ZONE 'UTC')::date`;

/** Columns: day, path, page_type, edition_date, story_slug, views, visitors, sessions, completions, shares. */
export function rawPageDaily(from: string, to: string): SQL {
    return sql`
    SELECT ${EVENT_DAY} AS day,
           path,
           MAX(page_type) AS page_type,
           MAX(edition_date) AS edition_date,
           MAX(story_slug) AS story_slug,
           (COUNT(*) FILTER (WHERE name = 'pageview'))::int AS views,
           (COUNT(DISTINCT visitor_hash) FILTER (WHERE name = 'pageview'))::int AS visitors,
           (COUNT(DISTINCT session_id) FILTER (WHERE name = 'pageview'))::int AS sessions,
           (COUNT(*) FILTER (WHERE name = 'read_complete'))::int AS completions,
           (COUNT(*) FILTER (WHERE name = 'share'))::int AS shares
    FROM events
    WHERE ${tsInDays(from, to)}
      AND name IN ('pageview', 'read_complete', 'share')
    GROUP BY 1, 2`;
}

/** Columns: day, name, key, count, visitors. `key` is one low-cardinality prop, or ''. */
export function rawEventDaily(from: string, to: string): SQL {
    return sql`
    SELECT day, name, key, COUNT(*)::int AS count, COUNT(DISTINCT visitor_hash)::int AS visitors
    FROM (
      SELECT ${EVENT_DAY} AS day,
             name,
             visitor_hash,
             COALESCE(
               CASE name
                 WHEN 'share' THEN props->>'method'
                 WHEN 'read_depth' THEN props->>'depth'
                 WHEN 'theme_toggle' THEN props->>'to'
                 WHEN 'palette_open' THEN props->>'via'
                 WHEN 'palette_search' THEN props->>'chose'
                 WHEN 'archive_search' THEN
                   CASE WHEN (props->>'results')::int = 0 THEN 'zero' ELSE 'hit' END
                 WHEN 'edition_nav' THEN props->>'dir'
                 WHEN 'generate_request' THEN props->>'status'
               END,
               ''
             ) AS key
      FROM events
      WHERE ${tsInDays(from, to)}
    ) e
    GROUP BY day, name, key`;
}

/** Columns: day, dim, value, views, visitors. Pageviews only. */
export function rawDimDaily(from: string, to: string): SQL {
    return sql`
    SELECT day, dim, value, COUNT(*)::int AS views, COUNT(DISTINCT visitor_hash)::int AS visitors
    FROM (
      SELECT ${EVENT_DAY} AS day, visitor_hash, d.dim, d.value
      FROM events
      CROSS JOIN LATERAL (VALUES
        ('referrer', referrer_host::text),
        ('country', COALESCE(country::text, 'Unknown')),
        ('device', device::text),
        ('utm_source', utm_source::text)
      ) AS d(dim, value)
      WHERE ${tsInDays(from, to)}
        AND name = 'pageview'
        AND d.value IS NOT NULL
    ) x
    GROUP BY day, dim, value`;
}

/**
 * Columns: day, views, visitors, sessions, story_sessions, complete_sessions,
 * open_sessions, deep_sessions, share_sessions. One row for every day in the
 * range, zeros included.
 */
export function rawSessionDaily(from: string, to: string): SQL {
    return sql`
    SELECT g.day,
           COALESCE(s.views, 0) AS views,
           COALESCE(s.visitors, 0) AS visitors,
           COALESCE(s.sessions, 0) AS sessions,
           COALESCE(s.story_sessions, 0) AS story_sessions,
           COALESCE(s.complete_sessions, 0) AS complete_sessions,
           COALESCE(s.open_sessions, 0) AS open_sessions,
           COALESCE(s.deep_sessions, 0) AS deep_sessions,
           COALESCE(s.share_sessions, 0) AS share_sessions
    FROM (
      SELECT generate_series(${from}::date, ${to}::date, INTERVAL '1 day')::date AS day
    ) g
    LEFT JOIN (
      SELECT ${EVENT_DAY} AS day,
             (COUNT(*) FILTER (WHERE name = 'pageview'))::int AS views,
             (COUNT(DISTINCT visitor_hash) FILTER (WHERE name = 'pageview'))::int AS visitors,
             (COUNT(DISTINCT session_id) FILTER (WHERE name = 'pageview'))::int AS sessions,
             (COUNT(DISTINCT session_id) FILTER (WHERE name = 'pageview' AND page_type = 'story'))::int AS story_sessions,
             (COUNT(DISTINCT session_id) FILTER (WHERE name = 'read_complete'))::int AS complete_sessions,
             (COUNT(DISTINCT session_id) FILTER (WHERE name = 'story_open'))::int AS open_sessions,
             (COUNT(DISTINCT session_id) FILTER (
               WHERE name = 'read_depth' AND (props->>'depth')::int >= 75
             ))::int AS deep_sessions,
             (COUNT(DISTINCT session_id) FILTER (WHERE name = 'share'))::int AS share_sessions
      FROM events
      WHERE ${tsInDays(from, to)}
      GROUP BY 1
    ) s ON s.day = g.day`;
}

// ---------------------------------------------------------------------------
// Merging rollups with raw events
// ---------------------------------------------------------------------------

/**
 * Days served from rollups: rolled-up days older than the raw window (today
 * and yesterday UTC, i.e. the last 24–48 h, always come from raw events).
 */
const ROLLED_DAYS = sql`SELECT day FROM daily_session_stats
  WHERE day <= (now() AT TIME ZONE 'UTC')::date - 2`;

export type RollupTable = "daily_page_stats" | "daily_event_stats" | "daily_dim_stats" | "daily_session_stats";

const COLUMNS: Record<RollupTable, SQL> = {
    daily_page_stats: sql`day, path, page_type, edition_date, story_slug, views, visitors, sessions, completions, shares`,
    daily_event_stats: sql`day, name, key, count, visitors`,
    daily_dim_stats: sql`day, dim, value, views, visitors`,
    daily_session_stats: sql`day, views, visitors, sessions, story_sessions, complete_sessions, open_sessions, deep_sessions, share_sessions`
};

const RAW: Record<RollupTable, (from: string, to: string) => SQL> = {
    daily_page_stats: rawPageDaily,
    daily_event_stats: rawEventDaily,
    daily_dim_stats: rawDimDaily,
    daily_session_stats: rawSessionDaily
};

/**
 * A subquery (use as `FROM (${merged(...)}) m`) with one table's rows for
 * [from, to]: rollup rows for rolled-up days, raw-event aggregates for the
 * rest. `rawFrom` is the first day that isn't rolled up (see `rawStart`), so
 * the raw scan covers only the days that need it; null means none do.
 */
export function merged(table: RollupTable, from: string, to: string, rawFrom: string | null): SQL {
    const rolled = sql`SELECT ${COLUMNS[table]} FROM ${sql.raw(table)}
      WHERE day >= ${from}::date AND day <= ${to}::date AND day IN (${ROLLED_DAYS})`;
    if (!rawFrom) return rolled;
    return sql`${rolled}
      UNION ALL
      SELECT ${COLUMNS[table]} FROM (${RAW[table](rawFrom, to)}) r
      WHERE r.day NOT IN (${ROLLED_DAYS})`;
}

/** SQL returning the first day in [from, to] that isn't rolled up, or NULL. */
export function rawStartQuery(from: string, to: string): SQL {
    return sql`
    SELECT MIN(d)::date::text AS raw_from
    FROM generate_series(${from}::date, ${to}::date, INTERVAL '1 day') AS d
    WHERE d::date NOT IN (${ROLLED_DAYS})`;
}
