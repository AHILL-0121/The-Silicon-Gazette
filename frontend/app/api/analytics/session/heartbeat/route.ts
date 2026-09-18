import { NextResponse } from "next/server";

import { isOkSession, requireAnalyticsSession, touchSession } from "@/lib/analytics/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;

    let body: { active?: boolean } = {};
    try {
        body = (await req.json()) as { active?: boolean };
    } catch {
        // Ignore parse errors; active defaults to false
    }

    await touchSession(check.hash, body.active === true);

    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
