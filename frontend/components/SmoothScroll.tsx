"use client";

import type Lenis from "lenis";
import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { loadGsap } from "./motion";

let lenis: Lenis | null = null;

/** The active Lenis instance, or null when smooth scrolling is off (reduced motion). */
export function getLenis(): Lenis | null {
  return lenis;
}

/** Scrolls to an element or offset, smoothly when allowed. */
export function scrollToTarget(target: HTMLElement | number, offset = 0): void {
  if (lenis) {
    lenis.scrollTo(target, { offset });
    return;
  }
  const top = typeof target === "number" ? target : target.getBoundingClientRect().top + window.scrollY + offset;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
}

/**
 * Lenis smooth scrolling driven by the GSAP ticker so ScrollTrigger animations
 * stay in sync. Both libraries load after the page is interactive (native
 * scrolling works until then). Disabled entirely for prefers-reduced-motion.
 */
export function SmoothScroll({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let removeTick: (() => void) | null = null;

    async function start() {
      if (lenis || motion.matches) return;
      const [{ gsap, ScrollTrigger }, { default: LenisClass }] = await Promise.all([loadGsap(), import("lenis")]);
      if (disposed || lenis || motion.matches) return;
      lenis = new LenisClass({ duration: 1.05, anchors: { offset: -96 } });
      lenis.on("scroll", ScrollTrigger.update);
      const onTick = (time: number) => lenis?.raf(time * 1000);
      gsap.ticker.add(onTick);
      gsap.ticker.lagSmoothing(0);
      removeTick = () => gsap.ticker.remove(onTick);
    }

    function stop() {
      removeTick?.();
      removeTick = null;
      lenis?.destroy();
      lenis = null;
    }

    const onChange = () => (motion.matches ? stop() : void start());
    void start();
    motion.addEventListener("change", onChange);
    return () => {
      disposed = true;
      motion.removeEventListener("change", onChange);
      stop();
    };
  }, []);

  // New page: start at the top and let ScrollTrigger re-measure.
  useEffect(() => {
    if (!window.location.hash) lenis?.scrollTo(0, { immediate: true });
    let id = 0;
    void loadGsap().then(({ ScrollTrigger }) => {
      id = requestAnimationFrame(() => ScrollTrigger.refresh());
    });
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  return <>{children}</>;
}
