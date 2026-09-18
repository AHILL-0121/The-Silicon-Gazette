"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";

import { archiveHref } from "@/lib/archive-url";

export interface CategoryChip {
  value: string;
  label: string;
  count: number;
}

interface ArchiveControlsProps {
  q: string;
  category: string | null;
  chips: CategoryChip[];
  /** Matches for the current search, across all categories. */
  allCount: number;
  summary: string;
  children: ReactNode;
}

/**
 * Search box and category filter for the archive. State lives in the URL
 * (?q=&category=&page=), so results are server-rendered, shareable and work
 * without JavaScript (the form submits normally). With JavaScript, typing
 * updates the results after a short pause while the current list dims.
 */
export function ArchiveControls({ q, category, chips, allCount, summary, children }: ArchiveControlsProps) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const [pending, startTransition] = useTransition();
  const lastPushed = useRef(q);

  // Keep the box in sync when navigating back/forward.
  useEffect(() => {
    setValue(q);
    lastPushed.current = q;
  }, [q]);

  useEffect(() => {
    const next = value.trim();
    if (next === lastPushed.current.trim()) return;
    const timer = setTimeout(() => {
      lastPushed.current = next;
      startTransition(() => {
        router.replace(archiveHref({ q: next, category }), { scroll: false });
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [value, category, router]);

  const chip = (chipValue: string | null, label: string, count: number) => {
    const selected = category === chipValue;
    return (
      <Link
        key={chipValue ?? "all"}
        href={archiveHref({ q: value.trim() || null, category: chipValue })}
        scroll={false}
        aria-current={selected ? "true" : undefined}
        className={`chip shrink-0 transition-colors ${selected ? "border-ink bg-ink text-paper" : "hover:border-ink hover:text-ink"}`}
      >
        {label}
        <span className={selected ? "text-paper/70" : "text-muted"}>{count}</span>
      </Link>
    );
  };

  return (
    <div>
      <div className="sticky top-14 z-30 -mx-4 border-b border-rule bg-paper/90 px-4 py-4 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
          <form action="/archive" method="get" role="search" className="relative block lg:w-96" onSubmit={(event) => {
            event.preventDefault();
            lastPushed.current = value.trim();
            startTransition(() => router.replace(archiveHref({ q: value.trim(), category }), { scroll: false }));
          }}>
            <label htmlFor="archive-search" className="sr-only">
              Search the archive
            </label>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="absolute left-4 top-1/2 -translate-y-1/2 text-muted">
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              id="archive-search"
              type="search"
              name="q"
              value={value}
              maxLength={100}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Search headlines, companies, dates…"
              className="h-11 w-full rounded-full border border-rule bg-surface pl-11 pr-10 text-sm text-ink placeholder:text-muted focus:border-ink focus:outline-none"
            />
            {category && <input type="hidden" name="category" value={category} />}
            {pending && (
              <span
                aria-hidden="true"
                className="absolute right-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-rule border-t-signal"
              />
            )}
          </form>
          <nav aria-label="Filter by lead story category" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
            {chip(null, "All", allCount)}
            {chips.map((item) => chip(item.value, item.label, item.count))}
          </nav>
        </div>
        <p className="label mt-3" aria-live="polite">
          {pending ? "Searching…" : summary}
        </p>
      </div>
      <div aria-busy={pending} className={`transition-opacity duration-200 ${pending ? "opacity-50" : "opacity-100"}`}>
        {children}
      </div>
    </div>
  );
}
