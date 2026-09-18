import { NextResponse } from "next/server";
import { z } from "zod";

import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";
import { querySummary } from "@/lib/analytics/queries";

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
        return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
    }

    const { from, to } = parsed.data;

    // Also fetch previous period for comparison
    const fromMs = new Date(from + "T00:00:00Z").getTime();
    const toMs = new Date(to + "T23:59:59Z").getTime();
    const rangeMs = toMs - fromMs;
    const prevFrom = new Date(fromMs - rangeMs).toISOString().slice(0, 10);
    const prevTo = new Date(fromMs - 1).toISOString().slice(0, 10);

    const [current, previous] = await Promise.all([
        querySummary(from, to),
        querySummary(prevFrom, prevTo)
    ]);

    return NextResponse.json(
        { current, previous },
        { headers: { "Cache-Control": "no-store" } }
    );
}
