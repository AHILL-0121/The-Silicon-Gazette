import { NextResponse } from "next/server";

import { isOkSession, requireAnalyticsSession, revokeSession } from "@/lib/analytics/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;

    const token = req.headers.get("authorization")?.slice(7) ?? "";
    await revokeSession(token);

    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
