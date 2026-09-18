import { NextResponse } from "next/server";
import { z } from "zod";

import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";
import { queryTop } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

const querySchema = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(["editions", "stories", "paths", "referrers", "countries", "devices"]),
    limit: z.coerce.number().int().min(1).max(50).default(10)
});

export async function GET(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;

    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse({
        from: searchParams.get("from"),
        to: searchParams.get("to"),
        kind: searchParams.get("kind"),
        limit: searchParams.get("limit") ?? "10"
    });

    if (!parsed.success) {
        return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    const { from, to, kind, limit } = parsed.data;
    const data = await queryTop(from, to, kind, limit);

    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
