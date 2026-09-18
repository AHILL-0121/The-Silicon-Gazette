import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { rollupDay } from "@/lib/analytics/rollup";
import { utcDayString } from "@/lib/analytics/visitor";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

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
    while (cursor <= end && days.length <= 400) {
        days.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
}

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

    const days: string[] = [];

    if (body.from && body.to) {
        const range = daysBetween(body.from, body.to);
        if (range.length > 400) {
            return NextResponse.json({ error: "Max 400 days per call" }, { status: 400 });
        }
        days.push(...range);
    } else {
        // Default: yesterday UTC
        const yesterday = new Date(Date.now() - 86400000);
        days.push(body.day ?? utcDayString(yesterday));
    }

    const results: { day: string; status: "ok" | "error"; error?: string }[] = [];
    for (const day of days) {
        try {
            await rollupDay(day);
            results.push({ day, status: "ok" });
        } catch (error) {
            results.push({ day, status: "error", error: error instanceof Error ? error.message : String(error) });
        }
    }

    return NextResponse.json(
        { rolled: results.filter((r) => r.status === "ok").length, results },
        { headers: { "Cache-Control": "no-store" } }
    );
}
