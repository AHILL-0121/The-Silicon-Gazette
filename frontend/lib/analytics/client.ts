"use client";

import type { TrackBatch } from "./events";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ENDPOINT = "/api/track";
const FLUSH_INTERVAL_MS = 2_000;
const FLUSH_THRESHOLD = 10;
const SID_KEY = "sg-sid";
const OPT_OUT_KEY = "sg-analytics-optout";

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------
interface QueuedEvent {
    name: string;
    props: Record<string, unknown>;
}

const queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let currentPath = "/";
let currentReferrer = "";

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
    const params = new URLSearchParams(window.location.search);
    return {
        events: events as TrackBatch["events"],
        path: currentPath,
        sessionId: getSessionId(),
        referrer: currentReferrer || document.referrer || undefined,
        utmSource: params.get("utm_source") ?? undefined,
        utmMedium: params.get("utm_medium") ?? undefined,
        utmCampaign: params.get("utm_campaign") ?? undefined
    };
}

function flush(): void {
    if (queue.length === 0) return;

    const toSend = queue.splice(0, queue.length);
    const body = JSON.stringify(buildBatch(toSend));

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

function scheduleFlush(): void {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        flush();
    }, FLUSH_INTERVAL_MS);
}

// Flush on page hide
if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => flush(), { passive: true });
    // Also flush on visibility change (mobile backgrounding)
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
    }, { passive: true });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function setTrackingPath(path: string, referrer?: string): void {
    currentPath = path;
    if (referrer !== undefined) currentReferrer = referrer;
}

/**
 * Push an event onto the queue. Flushed after 2 s, when queue reaches 10,
 * or on page hide. No-ops when the visitor has opted out.
 */
export function track(name: string, props: Record<string, unknown> = {}): void {
    if (isOptedOut()) return;
    queue.push({ name, props });
    if (queue.length >= FLUSH_THRESHOLD) {
        if (flushTimer !== null) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        flush();
    } else {
        scheduleFlush();
    }
}
