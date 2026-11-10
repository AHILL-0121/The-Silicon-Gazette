import { after } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logEvent } from "@/lib/logger";

import { utcDayString } from "./visitor";

// ---------------------------------------------------------------------------
// Bot-filter rate. Bots, Do-Not-Track and Global-Privacy-Control requests are
// dropped before anything is stored, so the only trace is a per-day counter.
// No identifier of any kind is kept, just how many events were refused and why.
// ---------------------------------------------------------------------------

export type CounterKey = "accepted" | "bot" | "dnt" | "gpc";

/** Adds to today's counter after the response is sent. Failures are logged, never raised. */
export function bumpCounter(key: CounterKey, amount: number): void {
    if (amount <= 0) return;
    const day = utcDayString();
    after(async () => {
        try {
            await db.execute(sql`
        INSERT INTO analytics_counters (day, key, count)
        VALUES (${day}::date, ${key}, ${amount})
        ON CONFLICT (day, key) DO UPDATE SET count = analytics_counters.count + EXCLUDED.count`);
        } catch (error) {
            logEvent("warn", "analytics.counter_failed", { key, error: error instanceof Error ? error.message : String(error) });
        }
    });
}

export interface BotFilterResult {
    accepted: number;
    bot: number;
    dnt: number;
    gpc: number;
    /** Share of all tracked events that were refused, 0-100 (null with no data). */
    filteredPct: number | null;
    /** First day any counter exists; earlier traffic was not counted. */
    since: string | null;
    daily: { day: string; accepted: number; filtered: number }[];
}

export function isMissingTable(error: unknown): boolean {
    const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
    return /relation .* does not exist|no such table|42P01/i.test(text);
}

/** Null when the counters table has not been created yet. */
export async function queryBotFilter(from: string, to: string): Promise<BotFilterResult | null> {
    try {
        const [result, first] = await Promise.all([
            db.execute(sql`
        SELECT day::text AS day, key, count FROM analytics_counters
        WHERE day >= ${from}::date AND day <= ${to}::date ORDER BY day`),
            db.execute(sql`SELECT MIN(day)::text AS since FROM analytics_counters`)
        ]);
        const totals = { accepted: 0, bot: 0, dnt: 0, gpc: 0 };
        const byDay = new Map<string, { accepted: number; filtered: number }>();
        for (const row of result.rows as Array<{ day: string; key: CounterKey; count: number }>) {
            const n = Number(row.count);
            if (!(row.key in totals)) continue;
            totals[row.key] += n;
            const entry = byDay.get(row.day) ?? { accepted: 0, filtered: 0 };
            if (row.key === "accepted") entry.accepted += n;
            else entry.filtered += n;
            byDay.set(row.day, entry);
        }
        const all = totals.accepted + totals.bot + totals.dnt + totals.gpc;
        return {
            ...totals,
            filteredPct: all > 0 ? Math.round(((all - totals.accepted) / all) * 1000) / 10 : null,
            since: ((first.rows[0] as { since?: string | null } | undefined)?.since) ?? null,
            daily: [...byDay.entries()].map(([day, v]) => ({ day, ...v }))
        };
    } catch (error) {
        if (isMissingTable(error)) return null;
        throw error;
    }
}
