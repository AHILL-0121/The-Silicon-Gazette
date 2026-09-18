"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { CommandPalette, openCommandPalette, type CommandEntry } from "./CommandPalette";
import { ReadingProgress } from "./ReadingProgress";
import { ThemeToggle } from "./ThemeToggle";

interface SiteHeaderProps {
  entries: CommandEntry[];
  /**
   * id of the large masthead on the page. While it is on screen the compact
   * wordmark stays hidden, then slides in once the masthead scrolls away.
   */
  mastheadId?: string;
  dateline?: string;
}

export function SiteHeader({ entries, mastheadId, dateline }: SiteHeaderProps) {
  const pathname = usePathname();
  const [showMark, setShowMark] = useState(!mastheadId);

  useEffect(() => {
    if (!mastheadId) return;
    const masthead = document.getElementById(mastheadId);
    if (!masthead) {
      setShowMark(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setShowMark(!entry.isIntersecting), {
      rootMargin: "-56px 0px 0px 0px"
    });
    observer.observe(masthead);
    return () => observer.disconnect();
  }, [mastheadId]);

  const navLink = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
        active ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"
      }`}
    >
      {label}
    </Link>
  );

  // The palette renders outside <header>: backdrop-filter would otherwise
  // become the containing block for its fixed overlay.
  return (
    <>
      <header className="sticky top-0 z-50 border-b border-rule bg-paper/85 backdrop-blur-md supports-[backdrop-filter]:bg-paper/70">
        <div className="page-x flex h-14 items-center gap-3">
          <Link
            href="/"
            aria-label="The Silicon Gazette, today's edition"
            className={`flex min-w-0 items-baseline gap-3 transition-all duration-500 ${
              showMark ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0"
            }`}
            tabIndex={showMark ? undefined : -1}
          >
            <span className="whitespace-nowrap font-display text-[1.55rem] leading-none">
              The <em className="text-signal">Silicon</em> Gazette
            </span>
            {dateline && <span className="label hidden truncate lg:inline">{dateline}</span>}
          </Link>

          <nav aria-label="Primary" className="ml-auto hidden items-center gap-1 sm:flex">
            {navLink("/", "Today", pathname.startsWith("/gazette"))}
            {navLink("/archive", "Archive", pathname.startsWith("/archive"))}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:ml-2">
            <button
              type="button"
              onClick={openCommandPalette}
              className="group inline-flex h-9 items-center gap-2 rounded-full border border-rule pl-3 pr-2 text-sm text-muted transition-colors hover:border-ink hover:text-ink"
              aria-label="Search (press / or Ctrl K)"
              aria-keyshortcuts="/ Control+K Meta+K"
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <span className="hidden md:inline">Search</span>
              <kbd className="hidden rounded border border-rule px-1.5 font-mono text-[0.6875rem] md:inline">/</kbd>
            </button>
            <Link href="/archive" className="icon-btn sm:hidden" aria-label="Archive">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2.5 4.5h11M3.5 4.5v8h9v-8M6.5 7.5h3M2 2.5h12v2H2z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
            </Link>
            <ThemeToggle />
          </div>
        </div>
        <ReadingProgress />
      </header>
      <CommandPalette entries={entries} />
    </>
  );
}
