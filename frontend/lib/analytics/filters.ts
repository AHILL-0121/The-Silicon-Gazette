import { sql, type SQL } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Dashboard-wide filters (device, country, source channel).
//
// Rollup tables carry no such split, so when a filter is on, queries read raw
// events (kept forever) for the whole range. Query-string names are prefixed
// `f_` so they never clash with the explorer's own device/country params.
// ---------------------------------------------------------------------------

export interface Filters {
    device?: "mobile" | "tablet" | "desktop";
    /** ISO 3166 alpha-2, uppercase, or "unknown" for events without a country. */
    country?: string;
    /** A source channel from lib/analytics/sources (search, social, direct, ...). */
    channel?: string;
}

export const FILTER_PARAMS = ["f_device", "f_country", "f_channel"] as const;

export function parseFilters(params: URLSearchParams): Filters {
    const filters: Filters = {};
    const device = params.get("f_device");
    if (device === "mobile" || device === "tablet" || device === "desktop") filters.device = device;
    const country = params.get("f_country");
    if (country && /^[A-Za-z]{2}$/.test(country)) filters.country = country.toUpperCase();
    else if (country === "unknown") filters.country = "unknown";
    const channel = params.get("f_channel");
    if (channel && /^[a-z_]{2,20}$/.test(channel)) filters.channel = channel;
    return filters;
}

export function hasFilters(filters?: Filters): boolean {
    return Boolean(filters && (filters.device || filters.country || filters.channel));
}

/** A condition on the `events` table, or undefined when nothing is filtered. */
export function filterSql(filters?: Filters): SQL | undefined {
    if (!filters || !hasFilters(filters)) return undefined;
    const parts: SQL[] = [];
    if (filters.device) parts.push(sql`device = ${filters.device}`);
    if (filters.country) {
        parts.push(filters.country === "unknown" ? sql`country IS NULL` : sql`country = ${filters.country}`);
    }
    if (filters.channel) {
        // A session belongs to the channel of its first pageview.
        parts.push(sql`session_id IN (
          SELECT session_id FROM (
            SELECT DISTINCT ON (session_id) session_id, source_channel
            FROM events WHERE name = 'pageview' ORDER BY session_id, ts, id
          ) first_view WHERE COALESCE(source_channel, 'direct') = ${filters.channel}
        )`);
    }
    return sql.join(parts, sql` AND `);
}

/** `AND <filter>` or nothing, for appending to a WHERE clause. */
export function andFilter(filters?: Filters): SQL {
    const f = filterSql(filters);
    return f ? sql`AND ${f}` : sql``;
}

/** Human description, e.g. "mobile · IN · search", for headings and digests. */
export function describeFilters(filters?: Filters): string {
    if (!filters) return "";
    return [filters.device, filters.country, filters.channel].filter(Boolean).join(" · ");
}
