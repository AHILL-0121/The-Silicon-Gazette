"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { track, setTrackingPath } from "@/lib/analytics/client";

// ---------------------------------------------------------------------------
// Delegated click handler
// ---------------------------------------------------------------------------

/** `data-track-*` props that are numbers; everything else stays a string. */
const NUMERIC_PROPS = new Set(["position"]);

function handleDelegatedClick(event: MouseEvent) {
    const target = (event.target as Element | null)?.closest?.("[data-track]");
    if (!target) return;

    const name = target.getAttribute("data-track");
    if (!name) return;

    const props: Record<string, unknown> = {};
    for (const attr of Array.from(target.attributes)) {
        if (attr.name.startsWith("data-track-")) {
            const key = attr.name.slice("data-track-".length).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
            const numVal = Number(attr.value);
            props[key] = NUMERIC_PROPS.has(key) && Number.isFinite(numVal) ? numVal : attr.value;
        }
    }
    track(name, props);
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------
const DEPTH_THRESHOLDS = [25, 50, 75, 100] as const;
const COMPLETE_DEPTH = 90;
const COMPLETE_MS = 20_000;

function scrollDepth(): number {
    const total = document.documentElement.scrollHeight;
    if (total <= 0) return 0;
    return Math.min(100, Math.round(((window.scrollY + window.innerHeight) / total) * 100));
}

export function Tracker() {
    const pathname = usePathname();
    const prevPath = useRef<string | null>(null);
    const visibleStart = useRef<number>(Date.now());
    const visibleMs = useRef<number>(0);
    const maxDepth = useRef(0);
    const depthFired = useRef<Set<number>>(new Set());
    const completed = useRef(false);
    const exitSent = useRef(false);
    const isStoryPage = pathname.includes("/story/");
    const isAnalytics = pathname.startsWith("/analytics");

    /** Visible time on the current page so far. */
    const visibleSoFar = () =>
        visibleMs.current + (document.visibilityState === "visible" ? Date.now() - visibleStart.current : 0);

    /** One page_exit per page view, for the page the events belong to. */
    const sendExit = () => {
        if (exitSent.current || prevPath.current === null) return;
        exitSent.current = true;
        track("page_exit", {
            seconds: Math.round(visibleSoFar() / 1000),
            max_depth: maxDepth.current
        });
    };

    // Page view on route change
    useEffect(() => {
        // Skip /analytics to avoid tracking the owner's own dashboard sessions
        if (isAnalytics) {
            sendExit();
            return;
        }
        if (prevPath.current === pathname) return;

        // Exit for the previous page, recorded against the previous path.
        sendExit();

        const isLanding = prevPath.current === null;
        prevPath.current = pathname;
        visibleStart.current = Date.now();
        visibleMs.current = 0;
        maxDepth.current = 0;
        depthFired.current = new Set();
        completed.current = false;
        exitSent.current = false;
        // Only the landing page view carries the external referrer.
        setTrackingPath(pathname, isLanding ? document.referrer : undefined);

        // The streamed <title> may not be in the document yet; it's optional.
        track("pageview", document.title ? { title: document.title.slice(0, 300) } : {});
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sendExit only reads refs
    }, [pathname, isAnalytics]);

    // Visibility tracking
    useEffect(() => {
        if (isAnalytics) return;

        const onVisChange = () => {
            if (document.visibilityState === "hidden") {
                visibleMs.current += Date.now() - visibleStart.current;
                // The tab may never come back (mobile backgrounding, closing).
                sendExit();
            } else {
                visibleStart.current = Date.now();
            }
        };

        // Leaving by full navigation or closing the tab.
        const onPageHide = () => sendExit();

        document.addEventListener("visibilitychange", onVisChange, { passive: true });
        window.addEventListener("pagehide", onPageHide, { passive: true });
        return () => {
            document.removeEventListener("visibilitychange", onVisChange);
            window.removeEventListener("pagehide", onPageHide);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sendExit only reads refs
    }, [pathname, isAnalytics]);

    // Read depth + completion
    useEffect(() => {
        if (isAnalytics) return;

        let rafId = 0;
        let completeTimer: ReturnType<typeof setTimeout> | null = null;

        const tryComplete = () => {
            if (!isStoryPage || completed.current || maxDepth.current < COMPLETE_DEPTH) return;
            const elapsed = visibleSoFar();
            if (elapsed >= COMPLETE_MS) {
                completed.current = true;
                track("read_complete", { seconds: Math.round(elapsed / 1000) });
            } else if (completeTimer === null) {
                // Reached the end quickly: complete once the reader has spent 20 s here.
                completeTimer = setTimeout(() => {
                    completeTimer = null;
                    tryComplete();
                }, COMPLETE_MS - elapsed + 50);
            }
        };

        const measure = () => {
            const depth = scrollDepth();
            maxDepth.current = Math.max(maxDepth.current, depth);

            for (const threshold of DEPTH_THRESHOLDS) {
                if (maxDepth.current >= threshold && !depthFired.current.has(threshold)) {
                    depthFired.current.add(threshold);
                    track("read_depth", { depth: threshold });
                }
            }
            tryComplete();
        };

        const onScroll = () => {
            cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(measure);
        };

        // Short pages never scroll, so measure once without a scroll too, but
        // only after streamed content has settled: a loading shell is short
        // and would otherwise count as read to 100%.
        const measureSettled = () => {
            if (!document.querySelector("[data-page-loading]")) onScroll();
        };
        const settleTimer = setTimeout(() => {
            if (document.readyState === "complete") measureSettled();
            else window.addEventListener("load", measureSettled, { once: true });
        }, 1500);
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("load", measureSettled);
            clearTimeout(settleTimer);
            cancelAnimationFrame(rafId);
            if (completeTimer !== null) clearTimeout(completeTimer);
        };
    }, [pathname, isStoryPage, isAnalytics]);

    // Delegated click tracking
    useEffect(() => {
        if (isAnalytics) return;

        document.addEventListener("click", handleDelegatedClick, { passive: true });
        return () => document.removeEventListener("click", handleDelegatedClick);
    }, [isAnalytics]);

    return null;
}
