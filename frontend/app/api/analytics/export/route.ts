import { NextResponse } from "next/server";
import { z } from "zod";

import { exportDaily, exportEvents } from "@/lib/analytics/queries";
import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const querySchema = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    type: z.enum(["events", "daily"]).default("events")
});

const EVENT_COLUMNS = [
    "ts", "name", "path", "page_type", "edition_date", "story_slug",
    "visitor_hash", "session_id", "referrer_host", "utm_source", "utm_medium", "utm_campaign",
    "country", "device", "viewport_w", "props"
];
const DAILY_COLUMNS = ["day", "path", "page_type", "views", "visitors", "sessions", "completions", "shares"];

export async function GET(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;

    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
        from: searchParams.get("from"),
        to: searchParams.get("to"),
        type: searchParams.get("type") ?? "events"
    });

    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const { from, to, type } = parsed.data;

    if (type === "daily") {
        const rows = await exportDaily(from, to);
        return csvResponse(buildCsv(DAILY_COLUMNS, rows), `analytics-daily-${from}-${to}.csv`);
    }

    const rows = await exportEvents(from, to);
    return csvResponse(buildCsv(EVENT_COLUMNS, rows), `analytics-events-${from}-${to}.csv`);
}

function buildCsv(headers: string[], rows: Record<string, unknown>[]): string {
    const escape = (v: unknown): string => {
        const s =
            v === null || v === undefined
                ? ""
                : v instanceof Date
                    ? v.toISOString()
                    : typeof v === "object"
                        ? JSON.stringify(v)
                        : String(v);
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(",")];
    for (const row of rows) {
        lines.push(headers.map((h) => escape(row[h])).join(","));
    }
    return lines.join("\n");
}

function csvResponse(csv: string, filename: string): NextResponse {
    return new NextResponse(csv, {
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "no-store"
        }
    });
}
