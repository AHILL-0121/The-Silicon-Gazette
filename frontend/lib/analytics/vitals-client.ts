"use client";

import { track } from "./client";

// ---------------------------------------------------------------------------
// Core Web Vitals, measured in the reader's browser with the standard
// PerformanceObserver entries (no library). One `web_vital` event per metric
// per page load: the metric name, a number and a good / needs-improvement /
// poor rating. Nothing else leaves the browser: no element selectors, URLs or
// identifiers. Opt-out, DNT and GPC apply exactly as for every other event.
// ---------------------------------------------------------------------------

export const VITAL_THRESHOLDS = {
    LCP: [2500, 4000],
    INP: [200, 500],
    CLS: [0.1, 0.25],
    FCP: [1800, 3000],
    TTFB: [800, 1800]
} as const;

export type VitalName = keyof typeof VITAL_THRESHOLDS;

function rate(name: VitalName, value: number): "good" | "needs-improvement" | "poor" {
    const [good, poor] = VITAL_THRESHOLDS[name];
    return value <= good ? "good" : value <= poor ? "needs-improvement" : "poor";
}

function observe(type: string, callback: (entries: PerformanceEntryList) => void, options: PerformanceObserverInit = {}): PerformanceObserver | null {
    try {
        const observer = new PerformanceObserver((list) => callback(list.getEntries()));
        observer.observe({ type, buffered: true, ...options } as PerformanceObserverInit);
        return observer;
    } catch {
        return null; // entry type not supported by this browser
    }
}

/**
 * Starts measuring for the current page load and reports when the page is
 * first hidden (the moment LCP, CLS and INP are final). Returns a cleanup.
 * `path` is the landing path, so a later client-side navigation can't be blamed.
 */
export function startVitals(path: string): () => void {
    if (typeof window === "undefined" || typeof PerformanceObserver === "undefined") return () => undefined;

    const values: Partial<Record<VitalName, number>> = {};
    let reported = false;

    const cleanups: Array<() => void> = [];
    const add = (observer: PerformanceObserver | null) => {
        if (observer) cleanups.push(() => observer.disconnect());
    };

    add(observe("largest-contentful-paint", (entries) => {
        const last = entries[entries.length - 1] as (PerformanceEntry & { startTime: number }) | undefined;
        if (last) values.LCP = last.startTime;
    }));

    let clsValue = 0;
    let clsSession = 0;
    let clsFirst = 0;
    let clsLast = 0;
    add(observe("layout-shift", (entries) => {
        for (const entry of entries as Array<PerformanceEntry & { value: number; hadRecentInput: boolean }>) {
            if (entry.hadRecentInput) continue;
            // Session windows: gaps under 1 s, windows under 5 s; CLS is the worst window.
            if (clsSession && entry.startTime - clsLast < 1000 && entry.startTime - clsFirst < 5000) {
                clsSession += entry.value;
            } else {
                clsSession = entry.value;
                clsFirst = entry.startTime;
            }
            clsLast = entry.startTime;
            clsValue = Math.max(clsValue, clsSession);
            values.CLS = clsValue;
        }
    }));

    const interactions = new Map<number, number>();
    add(observe("event", (entries) => {
        for (const entry of entries as Array<PerformanceEntry & { interactionId?: number; duration: number }>) {
            if (!entry.interactionId) continue;
            interactions.set(entry.interactionId, Math.max(interactions.get(entry.interactionId) ?? 0, entry.duration));
        }
        const durations = [...interactions.values()].sort((a, b) => b - a);
        // INP: the worst interaction, ignoring one outlier per 50 interactions.
        const index = Math.min(durations.length - 1, Math.floor(interactions.size / 50));
        if (index >= 0) values.INP = durations[index];
    }, { durationThreshold: 40 } as PerformanceObserverInit));

    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (nav && nav.responseStart > 0) values.TTFB = nav.responseStart;
    add(observe("paint", (entries) => {
        const fcp = entries.find((entry) => entry.name === "first-contentful-paint");
        if (fcp) values.FCP = fcp.startTime;
    }));

    const report = () => {
        if (reported) return;
        reported = true;
        for (const name of Object.keys(values) as VitalName[]) {
            const raw = values[name];
            if (raw === undefined || !Number.isFinite(raw) || raw < 0) continue;
            const value = name === "CLS" ? Math.round(raw * 1000) / 1000 : Math.round(raw);
            track("web_vital", { metric: name, value, rating: rate(name, value) }, path);
        }
    };

    const onHidden = () => {
        if (document.visibilityState === "hidden") report();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", report);
    cleanups.push(() => {
        document.removeEventListener("visibilitychange", onHidden);
        window.removeEventListener("pagehide", report);
    });

    return () => cleanups.forEach((fn) => fn());
}
