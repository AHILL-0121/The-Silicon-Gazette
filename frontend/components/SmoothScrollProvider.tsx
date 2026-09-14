"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

interface Props {
    children: ReactNode;
}

export function SmoothScrollProvider({ children }: Props) {
    useEffect(() => {
        // Respect prefers-reduced-motion
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduced) return;

        let lenis: import("lenis").default | null = null;

        async function init() {
            const { default: Lenis } = await import("lenis");
            lenis = new Lenis({
                duration: 1.1,
                easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
                smoothWheel: true,
                wheelMultiplier: 0.9,
                touchMultiplier: 1.5,
            });

            // Sync Lenis raf with GSAP ticker so ScrollTrigger works perfectly
            gsap.ticker.add((time) => {
                lenis?.raf(time * 1000);
            });
            gsap.ticker.lagSmoothing(0);

            // Wire Lenis scroll events into ScrollTrigger
            lenis.on("scroll", ScrollTrigger.update);
            ScrollTrigger.scrollerProxy(document.body, {
                scrollTop(value) {
                    if (arguments.length && typeof value === "number") {
                        lenis?.scrollTo(value, { immediate: true });
                    }
                    return lenis?.scroll ?? window.scrollY;
                },
                getBoundingClientRect() {
                    return {
                        top: 0,
                        left: 0,
                        width: window.innerWidth,
                        height: window.innerHeight,
                    };
                },
            });
        }

        init();

        return () => {
            lenis?.destroy();
            gsap.ticker.remove(() => { });
            ScrollTrigger.clearScrollMemory();
        };
    }, []);

    return <>{children}</>;
}
