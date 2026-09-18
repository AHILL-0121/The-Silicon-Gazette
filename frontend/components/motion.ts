"use client";

import type { gsap as Gsap } from "gsap";
import type { ScrollTrigger as ScrollTriggerType } from "gsap/ScrollTrigger";

export interface GsapBundle {
  gsap: typeof Gsap;
  ScrollTrigger: typeof ScrollTriggerType;
}

let loading: Promise<GsapBundle> | null = null;

/**
 * GSAP and ScrollTrigger are loaded on demand, after the page has rendered
 * and hydrated, so they are not part of the initial JavaScript. Every caller
 * shares one download and the plugin is registered once.
 */
export function loadGsap(): Promise<GsapBundle> {
  loading ??= Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([core, plugin]) => {
    core.gsap.registerPlugin(plugin.ScrollTrigger);
    return { gsap: core.gsap, ScrollTrigger: plugin.ScrollTrigger };
  });
  return loading;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
