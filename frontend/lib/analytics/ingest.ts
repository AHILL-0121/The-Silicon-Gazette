import { after } from "next/server";

import { db } from "@/lib/db";
import { logEvent } from "@/lib/logger";

import { events } from "./schema";
import { deviceFromUA, utcDayString, visitorHash } from "./visitor";

// ---------------------------------------------------------------------------
// Row shape written by the ingestion layer
// ---------------------------------------------------------------------------
export interface EventRow {
    name: string;
    path: string;
    pageType: string;
    editionDate?: string | null;
    storySlug?: string | null;
    visitorHash: string;
    sessionId: string;
    referrerHost?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    country?: string | null;
    device: string;
    viewportW?: number | null;
    props: Record<string, unknown>;
}

/**
 * Inserts a batch of events inside `after()` so the response returns 204 first.
 * Insert errors are logged but never surface to readers.
 */
export function insertEventsAfter(rows: EventRow[]): void {
    after(async () => {
        try {
            await db.insert(events).values(
                rows.map((r) => ({
                    name: r.name,
                    path: r.path,
                    pageType: r.pageType,
                    editionDate: r.editionDate ?? null,
                    storySlug: r.storySlug ?? null,
                    visitorHash: r.visitorHash,
                    sessionId: r.sessionId,
                    referrerHost: r.referrerHost ?? null,
                    utmSource: r.utmSource ?? null,
                    utmMedium: r.utmMedium ?? null,
                    utmCampaign: r.utmCampaign ?? null,
                    country: r.country ?? null,
                    device: r.device,
                    viewportW: r.viewportW ?? null,
                    props: r.props
                }))
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logEvent("warn", "analytics.ingest_failed", { error: msg, count: rows.length });
        }
    });
}

/**
 * Records one `generate_request` after the response is sent. Server-side, so
 * it counts cron and scripted callers too (no bot/DNT filtering); the IP is
 * only used for the daily visitor hash, as in /api/track.
 */
export function trackGenerateRequest(
    req: Request,
    props: { trusted: boolean; cached: boolean; status: number }
): void {
    const ua = req.headers.get("user-agent") ?? "";
    const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        req.headers.get("x-real-ip") ??
        "unknown";
    const country = req.headers.get("x-vercel-ip-country");
    const path = new URL(req.url).pathname;

    insertEventsAfter([
        {
            name: "generate_request",
            path,
            pageType: "other",
            visitorHash: visitorHash(ip, ua, utcDayString()),
            sessionId: props.trusted ? "server:cron" : "server",
            country: country && country.length === 2 ? country : null,
            device: deviceFromUA(ua),
            props
        }
    ]);
}

/**
 * Direct insert (no `after()`), for scripts and callers outside a request.
 */
export async function insertEvents(rows: EventRow[]): Promise<void> {
    if (rows.length === 0) return;
    try {
        await db.insert(events).values(
            rows.map((r) => ({
                name: r.name,
                path: r.path,
                pageType: r.pageType,
                editionDate: r.editionDate ?? null,
                storySlug: r.storySlug ?? null,
                visitorHash: r.visitorHash,
                sessionId: r.sessionId,
                referrerHost: r.referrerHost ?? null,
                utmSource: r.utmSource ?? null,
                utmMedium: r.utmMedium ?? null,
                utmCampaign: r.utmCampaign ?? null,
                country: r.country ?? null,
                device: r.device,
                viewportW: r.viewportW ?? null,
                props: r.props
            }))
        );
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logEvent("warn", "analytics.ingest_failed", { error: msg, count: rows.length });
    }
}
