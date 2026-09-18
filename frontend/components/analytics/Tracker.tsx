"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { track, setTrackingPath } from "@/lib/analytics/client";

// ---------------------------------------------------------------------------
// Delegated click handler
// ---------------------------------------------------------------------------
function handleDelegatedClick(event: MouseEvent) {
    const target = (event.target as Element).closest("[data-track]");
    if (!target) return;

    const name = target.getAttribute("data-track");
    if (!name) return;

    const props: Record<string, unknown> = {};
    for (const attr of Array.from(target.attributes)) {
        if (attr.name.startsWith("data-track-") && attr.name !== "data-track") {
            const key = attr.name.slice("data-track-".length).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
            const numVal = parseFloat(attr.value);
            props[key] = isNaN(numVal) ? attr.value : numVal;
        }
    }
    track(name, props);
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------
const DEPTH_THRESHOLDS = [25, 50, 75, 100] as const;

export function Tracker() {
    const pathname = usePathname();
    const prevPath = useRef<string | null>(null);
    const pageStart = useRef<number>(Date.now());
    const visibleStart = useRef<number>(Date.now());
    const visibleMs = useRef<number>(0);
    const depthFired = useRef<Set<number>>(new Set());
    const isStoryPage = pathname.includes("/story/");

    // Page view on route change
    useEffect(() => {
        // Skip /analytics to avoid tracking the owner's own dashboard sessions
        if (pathname.startsWith("/analytics")) return;
        if (prevPath.current === pathname) return;

        // Page exit for the previous page
        if (prevPath.current !== null) {
            const totalVisible = visibleMs.current + (document.visibilityState === "visible" ? Date.now() - visibleStart.current : 0);
            track("page_exit", {
                seconds: Math.round(totalVisible / 1000),
                max_depth: 0 // simplified; full depth tracking below
            });
        }

        prevPath.current = pathname;
        pageStart.current = Date.now();
        visibleStart.current = Date.now();
        visibleMs.current = 0;
        depthFired.current = new Set();
        setTrackingPath(pathname, document.referrer);

        track("pageview", { title: document.title });
    }, [pathname]);

    // Visibility tracking
    useEffect(() => {
        if (pathname.startsWith("/analytics")) return;

        const onVisChange = () => {
            if (document.visibilityState === "hidden") {
                visibleMs.current += Date.now() - visibleStart.current;
                // page_exit on hide (for mobile backgrounding)
                const depth = maxDepthReached.current;
                track("page_exit", {
                    seconds: Math.round(visibleMs.current / 1000),
                    max_depth: depth
                });
            } else {
                visibleStart.current = Date.now();
            }
        };

        document.addEventListener("visibilitychange", onVisChange, { passive: true });
        return () => document.removeEventListener("visibilitychange", onVisChange);
    }, [pathname]);

    const maxDepthReached = useRef(0);

    // Read depth tracking
    useEffect(() => {
        if (pathname.startsWith("/analytics")) return;

        let rafId: number;
        const onScroll = () => {
            cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                const scrolled = window.scrollY + window.innerHeight;
                const total = document.documentElement.scrollHeight;
                const depth = total > 0 ? Math.round((scrolled / total) * 100) : 0;
                maxDepthReached.current = Math.max(maxDepthReached.current, depth);

                for (const threshold of DEPTH_THRESHOLDS) {
                    if (depth >= threshold && !depthFired.current.has(threshold)) {
                        depthFired.current.add(threshold);
                        track("read_depth", { depth: threshold });
                    }
                }

                // read_complete: story page, 90%+ depth, 20+ s visible
                if (
                    isStoryPage &&
                    depth >= 90 &&
                    !depthFired.current.has(-1) // sentinel for complete
                ) {
                    const elapsed = visibleMs.current + (Date.now() - visibleStart.current);
                    if (elapsed >= 20_000) {
                        depthFired.current.add(-1);
                        track("read_complete", { seconds: Math.round(elapsed / 1000) });
                    }
                }
            });
        };

        window.addEventListener("scroll", onScroll, { passive: true });
        return () => {
            window.removeEventListener("scroll", onScroll);
            cancelAnimationFrame(rafId);
        };
    }, [pathname, isStoryPage]);

    // Delegated click tracking
    useEffect(() => {
        if (pathname.startsWith("/analytics")) return;

        document.addEventListener("click", handleDelegatedClick, { passive: true });
        return () => document.removeEventListener("click", handleDelegatedClick);
    }, [pathname]);

    return null;
}
