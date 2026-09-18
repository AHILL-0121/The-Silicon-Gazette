"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { loadGsap, prefersReducedMotion } from "./motion";
import { getLenis } from "./SmoothScroll";

interface WireItem {
  href: string;
  label: string;
  kicker: string;
}

/**
 * Scrolling wire of the day's headlines (after 21st.dev's Marquee). A GSAP
 * loop that speeds up with Lenis scroll velocity, eases to a stop on hover or
 * keyboard focus, has an explicit pause button (WCAG 2.2.2), and is a static
 * scrollable row under reduced motion.
 */
export function WireTicker({ items }: { items: WireItem[] }) {
  const track = useRef<HTMLDivElement>(null);
  const tween = useRef<gsap.core.Tween | null>(null);
  const [paused, setPaused] = useState(false);
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    if (!prefersReducedMotion() && items.length > 0) setAnimated(true);
  }, [items]);

  // Read inside the GSAP ticker, so refs rather than state.
  const hovered = useRef(false);
  const pausedRef = useRef(false);

  useEffect(() => {
    const first = track.current?.firstElementChild as HTMLElement | null;
    if (!animated || !track.current || !first) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    const element = track.current;
    void loadGsap().then(({ gsap }) => {
      if (disposed) return;
      const width = first.offsetWidth;
      const loop = gsap.to(element, {
        x: -width,
        duration: width / 45,
        ease: "none",
        repeat: -1
      });
      tween.current = loop;

      // Each frame, ease the loop's speed toward its target: stopped while
      // hovered, focused or paused; otherwise 1x plus a boost from how fast the
      // reader is scrolling (Lenis velocity), so the wire rushes past when you
      // fling the page and settles back when you stop.
      const drive = () => {
        const velocity = Math.abs(getLenis()?.velocity ?? 0);
        const target = hovered.current || pausedRef.current ? 0 : 1 + Math.min(velocity / 6, 5);
        const current = loop.timeScale();
        loop.timeScale(current + (target - current) * 0.08);
      };
      gsap.ticker.add(drive);
      cleanup = () => {
        gsap.ticker.remove(drive);
        loop.kill();
        tween.current = null;
      };
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [animated]);

  const setHovered = (value: boolean) => {
    hovered.current = value;
  };

  const togglePause = () => {
    const next = !paused;
    pausedRef.current = next;
    setPaused(next);
  };

  if (items.length === 0) return null;

  const renderItems = (copy: number) =>
    items.map((item, index) => (
      <li
        key={`${copy}-${item.href}`}
        className="flex shrink-0 items-center gap-3 pr-8"
        aria-hidden={copy === 1 || undefined}
      >
        <span className="label text-signal">{item.kicker}</span>
        <Link
          href={item.href}
          tabIndex={copy === 1 ? -1 : undefined}
          className="whitespace-nowrap font-serif text-[1.05rem] text-ink hover:text-signal"
        >
          {item.label}
        </Link>
        {index < items.length && (
          <span aria-hidden="true" className="text-rule">
            ◆
          </span>
        )}
      </li>
    ));

  return (
    <section aria-label="The wire: today's headlines" className="border-y border-rule bg-surface/60">
      <div className="page-x flex items-center gap-4">
        <p className="label flex shrink-0 items-center gap-2 border-r border-rule py-3 pr-4 text-ink">
          <span className="inline-block h-1.5 w-1.5 animate-blink rounded-full bg-signal" aria-hidden="true" />
          The Wire
        </p>
        <div
          className={`relative min-w-0 flex-1 ${animated ? "overflow-hidden" : "no-scrollbar overflow-x-auto"}`}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
          style={
            animated ? { maskImage: "linear-gradient(90deg, transparent, #000 4%, #000 96%, transparent)" } : undefined
          }
        >
          <div ref={track} className="flex w-max py-3 will-change-transform">
            <ul className="flex">{renderItems(0)}</ul>
            {animated && <ul className="flex">{renderItems(1)}</ul>}
          </div>
        </div>
        {animated && (
          <button
            type="button"
            onClick={togglePause}
            className="icon-btn h-8 w-8 shrink-0"
            aria-pressed={paused}
            aria-label={paused ? "Play the wire" : "Pause the wire"}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" fill="currentColor">
              {paused ? <path d="M3 1.5v9l7-4.5z" /> : <path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" />}
            </svg>
          </button>
        )}
      </div>
    </section>
  );
}
