"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { hasOptOut, setOptOut } from "@/lib/analytics/client";
import { previousRange } from "@/lib/analytics/range";
import type { ClockMode, Zone } from "@/lib/analytics/timezone";
import {
    DEFAULT_VIEW,
    RANGE_KEYS,
    buildQuery,
    parseView,
    type DensityMode,
    type RangeKey,
    type Selection,
    type ViewState
} from "@/lib/analytics/url-state";

import { BarList, Funnel, KpiTile, LineChart } from "./charts";
import {
    AlertsBanner,
    CommandPalette,
    DisplayControls,
    DisplayMenu,
    SavedViews,
    SectionNav,
    WhatChanged,
    jumpTo,
    type Command,
    type DisplayState,
    type SectionLink
} from "./Chrome";
import { DateRangePicker, formatRange } from "./DateRangePicker";
import {
    AnnotationsPanel,
    BotFilterPanel,
    DigestPanel,
    FactCheckPanel,
    FilterBar,
    FilterNotice,
    QualityEngagementPanel,
    ReliabilityPanel,
    SearchConsolePanel,
    TokensPanel,
    UsagePanel,
    VitalsPanel
} from "./ExtraPanels";
import {
    AnomaliesPanel,
    EditionsPanel,
    HeatmapPanel,
    NavPanel,
    NotFoundPanel,
    PeakPanel,
    PipelinePanel,
    PreviewsPanel,
    QualityPanel
} from "./InsightPanels";
import { LinkBuilder, SourcesSection, type SourcesData } from "./Sources";
import { AiTools, CustomMetrics, EventExplorer, StoryDrilldown } from "./ToolPanels";
import { DashContext, Panel, Stat, SubHeading, qs, useApi, useDash, type DashContextValue } from "./ui";
import { VisitorsSection } from "./VisitorsSection";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Summary { views: number; visitors: number; sessions: number; shares: number; repoClicks: number; avgReadDepth: number; completionRate: number }
interface SummaryData { current: Summary; previous: Summary }
interface LiveData { activeSessions: number; topPaths: { path: string; sessions: number }[] }
interface TopRow { label: string; views: number; visitors: number; extra?: Record<string, unknown> }
interface EventCount { name: string; count: number; visitors: number }
interface FunnelStep { label: string; sessions: number }
interface SearchStats { paletteOpens: number; paletteSearches: number; paletteChose: number; archiveSearches: number; archiveZeroResults: number }
interface OperationsStats {
    generateRequests: { status: string; count: number }[];
    notFoundViews: number;
    notFoundPaths: { path: string; views: number }[];
}
interface EventsData { counts: EventCount[]; funnel: FunnelStep[]; search: SearchStats; operations: OperationsStats }
interface TimeseriesPoint { t: string; views: number; visitors: number }
interface StorageData { databaseBytes: number; eventsBytes: number; rollupBytes: number; eventRows: number; limitBytes: number; usedPct: number; warning: boolean }

type TopKind = "editions" | "stories" | "countries" | "devices";
const TOP_KINDS: TopKind[] = ["editions", "stories", "countries", "devices"];

type Granularity = "hour" | "day" | "week";

// ---------------------------------------------------------------------------
// Range options
// ---------------------------------------------------------------------------
const RANGES: { label: string; key: RangeKey }[] = [
    { label: "24 h", key: "24h" },
    { label: "7 d", key: "7d" },
    { label: "30 d", key: "30d" },
    { label: "90 d", key: "90d" },
    { label: "All time", key: "all" }
];

/** Earliest day the calendar offers; the same start "All time" uses. */
const ANALYTICS_START = "2024-01-01";

function rangeToFromTo(range: RangeKey): { from: string; to: string; granularity: Granularity } {
    const today = new Date();
    const toStr = today.toISOString().slice(0, 10);
    const back = (days: number) => {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - days);
        return d.toISOString().slice(0, 10);
    };
    switch (range) {
        case "24h": return { from: back(1), to: toStr, granularity: "hour" };
        case "7d": return { from: back(6), to: toStr, granularity: "day" };
        case "30d": return { from: back(29), to: toStr, granularity: "day" };
        case "90d": return { from: back(89), to: toStr, granularity: "week" };
        case "all": return { from: ANALYTICS_START, to: toStr, granularity: "week" };
    }
}

/** One or two days chart by the hour, up to a month by the day, longer by the week. */
function granularityForSpan(from: string, to: string): Granularity {
    const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
    return days <= 2 ? "hour" : days <= 31 ? "day" : "week";
}

