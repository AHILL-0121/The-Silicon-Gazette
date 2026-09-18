"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { prefersReducedMotion } from "./motion";
import { scrollToTarget } from "./SmoothScroll";

export interface SectionLink {
  id: string;
  label: string;
  count?: number;
}

/**
 * Sticky table of contents for the edition. The active section is tracked
 * while scrolling, reflected in the URL hash (so a section can be shared and
 * Back returns to it), and marked by a sliding indicator.
 */
export function SectionNav({ sections }: { sections: SectionLink[] }) {
  const [active, setActive] = useState(sections[0]?.id);
  const listRef = useRef<HTMLUListElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const userNavigated = useRef(false);

  useEffect(() => {
    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter((el): el is HTMLElement => Boolean(el));
    const visible = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
          else visible.delete(entry.target.id);
        }
        const current = sections.find((section) => visible.has(section.id));
        if (!current) return;
        setActive(current.id);
        // Only rewrite the URL once the reader has scrolled or clicked, never on load.
        if (userNavigated.current && window.location.hash !== `#${current.id}`) {
          history.replaceState(null, "", `#${current.id}`);
        }
      },
      { rootMargin: "-30% 0px -60% 0px" }
    );
    elements.forEach((el) => observer.observe(el));

    const markScrolled = () => {
      userNavigated.current = true;
    };
    window.addEventListener("wheel", markScrolled, { passive: true, once: true });
    window.addEventListener("touchmove", markScrolled, { passive: true, once: true });
    window.addEventListener("keydown", markScrolled, { once: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("wheel", markScrolled);
      window.removeEventListener("touchmove", markScrolled);
      window.removeEventListener("keydown", markScrolled);
    };
  }, [sections]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const indicator = indicatorRef.current;
    const link = list?.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (!list || !indicator || !link) return;

    const place = () => {
      indicator.style.transform = `translateX(${link.offsetLeft}px)`;
      indicator.style.width = `${link.offsetWidth}px`;
      indicator.style.opacity = "1";
    };
    place();

    const scroller = list.parentElement;
    if (scroller) {
      const target = link.offsetLeft - scroller.clientWidth / 2 + link.offsetWidth / 2;
      scroller.scrollTo({ left: Math.max(0, target), behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }

    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [active]);

  return (
    <nav aria-label="Sections in this edition" className="sticky top-14 z-40 border-b border-rule bg-paper/85 backdrop-blur-md supports-[backdrop-filter]:bg-paper/70">
      <div className="page-x">
        <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
          <ul ref={listRef} className="relative flex w-max items-center gap-1 py-2">
            <span
              ref={indicatorRef}
              aria-hidden="true"
              className="absolute left-0 top-2 h-[calc(100%-1rem)] rounded-full bg-ink opacity-0 transition-[transform,width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
            />
            {sections.map((section) => {
              const isActive = section.id === active;
              return (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    data-section={section.id}
                    data-track="section_nav"
                    data-track-section={section.id}
                    aria-current={isActive ? "location" : undefined}
                    onClick={(event) => {
                      const target = document.getElementById(section.id);
                      if (!target) return;
                      event.preventDefault();
                      userNavigated.current = true;
                      history.pushState(null, "", `#${section.id}`);
                      setActive(section.id);
                      scrollToTarget(target, -110);
                      target.focus({ preventScroll: true });
                    }}
                    className={`relative inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition-colors duration-300 ${isActive ? "text-paper" : "text-ink-soft hover:text-ink"
                      }`}
                  >
                    {section.label}
                    {typeof section.count === "number" && (
                      <span className={`font-mono text-[0.6875rem] ${isActive ? "text-paper/70" : "text-muted"}`}>
                        {section.count}
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
