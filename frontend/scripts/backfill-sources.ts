/**
 * Classifies past pageviews by source (lib/analytics/sources) from the
 * referrer host, tags and in-app label already stored on them. Run it once
 * after `npx drizzle-kit push` adds the source columns, and again whenever
 * the platform table changes. Only rows whose result changes are written.
 *
 * With --reroll it then rebuilds every rolled-up day, which fills
 * daily_source_stats for past days and applies the new classification to
 * them. Rollups are idempotent, so this is safe to repeat.
 *
 *   npx tsx scripts/backfill-sources.ts [--reroll]
 */
import { config } from "dotenv";

config({ path: ".env.local" });
config();

async function main() {
    const { sql } = await import("drizzle-orm");
    const { db } = await import("../lib/db");
    const { classifySource } = await import("../lib/analytics/sources");

    // Few distinct combinations, however many events: classify each once.
    const combos = await db.execute(sql`
    SELECT DISTINCT utm_source, utm_medium, referrer_host, in_app
    FROM events
    WHERE name = 'pageview'`);

    let updated = 0;
    for (const row of combos.rows as Record<string, string | null>[]) {
        const source = classifySource({
            utmSource: row.utm_source,
            utmMedium: row.utm_medium,
            referrerHost: row.referrer_host,
            inApp: row.in_app
        });
        const result = await db.execute(sql`
      UPDATE events
      SET source_channel = ${source.channel}, source_platform = ${source.platform}
      WHERE name = 'pageview'
        AND utm_source IS NOT DISTINCT FROM ${row.utm_source}
        AND utm_medium IS NOT DISTINCT FROM ${row.utm_medium}
        AND referrer_host IS NOT DISTINCT FROM ${row.referrer_host}
        AND in_app IS NOT DISTINCT FROM ${row.in_app}
        AND (source_channel IS DISTINCT FROM ${source.channel} OR source_platform IS DISTINCT FROM ${source.platform})`);
        updated += result.rowCount ?? 0;
    }
    console.log(`Classified ${combos.rows.length} source combinations; ${updated} pageviews updated.`);

    if (process.argv.includes("--reroll")) {
        const { rollupDay } = await import("../lib/analytics/rollup");
        const days = await db.execute(sql`SELECT day::text AS day FROM daily_session_stats ORDER BY day`);
        for (const { day } of days.rows as { day: string }[]) {
            await rollupDay(day);
        }
        console.log(`Rebuilt ${days.rows.length} rolled-up days.`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
