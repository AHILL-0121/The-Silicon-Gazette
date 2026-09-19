"use client";

import type { TrackBatch } from "./events";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ENDPOINT = "/api/track";
const FLUSH_INTERVAL_MS = 2_000;
const FLUSH_THRESHOLD = 10;
/** Stays under the endpoint's 4 KB body limit. */
const MAX_BATCH_BYTES = 3_800;
const SID_KEY = "sg-sid";
const OPT_OUT_KEY = "sg-analytics-optout";

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------
interface QueuedEvent {
    name: string;
    props: Record<string, unknown>;
    // Page context at the moment of the event (a batch can span a navigation).
    path: string;
    referrer?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    notFound?: boolean;
}

const queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let currentPath = "/";
let pendingReferrer: string | undefined;
let notFoundPath: string | null = null;

// ---------------------------------------------------------------------------
// Opt-out checks
// ---------------------------------------------------------------------------
function isOptedOut(): boolean {
    try {
        if (typeof localStorage !== "undefined" && localStorage.getItem(OPT_OUT_KEY) === "1") return true;
    } catch {
        // ignore
    }
    if (typeof navigator !== "undefined") {
        if ((navigator as { doNotTrack?: string }).doNotTrack === "1") return true;
        if ((navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true) return true;
        if (navigator.webdriver) return true;
    }
    // Disable in dev unless explicitly enabled
    if (process.env.NODE_ENV === "development" && !process.env.NEXT_PUBLIC_ANALYTICS_DEV) return true;
    return false;
}

export function setOptOut(value: boolean): void {
    try {
        if (value) {
            localStorage.setItem(OPT_OUT_KEY, "1");
        } else {
            localStorage.removeItem(OPT_OUT_KEY);
        }
    } catch {
        // ignore
    }
}

// ---------------------------------------------------------------------------
// Session ID (per tab via sessionStorage)
// ---------------------------------------------------------------------------
export function getSessionId(): string {
    try {
        let sid = sessionStorage.getItem(SID_KEY);
        if (!sid) {
            sid = crypto.randomUUID();
            sessionStorage.setItem(SID_KEY, sid);
        }
        return sid;
    } catch {
        return "no-storage";
    }
}

// ---------------------------------------------------------------------------
// Flush
// ---------------------------------------------------------------------------
function buildBatch(events: QueuedEvent[]): TrackBatch {
    return {
        events,
        path: events[0]?.path ?? currentPath,
        sessionId: getSessionId(),
        viewportW: typeof window !== "undefined" ? window.innerWidth : undefined
    };
}

function send(body: string): void {
    const sent = typeof navigator !== "undefined" && navigator.sendBeacon
        ? navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))
        : false;

    if (!sent) {
        // Fallback to keepalive fetch
        fetch(ENDPOINT, {
            method: "POST",
            body,
            headers: { "Content-Type": "application/json" },
            keepalive: true
        }).catch(() => {
            // Tracking must never throw
        });
    }
}

function flush(): void {
    if (queue.length === 0) return;

    // Greedy split so each request stays under the size limit.
    let chunk: QueuedEvent[] = [];
    for (const event of queue.splice(0, queue.length)) {
        const next = [...chunk, event];
        if (chunk.length > 0 && JSON.stringify(buildBatch(next)).length > MAX_BATCH_BYTES) {
            send(JSON.stringify(buildBatch(chunk)));
            chunk = [event];
        } else {
            chunk = next;
        }
    }
    const body = JSON.stringify(buildBatch(chunk));
    // A single event that is still too big would be rejected anyway.
    if (body.length <= MAX_BATCH_BYTES) send(body);
}

function scheduleFlush(): void {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flush();
    }, FLUSH_INTERVAL_MS);
}

/** Set from pagehide until the page is shown again (back/forward cache). */
let leaving = false;

// Flush on page hide. Events tracked after this (e.g. page_exit, which Chrome's
// visibilitychange delivers after pagehide) are sent at once by track().
if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => {
        leaving = true;
        flush();
    }, { passive: true });
    window.addEventListener("pageshow", () => {
        leaving = false;
    }, { passive: true });
    // Also flush on visibility change (mobile backgrounding)
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
    }, { passive: true });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sets the page that following events belong to. `referrer` is attached to
 * the next event only (the landing pageview), so client-side navigations are
 * not credited to the original external referrer again.
 */
export function setTrackingPath(path: string, referrer?: string): void {
    currentPath = path;
    pendingReferrer = referrer || undefined;
}

/**
 * Marks `path` as having rendered the 404 screen: events for it, including
 * ones still queued, are stored with page_type "404".
 */
export function markNotFound(path: string): void {
    notFoundPath = path;
    for (const event of queue) {
        if (event.path === path) event.notFound = true;
    }
}

function utmParams(): Pick<QueuedEvent, "utmSource" | "utmMedium" | "utmCampaign"> {
    if (typeof window === "undefined") return {};
    const params = new URLSearchParams(window.location.search);
    return {
        utmSource: params.get("utm_source")?.slice(0, 256) || undefined,
        utmMedium: params.get("utm_medium")?.slice(0, 256) || undefined,
        utmCampaign: params.get("utm_campaign")?.slice(0, 256) || undefined
    };
}

/**
 * Push an event onto the queue. Flushed after 2 s, when queue reaches 10,
 * or on page hide. No-ops when the visitor has opted out.
 */
export function track(name: string, props: Record<string, unknown> = {}): void {
    if (isOptedOut()) return;

    const event: QueuedEvent = { name, props, path: currentPath, ...utmParams() };
    if (pendingReferrer) {
        event.referrer = pendingReferrer.slice(0, 1024);
        pendingReferrer = undefined;
    }
    if (notFoundPath === currentPath) event.notFound = true;

    queue.push(event);
    // A hidden or unloading page may never run the flush timer.
    if (queue.length >= FLUSH_THRESHOLD || leaving || document.visibilityState === "hidden") {
        if (flushTimer !== null) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        flush();
    } else {
        scheduleFlush();
    }
}
