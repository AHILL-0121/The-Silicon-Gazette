import { Ratelimit } from "@upstash/ratelimit";

import { NextResponse } from "next/server";

import { getRedis } from "@/lib/redis";

import { insertEventsAfter, type EventRow } from "@/lib/analytics/ingest";
import { analyticsEventSchema, trackBatchSchema, type AnalyticsEvent } from "@/lib/analytics/events";
import { visitorHash, isBot, deviceFromUA, referrerHost, pageTypeFromPath, utcDayString, bucketViewport } from "@/lib/analytics/visitor";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const MAX_BODY_BYTES = 4096;

// ---------------------------------------------------------------------------
// Rate limiter for /api/track — drops events (not blocks) when Redis is down
// ---------------------------------------------------------------------------
let trackLimiter: Ratelimit | null = null;

function getTrackLimiter(): Ratelimit | null {
    if (trackLimiter) return trackLimiter;
    const redis = getRedis();
    if (!redis) return null;
    trackLimiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(120, "1 m"),
        prefix: "sg:analytics:track"
    });
    return trackLimiter;
}

function extractIp(req: Request): string {
    return (
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        req.headers.get("x-real-ip") ??
        "unknown"
    );
}

/** Pathname only: no query string or hash is ever stored. */
function cleanPath(path: string): string {
    return path.split(/[?#]/)[0] || "/";
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
    // 1. Size limit (~4 KB). Content-Length can be absent, so the body is checked too.
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) {
        return new NextResponse(null, { status: 413 });
    }

    // 2. Origin / Referer check (prevents cross-site spam)
    const origin = req.headers.get("origin") ?? "";
    const refHeader = req.headers.get("referer") ?? "";
    const site = siteUrl();
    const allowedOrigins = [site, "http://localhost:3000", "http://localhost:3001"];
    const originOk =
        !origin || allowedOrigins.some((o) => origin.startsWith(o));
    const refOk =
        !refHeader || allowedOrigins.some((o) => refHeader.startsWith(o));

    if (!originOk && !refOk) {
        return new NextResponse(null, { status: 204 }); // Silently drop
    }

    // 3. Parse body (sendBeacon sends text/plain; fetch sends application/json)
    let body: unknown;
    try {
        const text = await req.text();
        if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
            return new NextResponse(null, { status: 413 });
        }
        if (!text || text === "null") return new NextResponse(null, { status: 204 });
        body = JSON.parse(text);
    } catch {
        return new NextResponse(null, { status: 400 });
    }

    // 4. Rate limit. When the limiter is configured but unreachable, events are
    //    dropped (204) rather than accepted unmetered; readers are never blocked.
    const ip = extractIp(req);
    const limiter = getTrackLimiter();
    if (limiter) {
        try {
            const result = await limiter.limit(ip);
            if (!result.success) {
                return new NextResponse(null, { status: 204 });
            }
        } catch {
            return new NextResponse(null, { status: 204 });
        }
    }

    // 5. Zod validation: the envelope, then each event on its own
    const parsed = trackBatchSchema.safeParse(body);
    if (!parsed.success) {
        return new NextResponse(null, { status: 400 });
    }
    const batch = parsed.data;

    const events: AnalyticsEvent[] = [];
    for (const raw of batch.events) {
        const event = analyticsEventSchema.safeParse(raw);
        if (event.success) events.push(event.data);
    }
    if (events.length === 0) {
        return new NextResponse(null, { status: 400 });
    }

    // 6. Bot / DNT / GPC / analytics-path skip
    const ua = req.headers.get("user-agent") ?? "";
    const dnt = req.headers.get("dnt") ?? "";
    const gpc = req.headers.get("sec-gpc") ?? "";

    if (isBot(ua) || dnt === "1" || gpc === "1") {
        return new NextResponse(null, { status: 204 });
    }

    // 7. Build rows
    const day = utcDayString();
    const country = (req.headers.get("x-vercel-ip-country") ?? req.headers.get("cf-ipcountry") ?? undefined);
    const hash = visitorHash(ip, ua, day);
    const device = batch.device ?? deviceFromUA(ua, batch.viewportW);
    const viewport = batch.viewportW !== undefined ? bucketViewport(batch.viewportW) : null;
    const siteHost = new URL(site).hostname;

    const rows: EventRow[] = [];
    for (const event of events) {
        const path = cleanPath(event.path ?? batch.path);
        if (path.startsWith("/analytics")) continue;

        const info = event.notFound
            ? { pageType: "404" as const, editionDate: null, storySlug: null }
            : pageTypeFromPath(path);

        rows.push({
            name: event.name,
            path,
            pageType: info.pageType,
            editionDate: info.editionDate,
            storySlug: info.storySlug,
            visitorHash: hash,
            sessionId: batch.sessionId,
            referrerHost: event.referrer ? referrerHost(event.referrer, siteHost) : null,
            utmSource: event.utmSource ?? null,
            utmMedium: event.utmMedium ?? null,
            utmCampaign: event.utmCampaign ?? null,
            country: typeof country === "string" && country.length === 2 ? country : null,
            device,
            viewportW: viewport,
            props: event.props as Record<string, unknown>
        });
    }

    // 8. Deferred insert (never blocks the response)
    if (rows.length > 0) insertEventsAfter(rows);

    return new NextResponse(null, { status: 204 });
}
