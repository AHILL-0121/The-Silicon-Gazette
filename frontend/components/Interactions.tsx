"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { loadGsap, prefersReducedMotion } from "./motion";

/**
 * Feeds the pointer position to `.spotlight` cards inside it as --mx/--my, so
 * one listener drives every card's glow.
 */
export function SpotlightArea({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || !window.matchMedia("(hover: hover)").matches) return;
    const onMove = (event: PointerEvent) => {
      const card = (event.target as HTMLElement).closest<HTMLElement>(".spotlight");
      if (!card || !root.contains(card)) return;
      const rect = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      card.style.setProperty("--my", `${event.clientY - rect.top}px`);
    };
    root.addEventListener("pointermove", onMove);
    return () => root.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

/**
 * Staggered fade-up for every `[data-reveal]` element below the fold, batched
 * with ScrollTrigger. Elements already on screen are left alone so nothing
 * flashes, and nothing is hidden when motion is reduced or JS never runs.
 */
export function ScrollReveal({ selector = "[data-reveal]" }: { selector?: string }) {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let cleanup: (() => void) | undefined;
    let disposed = false;
    void loadGsap().then(({ gsap, ScrollTrigger }) => {
      if (disposed) return;
      // Measured after GSAP loads, so anything the reader already scrolled to stays visible.
      const fold = window.innerHeight * 0.95;
      const targets = gsap.utils.toArray<HTMLElement>(selector).filter((el) => el.getBoundingClientRect().top > fold);
      if (targets.length === 0) return;

      gsap.set(targets, { opacity: 0, y: 28 });
      const triggers = ScrollTrigger.batch(targets, {
        start: "top 92%",
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, {
            opacity: 1,
            y: 0,
            duration: 0.8,
            ease: "power3.out",
            stagger: 0.07,
            overwrite: true,
            // Hand transforms back to CSS so hover lift keeps working.
            clearProps: "opacity,transform"
          })
      });
      cleanup = () => {
        triggers.forEach((trigger) => trigger.kill());
        gsap.set(targets, { clearProps: "opacity,transform" });
      };
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [selector]);

  return null;
}
