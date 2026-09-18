import { Ratelimit } from "@upstash/ratelimit";

import { NextResponse } from "next/server";

import { getRedis } from "@/lib/redis";

import { insertEventsAfter, type EventRow } from "@/lib/analytics/ingest";
import { trackBatchSchema } from "@/lib/analytics/events";
import { visitorHash, isBot, deviceFromUA, referrerHost, pageTypeFromPath, utcDayString, bucketViewport } from "@/lib/analytics/visitor";
import { siteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

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

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
    // 1. Size limit (~4 KB)
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > 4096) {
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
        if (!text || text === "null") return new NextResponse(null, { status: 204 });
        body = JSON.parse(text);
    } catch {
        return new NextResponse(null, { status: 400 });
    }

    // 4. Rate limit — drops events when limiter is down (tracking must not block readers)
    const ip = extractIp(req);
    try {
        const limiter = getTrackLimiter();
        if (limiter) {
            const result = await limiter.limit(ip);
            if (!result.success) {
                return new NextResponse(null, { status: 204 }); // Drop silently
            }
        }
    } catch {
        // Limiter error → drop, don't block
    }

    // 5. Zod validation
    const parsed = trackBatchSchema.safeParse(body);
    if (!parsed.success) {
        return new NextResponse(null, { status: 400 });
    }

    const batch = parsed.data;

    // 6. Bot / DNT / GPC / analytics-path skip
    const ua = req.headers.get("user-agent") ?? "";
    const dnt = req.headers.get("dnt") ?? "";
    const gpc = req.headers.get("sec-gpc") ?? "";

    if (isBot(ua) || dnt === "1" || gpc === "1" || batch.path.startsWith("/analytics")) {
        return new NextResponse(null, { status: 204 });
    }

    // 7. Build rows
    const day = utcDayString();
    const country = (req.headers.get("x-vercel-ip-country") ?? req.headers.get("cf-ipcountry") ?? undefined);
    const hash = visitorHash(ip, ua, day);
    const device = batch.device ?? deviceFromUA(ua, batch.viewportW);
    const viewport = batch.viewportW !== undefined ? bucketViewport(batch.viewportW) : null;
    const { pageType, editionDate, storySlug } = pageTypeFromPath(batch.path);
    const refHost = referrerHost(batch.referrer ?? req.headers.get("referer") ?? "", new URL(site).hostname);

    const rows: EventRow[] = batch.events.map((event) => ({
        name: event.name,
        path: batch.path.split("?")[0], // No query strings stored
        pageType,
        editionDate,
        storySlug,
        visitorHash: hash,
        sessionId: batch.sessionId,
        referrerHost: refHost,
        utmSource: batch.utmSource ?? null,
        utmMedium: batch.utmMedium ?? null,
        utmCampaign: batch.utmCampaign ?? null,
        country: typeof country === "string" && country.length === 2 ? country : null,
        device,
        viewportW: viewport,
        props: event.props as Record<string, unknown>
    }));

    // 8. Deferred insert (never blocks the response)
    insertEventsAfter(rows);

    return new NextResponse(null, { status: 204 });
}
