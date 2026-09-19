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
    if (from > to) {
        return NextResponse.json({ error: "from must not be after to" }, { status: 400 });
    }

    // The previous period has the same number of whole UTC days and ends the day before `from`.
    const DAY_MS = 86_400_000;
    const fromMs = Date.parse(`${from}T00:00:00Z`);
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - fromMs) / DAY_MS) + 1;
    const prevFrom = new Date(fromMs - days * DAY_MS).toISOString().slice(0, 10);
    const prevTo = new Date(fromMs - DAY_MS).toISOString().slice(0, 10);

    const [current, previous] = await Promise.all([
        querySummary(from, to),
        querySummary(prevFrom, prevTo)
    ]);

    return NextResponse.json(
        { current, previous },
        { headers: { "Cache-Control": "no-store" } }
    );
}
