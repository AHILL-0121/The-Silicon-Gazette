import { sql } from "drizzle-orm";

import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Everything the analytics keep, as newline-delimited JSON, streamed so a large
 * events table never sits in memory. One line per row:
 *   {"table":"events","row":{...}}
 * preceded by a {"type":"meta",...} line. Restore by reading line by line.
 * Ignores any date range on purpose: this is the "not locked to one database" copy.
 */
const ROLLUP_TABLES = ["daily_page_stats", "daily_event_stats", "daily_session_stats", "daily_dim_stats", "daily_source_stats"] as const;
/** Newer tables: skipped quietly when they have not been created yet. Token hashes are never exported. */
const OPTIONAL_TABLES = ["analytics_counters", "analytics_annotations"] as const;
const PAGE = 1000;

export async function GET(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;

    const encoder = new TextEncoder();
    const line = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);

    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            try {
                controller.enqueue(line({ type: "meta", exportedAt: new Date().toISOString(), tables: ["events", ...ROLLUP_TABLES, ...OPTIONAL_TABLES], format: "ndjson" }));

                // Rollups are small: one query each.
                for (const table of ROLLUP_TABLES) {
                    const result = await db.execute(sql`SELECT * FROM ${sql.raw(table)}`);
                    for (const row of result.rows) controller.enqueue(line({ table, row }));
                }

                for (const table of OPTIONAL_TABLES) {
                    try {
                        const result = await db.execute(sql`SELECT * FROM ${sql.raw(table)}`);
                        for (const row of result.rows) controller.enqueue(line({ table, row }));
                    } catch {
                        // table not created yet
                    }
                }

                // Events: keyset pagination by id, so it stays fast at any size.
                let lastId = 0;
                for (;;) {
                    const result = await db.execute(sql`SELECT * FROM events WHERE id > ${lastId} ORDER BY id LIMIT ${PAGE}`);
                    if (result.rows.length === 0) break;
                    for (const row of result.rows) controller.enqueue(line({ table: "events", row }));
                    lastId = Number((result.rows[result.rows.length - 1] as { id: number | string }).id);
                    if (result.rows.length < PAGE) break;
                }
                controller.close();
            } catch (error) {
                controller.error(error);
            }
        }
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Content-Disposition": `attachment; filename="analytics-backup-${new Date().toISOString().slice(0, 10)}.ndjson"`,
            "Cache-Control": "no-store"
        }
    });
}
