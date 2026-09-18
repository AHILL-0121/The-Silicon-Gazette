import { NextResponse } from "next/server";
import { z } from "zod";

import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";
import { queryEvents } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

const querySchema = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export async function GET(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;

    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
        from: searchParams.get("from"),
        to: searchParams.get("to")
    });

    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const data = await queryEvents(parsed.data.from, parsed.data.to);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
