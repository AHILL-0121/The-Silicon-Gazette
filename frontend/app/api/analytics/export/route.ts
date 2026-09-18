import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const querySchema = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    type: z.enum(["events", "daily"]).default("events")
});

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
        const rows = await db.execute(sql`
      SELECT day, path, page_type, views, visitors, sessions
      FROM daily_page_stats
      WHERE day >= ${from}::date AND day <= ${to}::date
      ORDER BY day, path
    `);
        const csv = buildCsv(
            ["day", "path", "page_type", "views", "visitors", "sessions"],
            rows.rows as Record<string, unknown>[]
        );
        return csvResponse(csv, `analytics-daily-${from}-${to}.csv`);
    }

    // Raw events export
    const rows = await db.execute(sql`
    SELECT ts, name, path, page_type, edition_date, story_slug,
           visitor_hash, session_id, referrer_host, utm_source,
           country, device, viewport_w
    FROM events
    WHERE ts >= ${from}::timestamptz
      AND ts <= ${to}::timestamptz + INTERVAL '1 day'
    ORDER BY ts
  `);

    const csv = buildCsv(
        ["ts", "name", "path", "page_type", "edition_date", "story_slug",
            "visitor_hash", "session_id", "referrer_host", "utm_source",
            "country", "device", "viewport_w"],
        rows.rows as Record<string, unknown>[]
    );

    return csvResponse(csv, `analytics-events-${from}-${to}.csv`);
}

function buildCsv(headers: string[], rows: Record<string, unknown>[]): string {
    const escape = (v: unknown): string => {
        const s = v === null || v === undefined ? "" : String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n")
            ? `"${s.replace(/"/g, '""')}"`
            : s;
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
