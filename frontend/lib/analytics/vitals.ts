import { sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";

import { tsInDays } from "./daily";
import { andFilter, type Filters } from "./filters";

// ---------------------------------------------------------------------------
// Core Web Vitals from `web_vital` events (see lib/analytics/vitals-client).
// Reads raw events: percentiles can't be rebuilt from rollup counts. The 75th
// percentile is what Google's own thresholds are judged on.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const rows = async (query: SQL): Promise<Row[]> => (await db.execute(query)).rows as Row[];
const num = (value: unknown) => Number(value ?? 0);

export const VITAL_ORDER = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;

export interface VitalSummary {
    metric: string;
    samples: number;
    p75: number | null;
    good: number;
    needsImprovement: number;
    poor: number;
}

export interface VitalsResult {
    metrics: VitalSummary[];
    /** 75th percentile by device class, per metric. */
    byDevice: { metric: string; device: string; samples: number; p75: number | null }[];
    /** Slowest pages by LCP (75th percentile), at least 5 samples each. */
    slowPages: { path: string; samples: number; p75: number }[];
    daily: { day: string; lcp: number | null }[];
}

export async function queryVitals(from: string, to: string, filters?: Filters): Promise<VitalsResult> {
    const where = sql`${tsInDays(from, to)} AND name = 'web_vital' ${andFilter(filters)}`;
    const value = sql`(props->>'value')::float`;
    const [metrics, byDevice, slowPages, daily] = await Promise.all([
        rows(sql`
      SELECT props->>'metric' AS metric, COUNT(*)::int AS samples,
             percentile_cont(0.75) WITHIN GROUP (ORDER BY ${value}) AS p75,
             (COUNT(*) FILTER (WHERE props->>'rating' = 'good'))::int AS good,
             (COUNT(*) FILTER (WHERE props->>'rating' = 'needs-improvement'))::int AS needs,
             (COUNT(*) FILTER (WHERE props->>'rating' = 'poor'))::int AS poor
      FROM events WHERE ${where} GROUP BY 1`),
        rows(sql`
      SELECT props->>'metric' AS metric, device, COUNT(*)::int AS samples,
             percentile_cont(0.75) WITHIN GROUP (ORDER BY ${value}) AS p75
      FROM events WHERE ${where} GROUP BY 1, 2`),
        rows(sql`
      SELECT path, COUNT(*)::int AS samples, percentile_cont(0.75) WITHIN GROUP (ORDER BY ${value}) AS p75
      FROM events WHERE ${where} AND props->>'metric' = 'LCP'
      GROUP BY path HAVING COUNT(*) >= 5 ORDER BY p75 DESC LIMIT 5`),
        rows(sql`
      SELECT ((ts AT TIME ZONE 'UTC')::date)::text AS day,
             percentile_cont(0.75) WITHIN GROUP (ORDER BY ${value}) AS p75
      FROM events WHERE ${where} AND props->>'metric' = 'LCP' GROUP BY 1 ORDER BY 1`)
    ]);

    const rank = (metric: string) => VITAL_ORDER.indexOf(metric as (typeof VITAL_ORDER)[number]);
    const p75 = (row: Row) => (row.p75 === null || row.p75 === undefined ? null : Math.round(num(row.p75) * 1000) / 1000);
    return {
        metrics: metrics
            .map((row) => ({
                metric: String(row.metric),
                samples: num(row.samples),
                p75: p75(row),
                good: num(row.good),
                needsImprovement: num(row.needs),
                poor: num(row.poor)
            }))
            .sort((a, b) => rank(a.metric) - rank(b.metric)),
        byDevice: byDevice.map((row) => ({ metric: String(row.metric), device: String(row.device), samples: num(row.samples), p75: p75(row) })),
        slowPages: slowPages.map((row) => ({ path: String(row.path), samples: num(row.samples), p75: Math.round(num(row.p75)) })),
        daily: daily.map((row) => ({ day: String(row.day), lcp: p75(row) }))
    };
}
