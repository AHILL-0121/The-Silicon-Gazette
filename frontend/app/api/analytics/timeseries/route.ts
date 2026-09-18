import { NextResponse } from "next/server";
import { z } from "zod";

import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";
import { queryTimeseries } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

const querySchema = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    granularity: z.enum(["hour", "day", "week"]).default("day")
});

export async function GET(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;

    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
        from: searchParams.get("from"),
        to: searchParams.get("to"),
        granularity: searchParams.get("granularity") ?? "day"
    });

    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const { from, to, granularity } = parsed.data;
    const data = await queryTimeseries(from, to, granularity);

    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
