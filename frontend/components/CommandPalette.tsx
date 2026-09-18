"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { track } from "@/lib/analytics/client";
import { getLenis, scrollToTarget } from "./SmoothScroll";

export type CommandGroup = "Sections" | "Stories" | "Repositories" | "Editions" | "Go to";

export interface CommandEntry {
  id: string;
  label: string;
  hint?: string;
  href: string;
  group: CommandGroup;
}

const GROUP_ORDER: CommandGroup[] = ["Sections", "Stories", "Repositories", "Editions", "Go to"];

function score(entry: CommandEntry, terms: string[]): number {
  if (terms.length === 0) return 1;
  const label = entry.label.toLowerCase();
  const haystack = `${label} ${entry.hint?.toLowerCase() ?? ""} ${entry.group.toLowerCase()}`;
  let total = 0;
  for (const term of terms) {
    if (!haystack.includes(term)) return 0;
    total += label.startsWith(term) ? 3 : label.includes(term) ? 2 : 1;
  }
  return total;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)));
}

/** Opens the palette from any button. */
export function openCommandPalette(): void {
  window.dispatchEvent(new Event("sg:open-palette"));
}

/**
 * Ctrl/⌘ K or "/" command palette to jump to any section, story, repository
 * or edition. Modelled on 21st.dev's Command Palette, built as an accessible
 * combobox driving a listbox.
 */
export function CommandPalette({ entries }: { entries: CommandEntry[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const listId = useId();

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const ranked = entries
      .map((entry) => ({ entry, score: score(entry, terms) }))
      .filter((item) => item.score > 0);
    if (terms.length > 0) ranked.sort((a, b) => b.score - a.score);
    // Groups stay together in a fixed order; rank is kept inside each group.
    return GROUP_ORDER.flatMap((group) =>
      ranked.filter((item) => item.entry.group === group).map((item) => item.entry)
    ).slice(0, 50);
  }, [entries, query]);

  const openPalette = useCallback((via: "ctrl_k" | "slash" | "button" = "button") => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    setOpen(true);
    track("palette_open", { via });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    returnFocus.current?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) close();
        else openPalette("ctrl_k");
      } else if (
        event.key === "/" &&
        !open &&
        !isTypingTarget(event.target) &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        openPalette("slash");
      }
    };
    const onOpenPalette = () => openPalette("button");
    window.addEventListener("keydown", onKey);
    window.addEventListener("sg:open-palette", onOpenPalette);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("sg:open-palette", onOpenPalette);
    };
  }, [open, close, openPalette]);

  useEffect(() => {
    if (!open) return;
    getLenis()?.stop();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      getLenis()?.start();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(entry: CommandEntry) {
    track("palette_search", { results: results.length, chose: true });
    setOpen(false);
    if (entry.href.startsWith("#")) {
      const target = document.getElementById(entry.href.slice(1));
      if (target) {
        history.replaceState(null, "", entry.href);
        scrollToTarget(target, -96);
        target.focus({ preventScroll: true });
      }
      return;
    }
    if (/^https?:\/\//.test(entry.href)) {
      window.open(entry.href, "_blank", "noopener,noreferrer");
      return;
    }
    router.push(entry.href);
  }

  function onInputKey(event: React.KeyboardEvent<HTMLInputElement>) {
    const count = results.length;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((index) => (count ? (index + 1) % count : 0));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((index) => (count ? (index - 1 + count) % count : 0));
        break;
      case "Enter": {
        event.preventDefault();
        const entry = results[active];
        if (entry) choose(entry);
        break;
      }
      case "Escape":
        event.preventDefault();
        close();
        break;
      case "Tab":
        // Focus stays inside the dialog; the input is its only tab stop.
        event.preventDefault();
        break;
    }
  }

  if (!open) return null;

  let lastGroup: CommandGroup | null = null;
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-3 pt-[12vh]">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={close} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="relative w-full max-w-xl animate-fade-up overflow-hidden rounded-2xl border border-rule bg-surface shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b border-rule px-4">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0 text-muted">
            <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onInputKey}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
            aria-autocomplete="list"
            aria-label="Search stories, sections and repositories"
            placeholder="Search stories, sections, repos…"
            className="h-14 w-full bg-transparent text-base text-ink placeholder:text-muted focus:outline-none"
          />
          <kbd className="label rounded border border-rule px-1.5 py-1">Esc</kbd>
        </div>

        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Results"
          className="max-h-[55vh] overflow-y-auto overscroll-contain p-2"
          data-lenis-prevent
        >
          {results.length === 0 && (
            <li role="presentation" className="px-3 py-8 text-center text-sm text-muted">
              Nothing matches &ldquo;{query}&rdquo;.
            </li>
          )}
          {results.map((entry, index) => {
            const heading = entry.group !== lastGroup ? entry.group : null;
            lastGroup = entry.group;
            const selected = index === active;
            return (
              <li key={entry.id} role="presentation">
                {heading && (
                  <p className="label px-3 pb-2 pt-3" aria-hidden="true">
                    {heading}
                  </p>
                )}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(entry)}
                  className={`flex cursor-pointer items-center justify-between gap-4 rounded-lg px-3 py-2.5 ${selected ? "bg-ink text-paper" : "text-ink"
                    }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{entry.label}</span>
                    {entry.hint && (
                      <span className={`block truncate text-xs ${selected ? "text-paper/70" : "text-muted"}`}>
                        {entry.hint}
                      </span>
                    )}
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-xs opacity-60">
                    {/^https?:/.test(entry.href) ? "↗" : "↵"}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="hidden items-center gap-4 border-t border-rule px-4 py-2.5 text-xs text-muted sm:flex">
          <span>
            <kbd className="font-mono">↑↓</kbd> move
          </span>
          <span>
            <kbd className="font-mono">↵</kbd> open
          </span>
          <span className="ml-auto">
            <kbd className="font-mono">/</kbd> or <kbd className="font-mono">Ctrl K</kbd> from anywhere
          </span>
        </div>
      </div>
    </div>
  );
}
