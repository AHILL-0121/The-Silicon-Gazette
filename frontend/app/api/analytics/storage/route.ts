import { NextResponse } from "next/server";

import { storageReport } from "@/lib/analytics/rollup";
import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";

export const dynamic = "force-dynamic";

/** Database size against the Neon plan limit; `warning` is set at 80%. */
export async function GET(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;

    const report = await storageReport();
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
