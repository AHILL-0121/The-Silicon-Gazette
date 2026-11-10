"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { pctChange } from "@/lib/analytics/range";
import { CLOCK_MODES, ZONES, shortDateTime, type ClockMode, type Zone } from "@/lib/analytics/timezone";

import { OPEN_PANEL_EVENT, qs, useApi, useDash, type Density } from "./ui";

// ---------------------------------------------------------------------------
// Jump to a section (opens it first if it was collapsed).
// ---------------------------------------------------------------------------
export function jumpTo(id: string) {
    window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: id }));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Wait a frame so a just-opened panel has its height before scrolling.
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
}

export interface SectionLink { id: string; label: string }

export function SectionNav({ sections }: { sections: SectionLink[] }) {
    const [active, setActive] = useState<string | null>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
                if (visible) setActive(visible.target.id);
            },
            { rootMargin: "-25% 0px -60% 0px" }
        );
        for (const s of sections) {
            const el = document.getElementById(s.id);
            if (el) observer.observe(el);
        }
        return () => observer.disconnect();
    }, [sections]);

    return (
        <nav aria-label="Sections" className="flex items-center gap-1 overflow-x-auto pb-2">
            {sections.map((s) => (
                <button key={s.id} type="button" onClick={() => jumpTo(s.id)} aria-current={active === s.id ? "true" : undefined}
                    className={`shrink-0 rounded-full px-3 py-1 text-xs transition-colors ${active === s.id ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"}`}>
                    {s.label}
                </button>
            ))}
        </nav>
    );
}

// ---------------------------------------------------------------------------
// Display controls: zone, clock, density, own-browser tracking.
// ---------------------------------------------------------------------------
function Segmented<T extends string>({ label, options, value, onChange, titles }: {
    label: string;
    options: readonly T[];
    value: T;
    onChange: (value: T) => void;
    titles?: Partial<Record<T, string>>;
}) {
    return (
        <div role="group" aria-label={label} className="flex items-center gap-1 rounded-xl border border-rule bg-surface p-1">
            {options.map((o) => (
                <button key={o} type="button" onClick={() => onChange(o)} aria-pressed={value === o} title={titles?.[o]}
                    className={`shrink-0 rounded-lg px-3 py-1.5 font-mono text-xs font-medium transition-colors ${value === o ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"}`}>
                    {o}
                </button>
            ))}
        </div>
    );
}

export interface DisplayState {
    zone: Zone; clock: ClockMode; density: Density; optOut: boolean;
    setZone: (z: Zone) => void; setClock: (c: ClockMode) => void; setDensity: (d: Density) => void; setOptOut: (v: boolean) => void;
}

const DENSITIES = ["comfortable", "compact"] as const;

export function DisplayControls({ d, stacked }: { d: DisplayState; stacked?: boolean }) {
    return (
        <div className={stacked ? "flex flex-col items-start gap-3" : "flex flex-wrap items-center gap-2"}>
            <Segmented label="Time zone for displayed times" options={ZONES} value={d.zone} onChange={d.setZone}
                titles={{ IST: "India Standard Time, UTC+05:30", UTC: "Coordinated Universal Time" }} />
            <Segmented label="Clock format" options={CLOCK_MODES} value={d.clock} onChange={d.setClock}
                titles={{ "12h": "12-hour clock (2:30 PM)", "24h": "24-hour clock (14:30)" }} />
            <Segmented label="Table density" options={DENSITIES} value={d.density} onChange={d.setDensity} />
            <label className="flex items-center gap-2 text-xs text-ink-soft">
                <input type="checkbox" checked={d.optOut} onChange={(e) => d.setOptOut(e.target.checked)} />
                Don&apos;t count this browser
            </label>
        </div>
    );
}

