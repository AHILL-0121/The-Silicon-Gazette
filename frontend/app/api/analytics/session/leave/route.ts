import { NextResponse } from "next/server";

import { markLeave } from "@/lib/analytics/session";

export const dynamic = "force-dynamic";

/**
 * Page-close beacon. Always returns 204 — even on error — so the browser
 * doesn't retry. The body contains `{ token }` because sendBeacon can't send
 * custom headers.
 */
export async function POST(req: Request) {
    try {
        const text = await req.text();
        const body = JSON.parse(text) as { token?: string };
        if (body.token) {
            await markLeave(body.token);
        }
    } catch {
        // Never error: tracking must not affect readers
    }

    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
