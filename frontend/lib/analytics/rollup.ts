import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logEvent } from "@/lib/logger";

import { dailyDimStats, dailyEventStats, dailyPageStats } from "./schema";

/**
 * Idempotent daily aggregation. Delete-then-insert, so running twice yields
 * identical rows. Pass `days` to backfill a range.
 */
export async function rollupDay(day: string): Promise<void> {
    logEvent("info", "analytics.rollup.start", { day });

    // Page stats
    await db.delete(dailyPageStats).where(sql`day = ${day}::date`);
    await db.execute(sql`
    INSERT INTO daily_page_stats (day, path, page_type, edition_date, story_slug, views, visitors, sessions)
    SELECT
      ${day}::date,
      path,
      page_type,
      edition_date,
      story_slug,
      COUNT(*) AS views,
      COUNT(DISTINCT visitor_hash) AS visitors,
      COUNT(DISTINCT session_id) AS sessions
    FROM events
    WHERE ts >= ${day}::timestamptz
      AND ts < ${day}::timestamptz + INTERVAL '1 day'
    GROUP BY path, page_type, edition_date, story_slug
    ON CONFLICT (day, path) DO UPDATE
      SET views = EXCLUDED.views,
          visitors = EXCLUDED.visitors,
          sessions = EXCLUDED.sessions,
          page_type = EXCLUDED.page_type,
          edition_date = EXCLUDED.edition_date,
          story_slug = EXCLUDED.story_slug
  `);

    // Event stats
    await db.delete(dailyEventStats).where(sql`day = ${day}::date`);
    await db.execute(sql`
    INSERT INTO daily_event_stats (day, name, key, count, visitors)
    SELECT
      ${day}::date,
      name,
      COALESCE(
        CASE name
          WHEN 'share' THEN props->>'method'
          WHEN 'read_depth' THEN (props->>'depth')::text
          WHEN 'theme_toggle' THEN props->>'to'
          ELSE NULL
        END,
        ''
      ) AS key,
      COUNT(*) AS count,
      COUNT(DISTINCT visitor_hash) AS visitors
    FROM events
    WHERE ts >= ${day}::timestamptz
      AND ts < ${day}::timestamptz + INTERVAL '1 day'
    GROUP BY name, key
    ON CONFLICT (day, name, key) DO UPDATE
      SET count = EXCLUDED.count, visitors = EXCLUDED.visitors
  `);

    // Dimension stats
    await db.delete(dailyDimStats).where(sql`day = ${day}::date`);

    // Referrers
    await db.execute(sql`
    INSERT INTO daily_dim_stats (day, dim, value, views, visitors)
    SELECT ${day}::date, 'referrer', referrer_host, COUNT(*), COUNT(DISTINCT visitor_hash)
    FROM events
    WHERE ts >= ${day}::timestamptz AND ts < ${day}::timestamptz + INTERVAL '1 day'
      AND name = 'pageview' AND referrer_host IS NOT NULL
    GROUP BY referrer_host
    ON CONFLICT (day, dim, value) DO UPDATE SET views = EXCLUDED.views, visitors = EXCLUDED.visitors
  `);

    // Countries
    await db.execute(sql`
    INSERT INTO daily_dim_stats (day, dim, value, views, visitors)
    SELECT ${day}::date, 'country', COALESCE(country, 'Unknown'), COUNT(*), COUNT(DISTINCT visitor_hash)
    FROM events
    WHERE ts >= ${day}::timestamptz AND ts < ${day}::timestamptz + INTERVAL '1 day'
      AND name = 'pageview'
    GROUP BY country
    ON CONFLICT (day, dim, value) DO UPDATE SET views = EXCLUDED.views, visitors = EXCLUDED.visitors
  `);

    // Devices
    await db.execute(sql`
    INSERT INTO daily_dim_stats (day, dim, value, views, visitors)
    SELECT ${day}::date, 'device', device, COUNT(*), COUNT(DISTINCT visitor_hash)
    FROM events
    WHERE ts >= ${day}::timestamptz AND ts < ${day}::timestamptz + INTERVAL '1 day'
      AND name = 'pageview'
    GROUP BY device
    ON CONFLICT (day, dim, value) DO UPDATE SET views = EXCLUDED.views, visitors = EXCLUDED.visitors
  `);

    logEvent("info", "analytics.rollup.done", { day });
}