function resolveSelection(selection: Selection): { from: string; to: string; granularity: Granularity } {
    return selection.kind === "preset"
        ? rangeToFromTo(selection.key)
        : { from: selection.from, to: selection.to, granularity: granularityForSpan(selection.from, selection.to) };
}

// ---------------------------------------------------------------------------
// Persisted display preferences (the URL wins when it carries one)
// ---------------------------------------------------------------------------
const ZONE_KEY = "sg-analytics-zone";
const CLOCK_KEY = "sg-analytics-clock";
const DENSITY_KEY = "sg-analytics-density";

function initialView(): ViewState {
    const base: ViewState = { ...DEFAULT_VIEW };
    if (typeof window === "undefined") return base;
    try {
        const zone = localStorage.getItem(ZONE_KEY);
        if (zone === "UTC" || zone === "IST") base.zone = zone;
        const clock = localStorage.getItem(CLOCK_KEY);
        if (clock === "12h" || clock === "24h") base.clock = clock;
        const density = localStorage.getItem(DENSITY_KEY);
        if (density === "comfortable" || density === "compact") base.density = density;
    } catch {
        // storage unavailable: defaults
    }
    return parseView(window.location.search, base);
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------
async function apiFetch(url: string, token: string) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
}

function formatBytes(bytes: number): string {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
}

function share(part: number, whole: number): string {
    return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}

function CardSkeleton() {
    return (
        <div className="flex animate-pulse flex-col gap-3 rounded-2xl border border-rule bg-surface p-5 motion-reduce:animate-none">
            <div className="h-3 w-24 rounded bg-rule" />
            <div className="h-8 w-32 rounded bg-rule" />
        </div>
    );
}

