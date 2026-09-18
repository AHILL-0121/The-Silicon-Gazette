import { after } from "next/server";

import { db } from "@/lib/db";
import { logEvent } from "@/lib/logger";

import { events } from "./schema";

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
 * Direct insert (no `after()`). Used by server-side callers in generate route.
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
