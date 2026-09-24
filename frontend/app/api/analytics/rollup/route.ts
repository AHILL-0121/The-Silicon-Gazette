import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { sendAlert, sendNotice } from "@/lib/alerts";
import { logEvent } from "@/lib/logger";
import { rollupDay, storageReport } from "@/lib/analytics/rollup";
import { utcDayString } from "@/lib/analytics/visitor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_DAYS = 400;

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const bodySchema = z
    .object({
        day: DATE.optional(),
        from: DATE.optional(),
        to: DATE.optional()
    })
    .refine((b) => Boolean(b.from) === Boolean(b.to), { message: "from and to go together" })
    .refine((b) => !b.from || !b.to || b.from <= b.to, { message: "from must not be after to" });

function hasCronSecret(req: Request): boolean {
    const secret = process.env.CRON_SECRET;
    const header = req.headers.get("authorization");
    if (!secret || !header) return false;
    const expected = Buffer.from(`Bearer ${secret}`);
    const received = Buffer.from(header);
    return expected.length === received.length && timingSafeEqual(expected, received);
}

function formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${bytes} B`;
}

function describeDays(days: string[]): string {
    return days.length === 1 ? days[0] : `${days[0]} → ${days[days.length - 1]} (${days.length} days)`;
}

type Trigger = "github-actions" | "vercel-cron";

/**
 * Posts the run's outcome to the alert webhook (Slack/Discord). The Vercel
 * Cron backup re-runs an already rolled-up day, so it only reports failures.
 */
async function reportToSlack(
    results: { day: string; status: "ok" | "error"; error?: string }[],
    storage: Awaited<ReturnType<typeof storageReport>> | null,
    trigger: Trigger,
    durationMs: number
): Promise<void> {
    const via = `${trigger === "vercel-cron" ? "Vercel Cron (backup)" : "GitHub Actions"}, ${(durationMs / 1000).toFixed(1)}s`;
    const failures = results.filter((r) => r.status === "error");
    const storageLine = storage
        ? `${storage.usedPct}% of ${formatBytes(storage.limitBytes)} (database ${formatBytes(storage.databaseBytes)}, events ${formatBytes(storage.eventsBytes)} / ${storage.eventRows} rows, rollups ${formatBytes(storage.rollupBytes)})`
        : "unavailable";

    if (failures.length > 0) {
        await sendAlert("analytics-rollup-failed", "Analytics rollup failed.", {
            days: describeDays(results.map((r) => r.day)),
            rolled: `${results.length - failures.length}/${results.length}`,
            failed: failures.slice(0, 5).map((f) => `${f.day}: ${f.error}`).join("; ") + (failures.length > 5 ? ` (+${failures.length - 5} more)` : ""),
            storage: storageLine,
            via
        });
    } else if (trigger === "github-actions") {
        await sendNotice("analytics-rollup", "Analytics rollup completed.", {
            days: describeDays(results.map((r) => r.day)),
            rolled: `${results.length}/${results.length}`,
            storage: storageLine,
            via
        });
    }

    if (storage?.warning) {
        await sendAlert("analytics-storage-high", "Database storage is above 80% of its limit.", { storage: storageLine });
    }
}

function daysBetween(from: string, to: string): string[] {
    const days: string[] = [];
    const cursor = new Date(from + "T00:00:00Z");
    const end = new Date(to + "T00:00:00Z");
    while (cursor <= end && days.length <= MAX_DAYS) {
        days.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
}

async function run(input: z.infer<typeof bodySchema>, trigger: Trigger) {
    const start = Date.now();
    let days: string[];
    if (input.from && input.to) {
        days = daysBetween(input.from, input.to);
        if (days.length > MAX_DAYS) {
            return NextResponse.json({ error: `Max ${MAX_DAYS} days per call` }, { status: 400 });
        }
    } else {
        // Default: yesterday UTC
        days = [input.day ?? utcDayString(new Date(Date.now() - 86_400_000))];
    }

    const results: { day: string; status: "ok" | "error"; error?: string }[] = [];
    for (const day of days) {
        try {
            await rollupDay(day);
            results.push({ day, status: "ok" });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logEvent("error", "analytics.rollup.failed", { day, error: message });
            results.push({ day, status: "error", error: message });
        }
    }

    let storage: Awaited<ReturnType<typeof storageReport>> | null = null;
    try {
        storage = await storageReport();
        if (storage.warning) {
            logEvent("warn", "analytics.storage.high", { usedPct: storage.usedPct, databaseBytes: storage.databaseBytes });
        }
    } catch {
        // The report is informational; the rollup result stands on its own.
    }

    await reportToSlack(results, storage, trigger, Date.now() - start);

    const failed = results.some((r) => r.status === "error");
    return NextResponse.json(
        { rolled: results.filter((r) => r.status === "ok").length, results, storage },
        { status: failed ? 500 : 200, headers: { "Cache-Control": "no-store" } }
    );
}

/** GitHub Actions / manual runs: `{}` (yesterday), `{ day }` or `{ from, to }` (backfill). */
export async function POST(req: Request) {
    if (!hasCronSecret(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: z.infer<typeof bodySchema> = {};
    try {
        const text = await req.text();
        if (text) body = bodySchema.parse(JSON.parse(text));
    } catch {
        return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    return run(body, "github-actions");
}

/** Vercel Cron entry point (sends `Authorization: Bearer $CRON_SECRET`). Accepts `?day=`. */
export async function GET(req: Request) {
    if (!hasCronSecret(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = bodySchema.safeParse({ day: new URL(req.url).searchParams.get("day") ?? undefined });
    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid day" }, { status: 400 });
    }
    return run(parsed.data, "vercel-cron");
}