function SectionSkeleton({ rows = 5 }: { rows?: number }) {
    return (
        <div className="flex animate-pulse flex-col gap-2 motion-reduce:animate-none">
            {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-7 rounded bg-rule/60" />)}
        </div>
    );
}

function CardError({ onRetry }: { onRetry: () => void }) {
    return (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-signal/30 bg-signal/5 p-5">
            <p className="text-sm text-signal">Failed to load.</p>
            <button type="button" onClick={onRetry} className="label rounded-full border border-rule px-3 py-1 text-ink-soft transition-colors hover:text-ink">Retry</button>
        </div>
    );
}

/** Quiet inner card for a group of related charts inside a panel. */
function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-rule p-4">
            <SubHeading note={note}>{title}</SubHeading>
            {children}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Traffic chart with compare + edition markers (needs the dashboard context)
// ---------------------------------------------------------------------------
function TrafficBody({ timeseries, granularity, compare, notesVersion }: { timeseries: TimeseriesPoint[]; granularity: Granularity; compare: boolean; notesVersion: number }) {
    const { from, to, zone, clock } = useDash();
    const prev = previousRange(from, to);
    const before = useApi<TimeseriesPoint[]>(compare ? `/api/analytics/timeseries?${qs({ from: prev.from, to: prev.to, granularity })}` : null);
    const markers = useApi<{ t: string; label: string }[]>(`/api/analytics/insights?${qs({ type: "markers", from, to, v: notesVersion })}`);
    return (
        <LineChart data={timeseries} granularity={granularity} zone={zone} clock={clock}
            compare={compare ? before.data : null} markers={markers.data ?? []} />
    );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------
interface DashboardProps {
    token: string;
    onLogout: (reason?: string) => void;
}

const SECTIONS: SectionLink[] = [
    { id: "overview", label: "Overview" },
    { id: "traffic", label: "Traffic" },
    { id: "visitors", label: "Visitors" },
    { id: "timing", label: "Timing" },
    { id: "editions", label: "Editions" },
    { id: "stories", label: "Stories" },
    { id: "sources", label: "Sources" },
    { id: "audience", label: "Audience" },
    { id: "behavior", label: "Behavior" },
    { id: "health", label: "Health" },
    { id: "production", label: "Production" },
    { id: "tools", label: "Tools" },
    { id: "export", label: "Export" }
];

export function Dashboard({ token, onLogout }: DashboardProps) {
    const [view, setView] = useState<ViewState>(initialView);
    const { selection, zone, clock, density, compare, story, filters } = view;
    const { from, to, granularity } = resolveSelection(selection);
    const todayUtc = new Date().toISOString().slice(0, 10);

    const patch = useCallback((next: Partial<ViewState>) => setView((v) => ({ ...v, ...next })), []);
    const setZone = useCallback((z: Zone) => patch({ zone: z }), [patch]);
    const setClock = useCallback((c: ClockMode) => patch({ clock: c }), [patch]);
    const setDensity = useCallback((d: DensityMode) => patch({ density: d }), [patch]);

    const [pickerOpen, setPickerOpen] = useState(false);
    const closePicker = useCallback(() => setPickerOpen(false), []);
    const [palette, setPalette] = useState<null | "all" | "sections">(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [notesVersion, setNotesVersion] = useState(0);
    const [knownCountries, setKnownCountries] = useState<string[]>([]);
    const setFilters = useCallback((next: typeof filters) => patch({ filters: next }), [patch]);
    const [optOut, setOptOutState] = useState(false);
    useEffect(() => setOptOutState(hasOptOut()), []);

    // Keep the address bar and the saved display preferences in step with the view.
    const query = buildQuery(view);
    useEffect(() => {
        window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
    }, [query]);
    useEffect(() => {
        try {
            localStorage.setItem(ZONE_KEY, zone);
            localStorage.setItem(CLOCK_KEY, clock);
            localStorage.setItem(DENSITY_KEY, density);
        } catch {
            // ignore
        }
    }, [zone, clock, density]);

    // --- Summary ---
    const [summary, setSummary] = useState<SummaryData | null>(null);
    const [summaryError, setSummaryError] = useState(false);
    const [summaryLoading, setSummaryLoading] = useState(true);

    // --- Timeseries ---
    const [timeseries, setTimeseries] = useState<TimeseriesPoint[] | null>(null);
    const [timeseriesGranularity, setTimeseriesGranularity] = useState<Granularity>(granularity);
    const [timeseriesError, setTimeseriesError] = useState(false);

    // --- Top lists (each loads and fails on its own) ---
    const [top, setTop] = useState<Partial<Record<TopKind, TopRow[]>>>({});
    const [topErrors, setTopErrors] = useState<Partial<Record<TopKind, boolean>>>({});

    const [eventsData, setEventsData] = useState<EventsData | null>(null);
    const [eventsError, setEventsError] = useState(false);
    const [sources, setSources] = useState<SourcesData | null>(null);
    const [sourcesError, setSourcesError] = useState(false);
    const [storage, setStorage] = useState<StorageData | null>(null);
    const [storageError, setStorageError] = useState(false);

    const [live, setLive] = useState<LiveData | null>(null);
    const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [exporting, setExporting] = useState<string | null>(null);
    const [exportError, setExportError] = useState<string | null>(null);

    const load401 = useCallback(
        (err: Error) => {
            if (err.message === "401") {
                onLogout("Your session has expired. Please sign in again.");
                return true;
            }
            return false;
        },
        [onLogout]
    );
    const onUnauthorized = useCallback(() => load401(new Error("401")), [load401]);

    const loadAll = useCallback(async () => {
        setSummaryLoading(true);
        setSummaryError(false);
        setTimeseriesError(false);
        setTopErrors({});
        setEventsError(false);
        setSourcesError(false);
        setStorageError(false);

        const filterQuery = qs({ f_device: filters.device, f_country: filters.country, f_channel: filters.channel });
        const q = `from=${from}&to=${to}${filterQuery ? `&${filterQuery}` : ""}`;
        const settle = <T,>(promise: Promise<T>) =>
            promise.then((value) => ({ ok: true as const, value }), (reason: Error) => ({ ok: false as const, reason }));

        const [sumRes, tsRes, topRes, evRes, srcRes, stRes] = await Promise.all([
            settle(apiFetch(`/api/analytics/summary?${q}`, token)),
            settle(apiFetch(`/api/analytics/timeseries?${q}&granularity=${granularity}`, token)),
            Promise.allSettled(TOP_KINDS.map((kind) => apiFetch(`/api/analytics/top?${q}&kind=${kind}`, token))),
            settle(apiFetch(`/api/analytics/events?${q}`, token)),
            settle(apiFetch(`/api/analytics/sources?${q}`, token)),
            settle(apiFetch(`/api/analytics/storage`, token))
        ]);

        if (sumRes.ok) setSummary(sumRes.value as SummaryData);
        else if (!load401(sumRes.reason)) setSummaryError(true);
        setSummaryLoading(false);

        if (tsRes.ok) {
            setTimeseries(tsRes.value as TimeseriesPoint[]);
            setTimeseriesGranularity(granularity);
        } else if (!load401(tsRes.reason)) setTimeseriesError(true);

        const nextTop: Partial<Record<TopKind, TopRow[]>> = {};
        const nextErrors: Partial<Record<TopKind, boolean>> = {};
        topRes.forEach((result, i) => {
            const kind = TOP_KINDS[i];
            if (result.status === "fulfilled") nextTop[kind] = result.value as TopRow[];
            else if (!load401(result.reason as Error)) nextErrors[kind] = true;
        });
        setTop(nextTop);
        setTopErrors(nextErrors);

        if (evRes.ok) setEventsData(evRes.value as EventsData);
        else if (!load401(evRes.reason)) setEventsError(true);

        if (srcRes.ok) setSources(srcRes.value as SourcesData);
        else if (!load401(srcRes.reason)) setSourcesError(true);

        if (stRes.ok) setStorage(stRes.value as StorageData);
        else if (!load401(stRes.reason)) setStorageError(true);
    }, [token, from, to, granularity, filters, load401]);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    // Live counter every 30 s
    useEffect(() => {
        const loadLive = async () => {
            try {
                setLive((await apiFetch("/api/analytics/live", token)) as LiveData);
            } catch (err) {
                load401(err as Error);
            }
        };
        loadLive();
        liveTimerRef.current = setInterval(loadLive, 30_000);
        return () => {
            if (liveTimerRef.current) clearInterval(liveTimerRef.current);
        };
    }, [token, load401]);

    /** CSV download through fetch, so the Bearer token is sent (a plain link can't send it). */
    const download = useCallback(async (label: string, url: string, filename: string) => {
        setExporting(label);
        setExportError(null);
        try {
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
            if (!res.ok) {
                if (res.status === 401) {
                    load401(new Error("401"));
                    return;
                }
                throw new Error(String(res.status));
            }
            const blob = await res.blob();
            const href = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = href;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(href), 1_000);
        } catch {
            setExportError("Export failed. Try again.");
        } finally {
            setExporting(null);
        }
    }, [token, load401]);

    const downloadCsv = useCallback(
        (type: "events" | "daily" | "sources" | "visitors") =>
            download(type, `/api/analytics/export?from=${from}&to=${to}&type=${type}`, `analytics-${type}-${from}-${to}.csv`),
        [download, from, to]
    );
    const downloadBackup = useCallback(
        () => download("backup", "/api/analytics/backup", `analytics-backup-${todayUtc}.ndjson`),
        [download, todayUtc]
    );

    // --- Sharing, shortcuts, command palette ---
    const copyLink = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            setNotice("Link to this view copied.");
        } catch {
            setNotice("Copy failed. The address bar holds the link.");
        }
        setTimeout(() => setNotice(null), 2500);
    }, []);

    const choosePreset = useCallback((key: RangeKey) => {
        patch({ selection: { kind: "preset", key } });
        setPickerOpen(false);
    }, [patch]);

    const commands = useMemo<Command[]>(() => [
        ...RANGES.map((r, i): Command => ({ id: `range-${r.key}`, group: "Range", label: `Show ${r.label}`, hint: String(i + 1), run: () => choosePreset(r.key) })),
        { id: "calendar", group: "Range", label: "Pick dates on the calendar", hint: "c", run: () => setPickerOpen(true) },
        { id: "compare", group: "View", label: compare ? "Hide previous-period comparison" : "Compare with the previous period", run: () => patch({ compare: !compare }) },
        { id: "zone", group: "View", label: `Switch times to ${zone === "UTC" ? "IST" : "UTC"}`, hint: "t", run: () => setZone(zone === "UTC" ? "IST" : "UTC") },
        { id: "clock", group: "View", label: `Use the ${clock === "24h" ? "12-hour" : "24-hour"} clock`, hint: "h", run: () => setClock(clock === "24h" ? "12h" : "24h") },
        { id: "density", group: "View", label: `Use ${density === "compact" ? "comfortable" : "compact"} tables`, hint: "d", run: () => setDensity(density === "compact" ? "comfortable" : "compact") },
        ...(filters.device || filters.country || filters.channel ? [{ id: "clear-filters", group: "View", label: "Clear filters", run: () => setFilters({}) } as Command] : []),
        { id: "link", group: "Share", label: "Copy link to this view", run: copyLink },
        { id: "csv-visitors", group: "Export", label: "Download visitors CSV", run: () => downloadCsv("visitors") },
        { id: "csv-events", group: "Export", label: "Download raw events CSV", run: () => downloadCsv("events") },
        { id: "backup", group: "Export", label: "Download full backup", run: downloadBackup },
        ...SECTIONS.map((s): Command => ({ id: `go-${s.id}`, group: "Go to section", label: s.label, run: () => jumpTo(s.id) })),
        { id: "signout", group: "Account", label: "Sign out", run: () => onLogout() }
    ], [choosePreset, compare, zone, clock, density, patch, setZone, setClock, setDensity, copyLink, downloadCsv, downloadBackup, onLogout, filters, setFilters]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setPalette("all");
                return;
            }
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const target = event.target as HTMLElement | null;
            if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
            const preset = RANGE_KEYS[Number(event.key) - 1];
            if (preset) return choosePreset(preset);
            if (event.key === "c") setPickerOpen((open) => !open);
            else if (event.key === "t") setZone(zone === "UTC" ? "IST" : "UTC");
            else if (event.key === "h") setClock(clock === "24h" ? "12h" : "24h");
            else if (event.key === "d") setDensity(density === "compact" ? "comfortable" : "compact");
            else if (event.key === "/") {
                event.preventDefault();
                setPalette("sections");
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [choosePreset, zone, clock, density, setZone, setClock, setDensity]);

    const display: DisplayState = { zone, clock, density, optOut, setZone, setClock, setDensity, setOptOut: (v) => { setOptOut(v); setOptOutState(v); } };
    const context: DashContextValue = { token, from, to, zone, clock, density, filters, onUnauthorized };

    const cur = summary?.current;
    const prev = summary?.previous;
    useEffect(() => {
        const labels = (top.countries ?? []).map((r) => r.label);
        if (labels.length > 0) setKnownCountries((known) => [...new Set([...known, ...labels])]);
    }, [top.countries]);

    const search = eventsData?.search;
    const operations = eventsData?.operations;

    const topList = (kind: TopKind, rows: number, map?: (r: TopRow) => { label: string; value: number; sublabel?: string }) => {
        if (topErrors[kind]) return <CardError onRetry={loadAll} />;
        const data = top[kind];
        if (!data) return <SectionSkeleton rows={rows} />;
        return <BarList items={data.map(map ?? ((r) => ({ label: r.label, value: r.views })))} />;
    };

    const topSource = sources && sources.platforms[0] ? { platform: sources.platforms[0].platform, sessions: sources.platforms[0].sessions, total: sources.totalSessions } : null;
    const storageWarning = storage?.warning ? `Database storage is at ${storage.usedPct}% of the plan limit (${formatBytes(storage.databaseBytes)} of ${formatBytes(storage.limitBytes)}).` : null;

    return (
        <DashContext.Provider value={context}>
            <div className="min-h-screen bg-paper">
                {/* Header */}
                <header className="sticky top-0 z-50 border-b border-rule bg-paper/90 backdrop-blur-md">
                    <div className="page-x pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-3 pb-2">
                            <div className="flex items-center gap-3">
                                <h1 className="font-display text-2xl">Analytics</h1>
                                {live !== null && (
                                    <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 motion-reduce:animate-none" aria-hidden="true" />
                                        {live.activeSessions} reading now
                                    </span>
                                )}
                            </div>

                            <div className="relative flex max-w-full flex-wrap items-center justify-end gap-2">
                                <div className="hidden md:block"><DisplayControls d={display} /></div>
                                <div className="md:hidden"><DisplayMenu d={display} /></div>
                                <SavedViews currentQuery={query} onApply={(saved) => { setView(parseView(saved)); setPickerOpen(false); }} />
                                <button type="button" onClick={copyLink} title="Copy a link to exactly this view"
                                    className="rounded-xl border border-rule bg-surface px-3 py-2 text-xs text-ink-soft hover:text-ink">Link</button>
                                <button type="button" onClick={() => setPalette("all")} aria-label="Open command palette" title="Command palette (Ctrl+K)"
                                    className="hidden rounded-xl border border-rule bg-surface px-3 py-2 font-mono text-xs text-ink-soft hover:text-ink sm:block">⌘K</button>

                                <nav aria-label="Date range" className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-rule bg-surface p-1">
                                    {RANGES.map((r, i) => {
                                        const active = selection.kind === "preset" && selection.key === r.key;
                                        return (
                                            <button key={r.key} type="button" onClick={() => choosePreset(r.key)} aria-pressed={active} title={`Shortcut: ${i + 1}`}
                                                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${active ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"}`}>
                                                {r.label}
                                            </button>
                                        );
                                    })}
                                    <button type="button" onClick={() => setPickerOpen((open) => !open)} aria-expanded={pickerOpen} aria-haspopup="dialog"
                                        aria-pressed={selection.kind === "custom"} title="Shortcut: c"
                                        className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${selection.kind === "custom" ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"}`}>
                                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                                            <rect x="2" y="3" width="12" height="11" rx="2" />
                                            <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" strokeLinecap="round" />
                                        </svg>
                                        {selection.kind === "custom" ? formatRange(selection.from, selection.to) : "Pick dates"}
                                    </button>
                                </nav>

                                {pickerOpen && (
                                    <DateRangePicker from={from} to={to} min={ANALYTICS_START} max={todayUtc} onClose={closePicker}
                                        onApply={(f, t) => { patch({ selection: { kind: "custom", from: f, to: t } }); setPickerOpen(false); }} />
                                )}
                            </div>
                        </div>
                        <FilterBar filters={filters} onChange={setFilters} countries={knownCountries} />
                        <SectionNav sections={SECTIONS} />
                    </div>
                </header>

                {notice && (
                    <div role="status" className="fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs text-paper shadow-lg">{notice}</div>
                )}
                {palette && <CommandPalette commands={commands} mode={palette} onClose={() => setPalette(null)} />}

                <div className="page-x space-y-6 py-8">
                    {/* Overview: alerts, KPIs, what changed */}
                    <section id="overview" aria-label="Key metrics" className="scroll-mt-44 space-y-4 sm:scroll-mt-28">
                        <AlertsBanner storageWarning={storageWarning} />
                        <FilterNotice filters={filters} />
                        <h2 className="sr-only">Key metrics</h2>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                            {summaryLoading && !cur ? (
                                Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
                            ) : summaryError ? (
                                <div className="sm:col-span-2 lg:col-span-3 xl:col-span-6"><CardError onRetry={loadAll} /></div>
                            ) : cur ? (
                                <>
                                    <KpiTile label="Page views" value={cur.views} previous={prev?.views} sparkline={timeseries?.map((d) => d.views)} />
                                    <KpiTile label="Visitor-days" value={cur.visitors} previous={prev?.visitors} sparkline={timeseries?.map((d) => d.visitors)} />
                                    <KpiTile label="Sessions" value={cur.sessions} previous={prev?.sessions} />
                                    <KpiTile label="Completion rate" value={cur.completionRate} previous={prev?.completionRate} suffix="%" sample={cur.sessions} />
                                    <KpiTile label="Shares" value={cur.shares} previous={prev?.shares} />
                                    <KpiTile label="Repo clicks" value={cur.repoClicks} previous={prev?.repoClicks} />
                                </>
                            ) : null}
                        </div>
                        {cur && (
                            <>
                                <WhatChanged current={cur} previous={prev} series={timeseries} granularity={timeseriesGranularity} topSource={topSource} onAskAi={() => jumpTo("tools")} />
                                <p className="text-xs text-muted">
                                    Average read depth {cur.avgReadDepth}% · compared with the previous {selection.kind === "preset" && selection.key === "all" ? "period" : "period of the same length"} · days in UTC · * on a change means fewer than 20 events, so treat it as noise
                                </p>
                            </>
                        )}
                    </section>

                    <Panel id="traffic" title="Traffic" subtitle={`${formatRange(from, to)} · ${timeseriesGranularity === "hour" ? `by the hour, shown in ${zone}` : timeseriesGranularity === "week" ? "by the week (UTC days)" : "by the day (UTC days)"}`}
                        actions={
                            <button type="button" onClick={() => patch({ compare: !compare })} aria-pressed={compare}
                                className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${compare ? "border-ink bg-ink text-paper" : "border-rule text-ink-soft hover:text-ink"}`}>
                                Compare previous period
                            </button>
                        }>
                        {timeseriesError ? <CardError onRetry={loadAll} />
                            : timeseries ? <TrafficBody timeseries={timeseries} granularity={timeseriesGranularity} compare={compare} notesVersion={notesVersion} />
                                : <div className="h-72 animate-pulse rounded bg-rule/50 motion-reduce:animate-none" />}
                    </Panel>

                    <Panel id="annotations" title="Chart notes" subtitle="Your own markers on the traffic chart: launches, outages, a post that went round">
                        <AnnotationsPanel onChange={() => setNotesVersion((v) => v + 1)} />
                    </Panel>

                    <Panel id="visitors" title="Visitors" subtitle="Who came, from where, on what device">
                        <VisitorsSection token={token} from={from} to={to} zone={zone} clock={clock} onUnauthorized={onUnauthorized} />
                    </Panel>

                    <Panel id="timing" title="Timing" subtitle="When readers show up, and which days were unusual">
                        <div><SubHeading note="Page views by weekday and hour. Use it to pick when to publish.">Busiest hours</SubHeading><HeatmapPanel /></div>
                        <div><SubHeading note="Each day compared with the same weekday over the previous 8 weeks.">Unusual days</SubHeading><AnomaliesPanel /></div>
                    </Panel>

                    <Panel id="editions" title="Editions" subtitle="How each edition performed, how long it lives, and how it was produced">
                        <div><SubHeading>Edition performance</SubHeading><EditionsPanel /></div>
                        <div><SubHeading note="Views by hours since the edition was generated: how long an edition stays alive.">Publish to peak</SubHeading><PeakPanel /></div>
                        <div><SubHeading note="The last 30 editions: model, speed, how many stories and sources, and early readership.">Pipeline health</SubHeading><PipelinePanel /></div>
                    </Panel>

                    <Panel id="stories" title="Stories" subtitle="Top editions and stories, with a drill-down">
                        <div className="grid gap-6 lg:grid-cols-2">
                            <Card title="Top editions">{topList("editions", 5)}</Card>
                            <Card title="Top stories">
                                {topList("stories", 5, (r) => ({ label: r.label, value: r.views, sublabel: r.extra ? `${(r.extra as { completionPct?: number }).completionPct ?? 0}% read` : undefined }))}
                            </Card>
                        </div>
                        <div><SubHeading note="Scroll depth, shares and sources for one story.">Story drill-down</SubHeading><StoryDrilldown slug={story} onSlug={(slug) => patch({ story: slug })} /></div>
                    </Panel>

                    <Panel id="sources" title="Sources" subtitle="Where sessions came from: tagged links first, then the referring site, then the in-app browser. A session counts for the source of its first page view.">
                        {sourcesError ? <CardError onRetry={loadAll} /> : sources ? <SourcesSection data={sources} /> : <SectionSkeleton rows={6} />}
                        <div><SubHeading note="Chat apps fetch a preview card when a link is pasted. Many previews with few visits means the card is shown but not clicked.">Link previews vs visits</SubHeading><PreviewsPanel /></div>
                        <div><SubHeading note="Clicks and impressions from Google, through a read-only service account.">Search Console</SubHeading><SearchConsolePanel /></div>
                        <div className="border-t border-rule pt-5"><SubHeading>Link builder</SubHeading><LinkBuilder /></div>
                    </Panel>

                    <Panel id="audience" title="Audience">
                        <div className="grid gap-6 md:grid-cols-2">
                            <Card title="Countries">{topList("countries", 4)}</Card>
                            <Card title="Devices">{topList("devices", 3)}</Card>
                        </div>
                    </Panel>

                    <Panel id="behavior" title="Behavior" subtitle="What readers do on the site">
                        <div className="grid gap-6 lg:grid-cols-2">
                            <Card title="Interaction events">
                                {eventsError ? <CardError onRetry={loadAll} /> : eventsData ? <BarList items={eventsData.counts.map((e) => ({ label: e.name, value: e.count }))} valueLabel="Count" /> : <SectionSkeleton />}
                            </Card>
                            <Card title="Conversion funnel">
                                {eventsError ? <CardError onRetry={loadAll} /> : eventsData ? <Funnel steps={eventsData.funnel} /> : <SectionSkeleton rows={4} />}
                            </Card>
                        </div>
                        <Card title="Search" note="Result counts only; search text is never stored.">
                            {eventsError ? <CardError onRetry={loadAll} /> : search ? (
                                <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                                    <Stat label="Palette opens" value={search.paletteOpens} />
                                    <Stat label="Palette searches" value={search.paletteSearches} note={`${share(search.paletteChose, search.paletteSearches)} chose a result`} />
                                    <Stat label="Archive searches" value={search.archiveSearches} />
                                    <Stat label="Archive, no results" value={search.archiveZeroResults} note={share(search.archiveZeroResults, search.archiveSearches)} />
                                </dl>
                            ) : <SectionSkeleton rows={2} />}
                        </Card>
                        <div><SubHeading note="The most common routes between page types, and where sessions end.">Navigation paths</SubHeading><NavPanel /></div>
                    </Panel>

                    <Panel id="health" title="Health" subtitle="Is tracking working, what is broken, what is live">
                        {live && live.topPaths.length > 0 && (
                            <Card title="Live now"><BarList items={live.topPaths.map((p) => ({ label: p.path, value: p.sessions }))} valueLabel="Sessions" /></Card>
                        )}
                        <div><SubHeading>Tracking health</SubHeading><QualityPanel /></div>
                        <div><SubHeading>404 pages</SubHeading><NotFoundPanel /></div>
                        <div><SubHeading note="How fast pages feel to readers, measured in their browsers. Follows the filters.">Core Web Vitals</SubHeading><VitalsPanel /></div>
                        <div><SubHeading note="Bots and Do Not Track requests are dropped before storage; only a daily tally is kept.">Bot and privacy filter</SubHeading><BotFilterPanel /></div>
                        <Card title="Operations">
                            {eventsError ? <CardError onRetry={loadAll} /> : operations ? (
                                <div>
                                    <h4 className="label mb-2">Generation requests by status</h4>
                                    <BarList items={operations.generateRequests.map((g) => ({ label: `HTTP ${g.status}`, value: g.count }))} valueLabel="Requests" />
                                </div>
                            ) : <SectionSkeleton rows={3} />}
                            <div className="mt-5 border-t border-rule pt-4">
                                <h4 className="label mb-2">Database storage</h4>
                                {storageError ? <CardError onRetry={loadAll} /> : storage ? (
                                    <>
                                        <p className={`text-sm ${storage.warning ? "text-signal" : "text-ink-soft"}`}>
                                            {formatBytes(storage.databaseBytes)} of {formatBytes(storage.limitBytes)} ({storage.usedPct}%){storage.warning && " · over 80% of the plan limit"}
                                        </p>
                                        <p className="mt-1 text-xs text-muted">Events {formatBytes(storage.eventsBytes)} (~{storage.eventRows.toLocaleString()} rows) · rollups {formatBytes(storage.rollupBytes)}</p>
                                    </>
                                ) : <SectionSkeleton rows={1} />}
                            </div>
                        </Card>
                    </Panel>

                    <Panel id="production" title="Production" subtitle="What the edition pipeline costs, and how often the fact check had to step in">
                        <div><SubHeading note="Tokens and search credits per provider, from one row per API call.">API usage</SubHeading><UsagePanel /></div>
                        <div><SubHeading note="What the fact check removed or replaced in each edition.">Fact-check history</SubHeading><FactCheckPanel /></div>
                        <div><SubHeading>Source reliability</SubHeading><ReliabilityPanel /></div>
                        <div><SubHeading note="Whether editions that needed more fixes were read less.">Quality vs engagement</SubHeading><QualityEngagementPanel /></div>
                    </Panel>

                    <Panel id="tools" title="Tools" subtitle="Custom metrics, raw events, and AI help from Gemini">
                        <div><SubHeading note="Your own ratios, saved in this browser.">Custom metrics</SubHeading><CustomMetrics /></div>
                        <div><SubHeading note="Summarise the period, or ask a question in plain English.">Ask Gemini</SubHeading><AiTools /></div>
                        <div><SubHeading note="Search the raw event log and follow one session.">Event explorer</SubHeading><EventExplorer /></div>
                        <div><SubHeading note="A daily summary and pushed alerts, to Slack, Discord or email.">Scheduled digest</SubHeading><DigestPanel /></div>
                        <div><SubHeading note="Read-only keys for scripts and spreadsheets.">API tokens</SubHeading><TokensPanel /></div>
                    </Panel>

                    <Panel id="export" title="Export" subtitle={`Date range: ${from} → ${to} (UTC)`}>
                        <div className="flex flex-wrap gap-3">
                            {([
                                ["visitors", "↓ Visitors CSV"], ["events", "↓ Raw events CSV"], ["daily", "↓ Daily page stats CSV"], ["sources", "↓ Daily sources CSV"]
                            ] as const).map(([type, label]) => (
                                <button key={type} type="button" className="btn" disabled={exporting !== null} onClick={() => downloadCsv(type)}>
                                    {exporting === type ? "Preparing…" : label}
                                </button>
                            ))}
                            <button type="button" className="btn" disabled={exporting !== null} onClick={downloadBackup}>
                                {exporting === "backup" ? "Preparing…" : "↓ Full backup (all tables)"}
                            </button>
                        </div>
                        {exportError && <p role="alert" className="text-sm text-signal">{exportError}</p>}
                        <p className="text-xs text-muted">
                            The full backup ignores the date range: every raw event and every daily rollup, as one newline-delimited JSON file, so the analytics are not locked to this database.
                        </p>
                    </Panel>
                </div>
            </div>
        </DashContext.Provider>
    );
}
