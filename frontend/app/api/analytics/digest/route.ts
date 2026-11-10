import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { buildDigest, digestChannels, runDigest } from "@/lib/analytics/digest";
import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

function hasCronSecret(req: Request): boolean {
    const secret = process.env.CRON_SECRET;
    const header = req.headers.get("authorization");
    if (!secret || !header) return false;
    const expected = Buffer.from(`Bearer ${secret}`);
    const received = Buffer.from(header);
    return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Vercel Cron (Bearer CRON_SECRET): send the digest and push alerts.
 * Dashboard (session token): `?preview=1` shows the digest and which channels
 * are configured, without sending anything.
 */
export async function GET(req: Request) {
    if (hasCronSecret(req)) {
        const run = await runDigest({ pushAlerts: true });
        return NextResponse.json(
            { sent: run.sent, alertsPushed: run.alertsPushed, errors: run.errors, title: run.digest.title },
            { status: run.errors.length > 0 ? 502 : 200, headers: NO_STORE }
        );
    }

    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;
    const digest = await buildDigest();
    return NextResponse.json({ channels: digestChannels(), schedule: "Every day at 07:00 UTC (Mondays: the whole week)", digest }, { headers: NO_STORE });
}

/** Dashboard "Send a test now": delivers the digest to the configured channels. */
export async function POST(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;
    const channels = digestChannels();
    if (!channels.webhook && !channels.email) {
        return NextResponse.json({ error: "No delivery channel is configured. Set ANALYTICS_DIGEST_WEBHOOK_URL (or ALERT_WEBHOOK_URL), or RESEND_API_KEY with DIGEST_EMAIL_TO and DIGEST_EMAIL_FROM." }, { status: 400 });
    }
    const run = await runDigest({ pushAlerts: false });
    return NextResponse.json({ sent: run.sent, errors: run.errors }, { status: run.errors.length > 0 ? 502 : 200, headers: NO_STORE });
}
