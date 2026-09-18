import { NextResponse } from "next/server";

import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";
import { queryLive } from "@/lib/analytics/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;

    const data = await queryLive();
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