/** Phone layout: the display controls live behind one button. */
export function DisplayMenu({ d }: { d: DisplayState }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
    }, [open]);
    return (
        <div ref={ref} className="relative">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog"
                className="rounded-xl border border-rule bg-surface px-3 py-2 font-mono text-xs text-ink-soft hover:text-ink">
                {d.zone} · {d.clock} ▾
            </button>
            {open && (
                <div role="dialog" aria-label="Display settings" className="absolute right-0 top-full z-[60] mt-2 w-72 rounded-2xl border border-rule bg-surface p-4 shadow-xl">
                    <DisplayControls d={d} stacked />
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Saved views (this browser)
// ---------------------------------------------------------------------------
export interface SavedView { id: string; name: string; query: string }
const VIEWS_KEY = "sg-analytics-views";

export function loadViews(): SavedView[] {
    try {
        return JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "[]") as SavedView[];
    } catch {
        return [];
    }
}
export function storeViews(views: SavedView[]) {
    try {
        localStorage.setItem(VIEWS_KEY, JSON.stringify(views));
    } catch {
        // ignore
    }
}

export function SavedViews({ currentQuery, onApply }: { currentQuery: string; onApply: (query: string) => void }) {
    const [open, setOpen] = useState(false);
    const [views, setViews] = useState<SavedView[]>([]);
    const [name, setName] = useState("");
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => setViews(loadViews()), []);
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
    }, [open]);

    const update = (next: SavedView[]) => { setViews(next); storeViews(next); };

    return (
        <div ref={ref} className="relative">
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog"
                className="rounded-xl border border-rule bg-surface px-3 py-2 text-xs text-ink-soft hover:text-ink">
                Views ▾
            </button>
            {open && (
                <div role="dialog" aria-label="Saved views" className="absolute right-0 top-full z-[60] mt-2 w-72 rounded-2xl border border-rule bg-surface p-4 shadow-xl">
                    {views.length === 0 ? <p className="mb-3 text-xs text-muted">No saved views yet. Set up the range and display you like, name it below.</p> : (
                        <ul className="mb-3 space-y-1">
                            {views.map((v) => (
                                <li key={v.id} className="flex items-center justify-between gap-2">
                                    <button type="button" onClick={() => { onApply(v.query); setOpen(false); }} className="min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-left text-sm hover:bg-rule/60">{v.name}</button>
                                    <button type="button" onClick={() => update(views.filter((x) => x.id !== v.id))} aria-label={`Delete ${v.name}`} className="px-1 text-xs text-muted hover:text-signal">✕</button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <form className="flex gap-2 border-t border-rule pt-3" onSubmit={(e) => {
                        e.preventDefault();
                        const trimmed = name.trim();
                        if (!trimmed) return;
                        update([...views, { id: `${Date.now()}`, name: trimmed.slice(0, 40), query: currentQuery }]);
                        setName("");
                    }}>
                        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Name this view" aria-label="Name for the current view"
                            className="min-w-0 flex-1 rounded-lg border border-rule bg-paper px-2 py-1.5 text-sm" />
                        <button type="submit" className="btn">Save</button>
                    </form>
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Command palette
// ---------------------------------------------------------------------------
export interface Command { id: string; label: string; group: string; hint?: string; run: () => void }

export function CommandPalette({ commands, mode, onClose }: { commands: Command[]; mode: "all" | "sections"; onClose: () => void }) {
    const [query, setQuery] = useState("");
    const [index, setIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const pool = useMemo(() => (mode === "sections" ? commands.filter((c) => c.group === "Go to section") : commands), [commands, mode]);
    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? pool.filter((c) => `${c.group} ${c.label}`.toLowerCase().includes(q)) : pool;
    }, [pool, query]);

    useEffect(() => inputRef.current?.focus(), []);
    useEffect(() => setIndex(0), [query]);

    const run = (c: Command | undefined) => { if (c) { onClose(); c.run(); } };

    return (
        <div className="fixed inset-0 z-[70] flex items-start justify-center bg-ink/40 px-3 pt-[12vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div role="dialog" aria-modal="true" aria-label="Command palette" className="w-full max-w-lg overflow-hidden rounded-2xl border border-rule bg-surface shadow-2xl">
                <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Escape") onClose();
                        else if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(results.length - 1, i + 1)); }
                        else if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
                        else if (e.key === "Enter") { e.preventDefault(); run(results[index]); }
                    }}
                    role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={results[index] ? `cmd-${results[index].id}` : undefined}
                    placeholder={mode === "sections" ? "Jump to a section…" : "Type a command or section…"}
                    className="w-full border-b border-rule bg-transparent px-4 py-3 text-sm outline-none" />
                <ul id="palette-list" role="listbox" className="max-h-80 overflow-y-auto p-2">
                    {results.length === 0 && <li className="px-3 py-4 text-sm text-muted">Nothing matches.</li>}
                    {results.map((c, i) => (
                        <li key={c.id} id={`cmd-${c.id}`} role="option" aria-selected={i === index}>
                            <button type="button" onMouseEnter={() => setIndex(i)} onClick={() => run(c)}
                                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === index ? "bg-rule/70" : ""}`}>
                                <span><span className="mr-2 text-xs text-muted">{c.group}</span>{c.label}</span>
                                {c.hint && <kbd className="rounded border border-rule px-1.5 font-mono text-[11px] text-muted">{c.hint}</kbd>}
                            </button>
                        </li>
                    ))}
                </ul>
                <p className="border-t border-rule px-4 py-2 text-[11px] text-muted">↑↓ choose · Enter run · Esc close · <kbd className="font-mono">1</kbd>–<kbd className="font-mono">5</kbd> ranges · <kbd className="font-mono">c</kbd> calendar · <kbd className="font-mono">t</kbd> zone · <kbd className="font-mono">h</kbd> 12/24h · <kbd className="font-mono">d</kbd> density · <kbd className="font-mono">/</kbd> sections</p>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Alerts banner
// ---------------------------------------------------------------------------
interface AlertItem { id: string; severity: "warning" | "info"; message: string }

export function AlertsBanner({ storageWarning }: { storageWarning?: string | null }) {
    const api = useApi<AlertItem[]>(`/api/analytics/insights?${qs({ type: "alerts" })}`);
    const [dismissed, setDismissed] = useState<Set<string>>(new Set());

    useEffect(() => {
        try {
            setDismissed(new Set(JSON.parse(sessionStorage.getItem("sg-analytics-dismissed") ?? "[]") as string[]));
        } catch {
            // none dismissed
        }
    }, []);
    const dismiss = (id: string) => {
        const next = new Set(dismissed).add(id);
        setDismissed(next);
        try { sessionStorage.setItem("sg-analytics-dismissed", JSON.stringify([...next])); } catch { /* ignore */ }
    };

    const items: AlertItem[] = [...(api.data ?? [])];
    if (storageWarning) items.push({ id: "storage", severity: "warning", message: storageWarning });
    const shown = items.filter((a) => !dismissed.has(a.id));
    if (shown.length === 0) return null;

    return (
        <div className="space-y-2" role="region" aria-label="Alerts">
            {shown.map((a) => (
                <div key={a.id} role={a.severity === "warning" ? "alert" : "status"}
                    className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${a.severity === "warning" ? "border-signal/30 bg-signal/5 text-signal" : "border-rule bg-surface text-ink-soft"}`}>
                    <span>{a.message}</span>
                    <button type="button" onClick={() => dismiss(a.id)} aria-label="Dismiss" className="shrink-0 text-xs opacity-70 hover:opacity-100">✕</button>
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// "What changed" strip
// ---------------------------------------------------------------------------
interface SummaryLite { views: number; visitors: number }
export interface WhatChangedProps {
    current: SummaryLite;
    previous: SummaryLite | undefined;
    series: { t: string; views: number }[] | null;
    granularity: "hour" | "day" | "week";
    topSource: { platform: string; sessions: number; total: number } | null;
    onAskAi: () => void;
}

export function WhatChanged({ current, previous, series, granularity, topSource, onAskAi }: WhatChangedProps) {
    const { zone, clock } = useDash();
    const parts: string[] = [];

    const change = previous ? pctChange(current.views, previous.views) : null;
    if (previous && previous.views > 0 && change !== null) {
        parts.push(`${current.views.toLocaleString()} views, ${change >= 0 ? "up" : "down"} ${Math.abs(Math.round(change))}% on the previous period (${previous.views.toLocaleString()}).`);
    } else if (previous) {
        parts.push(`${current.views.toLocaleString()} views against ${previous.views.toLocaleString()} in the previous period; too few to read a percentage.`);
    } else {
        parts.push(`${current.views.toLocaleString()} views.`);
    }

    const best = series && series.length > 1 ? [...series].sort((a, b) => b.views - a.views)[0] : null;
    if (best && best.views > 0) {
        const when = granularity === "hour" ? shortDateTime(best.t, zone, clock) : new Date(best.t).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
        parts.push(`Busiest ${granularity === "hour" ? "hour" : granularity === "week" ? "week of" : "day"}: ${when} (${best.views.toLocaleString()} views).`);
    }
    if (topSource && topSource.total > 0) {
        parts.push(`Top source: ${topSource.platform} (${topSource.sessions.toLocaleString()} sessions, ${Math.round((topSource.sessions * 100) / topSource.total)}%).`);
    }

    return (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule bg-surface px-4 py-3 text-sm">
            <p className="min-w-0 text-ink-soft">{parts.join(" ")}</p>
            <button type="button" onClick={onAskAi} className="label shrink-0 rounded-full border border-rule px-3 py-1 hover:text-ink">AI summary ↓</button>
        </div>
    );
}
