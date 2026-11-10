import { NextResponse } from "next/server";
import { z } from "zod";

import { parseFilters } from "@/lib/analytics/filters";
import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";
import { queryVisitors } from "@/lib/analytics/visitors";

export const dynamic = "force-dynamic";

const querySchema = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    limit: z.coerce.number().int().min(1).max(200).default(25)
});

export async function GET(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;

    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
        from: searchParams.get("from"),
        to: searchParams.get("to"),
        limit: searchParams.get("limit") ?? "25"
    });

    if (!parsed.success || parsed.data.from > parsed.data.to) {
        return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const { from, to, limit } = parsed.data;
    const data = await queryVisitors(from, to, limit, parseFilters(searchParams));
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
