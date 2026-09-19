import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

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

async function run(input: z.infer<typeof bodySchema>) {
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
    return run(body);
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
    return run(parsed.data);
}
