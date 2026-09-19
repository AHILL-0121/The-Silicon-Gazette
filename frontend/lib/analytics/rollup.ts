import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logEvent } from "@/lib/logger";

import { rawDimDaily, rawEventDaily, rawPageDaily, rawSessionDaily } from "./daily";
import { dailyDimStats, dailyEventStats, dailyPageStats, dailySessionStats } from "./schema";

/**
 * Idempotent daily aggregation: delete then insert every rollup table for one
 * UTC day, in a single batch (one transaction on neon-http), so a failure
 * leaves the previous rows in place and running it twice yields identical rows.
 * The rows come from the same builders the dashboard uses for raw days.
 */
export async function rollupDay(day: string): Promise<void> {
    logEvent("info", "analytics.rollup.start", { day });

    await db.batch([
        db.delete(dailyPageStats).where(eq(dailyPageStats.day, day)),
        db.delete(dailyEventStats).where(eq(dailyEventStats.day, day)),
        db.delete(dailyDimStats).where(eq(dailyDimStats.day, day)),
        db.delete(dailySessionStats).where(eq(dailySessionStats.day, day)),
        db.execute(sql`
      INSERT INTO daily_page_stats (day, path, page_type, edition_date, story_slug, views, visitors, sessions, completions, shares)
      ${rawPageDaily(day, day)}`),
        db.execute(sql`
      INSERT INTO daily_event_stats (day, name, key, count, visitors)
      ${rawEventDaily(day, day)}`),
        db.execute(sql`
      INSERT INTO daily_dim_stats (day, dim, value, views, visitors)
      ${rawDimDaily(day, day)}`),
        // Always writes one row, which marks the day as rolled up.
        db.execute(sql`
      INSERT INTO daily_session_stats (day, views, visitors, sessions, story_sessions, complete_sessions, open_sessions, deep_sessions, share_sessions)
      ${rawSessionDaily(day, day)}`)
    ]);

    logEvent("info", "analytics.rollup.done", { day });
}

// ---------------------------------------------------------------------------
// Storage report
// ---------------------------------------------------------------------------
const DEFAULT_LIMIT_MB = 512; // Neon Free plan: 0.5 GB per project

export interface StorageReport {
    databaseBytes: number;
    eventsBytes: number;
    rollupBytes: number;
    eventRows: number;
    limitBytes: number;
    usedPct: number;
    warning: boolean;
}

/**
 * Database size against the Neon plan limit (`NEON_STORAGE_LIMIT_MB`, default
 * 512). `warning` is true at 80% or more; raw events are kept forever.
 */
export async function storageReport(): Promise<StorageReport> {
    const result = await db.execute(sql`
    SELECT pg_database_size(current_database())::bigint AS database_bytes,
           pg_total_relation_size('events')::bigint AS events_bytes,
           (pg_total_relation_size('daily_page_stats') + pg_total_relation_size('daily_event_stats')
             + pg_total_relation_size('daily_dim_stats') + pg_total_relation_size('daily_session_stats'))::bigint AS rollup_bytes,
           -- Planner estimate (cheap); exact count only before the first ANALYZE (-1).
           (SELECT CASE WHEN reltuples < 0 THEN (SELECT COUNT(*) FROM events) ELSE reltuples END
              FROM pg_class WHERE relname = 'events')::bigint AS event_rows
  `);
    const row = result.rows[0] as Record<string, string | number | null>;
    const limitMb = Number(process.env.NEON_STORAGE_LIMIT_MB) || DEFAULT_LIMIT_MB;
    const limitBytes = limitMb * 1024 * 1024;
    const databaseBytes = Number(row.database_bytes ?? 0);
    const usedPct = Math.round((databaseBytes / limitBytes) * 1000) / 10;
    return {
        databaseBytes,
        eventsBytes: Number(row.events_bytes ?? 0),
        rollupBytes: Number(row.rollup_bytes ?? 0),
        eventRows: Number(row.event_rows ?? 0),
        limitBytes,
        usedPct,
        warning: usedPct >= 80
    };
}
