"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KpiTile, LineChart, BarList, Funnel } from "./charts";

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

type TopKind = "editions" | "stories" | "referrers" | "countries" | "devices";
const TOP_KINDS: TopKind[] = ["editions", "stories", "referrers", "countries", "devices"];

// ---------------------------------------------------------------------------
// Range options
// ---------------------------------------------------------------------------
type RangeKey = "24h" | "7d" | "30d" | "90d" | "all";

const RANGES: { label: string; key: RangeKey }[] = [
    { label: "24 h", key: "24h" },
    { label: "7 d", key: "7d" },
    { label: "30 d", key: "30d" },
    { label: "90 d", key: "90d" },
    { label: "All time", key: "all" }
];

function rangeToFromTo(range: RangeKey): { from: string; to: string; granularity: "hour" | "day" | "week" } {
    const today = new Date();
    const toStr = today.toISOString().slice(0, 10);
    switch (range) {
        case "24h": {
            const d = new Date(today);
            d.setUTCDate(d.getUTCDate() - 1);
            return { from: d.toISOString().slice(0, 10), to: toStr, granularity: "hour" };
        }
        case "7d": {
            const d = new Date(today);
            d.setUTCDate(d.getUTCDate() - 6);
            return { from: d.toISOString().slice(0, 10), to: toStr, granularity: "day" };
        }
        case "30d": {
            const d = new Date(today);
            d.setUTCDate(d.getUTCDate() - 29);
            return { from: d.toISOString().slice(0, 10), to: toStr, granularity: "day" };
        }
        case "90d": {
            const d = new Date(today);
            d.setUTCDate(d.getUTCDate() - 89);
            return { from: d.toISOString().slice(0, 10), to: toStr, granularity: "week" };
        }
        case "all": {
            return { from: "2024-01-01", to: toStr, granularity: "week" };
        }
    }
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

// ---------------------------------------------------------------------------
// Card skeleton
// ---------------------------------------------------------------------------
function CardSkeleton() {
    return (
        <div className="flex flex-col gap-3 rounded-2xl border border-rule bg-surface p-5 animate-pulse motion-reduce:animate-none">
            <div className="h-3 w-24 rounded bg-rule" />
            <div className="h-8 w-32 rounded bg-rule" />
        </div>
    );
}

function SectionSkeleton({ rows = 5 }: { rows?: number }) {
    return (
        <div className="flex flex-col gap-2 animate-pulse motion-reduce:animate-none">
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="h-7 rounded bg-rule/60" />
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Error card
// ---------------------------------------------------------------------------
function CardError({ onRetry }: { onRetry: () => void }) {
    return (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-signal/30 bg-signal/5 p-5">
            <p className="text-sm text-signal">Failed to load.</p>
            <button type="button" onClick={onRetry} className="label rounded-full border border-rule px-3 py-1 text-ink-soft hover:text-ink transition-colors">
                Retry
            </button>
        </div>
    );
}

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
    return (
        <div className="flex flex-col gap-1">
            <dt className="label">{label}</dt>
            <dd className="font-display text-2xl leading-none tabular-nums">
                {typeof value === "number" ? value.toLocaleString() : value}
                {note && <span className="ml-2 font-sans text-xs text-muted">{note}</span>}
            </dd>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------
interface DashboardProps {
    token: string;
    onLogout: (reason?: string) => void;
}

export function Dashboard({ token, onLogout }: DashboardProps) {
    const [range, setRange] = useState<RangeKey>("7d");
    const { from, to, granularity } = rangeToFromTo(range);

    // --- Summary ---
    const [summary, setSummary] = useState<SummaryData | null>(null);
    const [summaryError, setSummaryError] = useState(false);
    const [summaryLoading, setSummaryLoading] = useState(true);

    // --- Timeseries ---
    const [timeseries, setTimeseries] = useState<TimeseriesPoint[] | null>(null);
    const [timeseriesGranularity, setTimeseriesGranularity] = useState(granularity);
    const [timeseriesError, setTimeseriesError] = useState(false);

    // --- Top lists (each loads and fails on its own) ---
    const [top, setTop] = useState<Partial<Record<TopKind, TopRow[]>>>({});
    const [topErrors, setTopErrors] = useState<Partial<Record<TopKind, boolean>>>({});

    // --- Events ---
    const [eventsData, setEventsData] = useState<EventsData | null>(null);
    const [eventsError, setEventsError] = useState(false);

    // --- Storage ---
    const [storage, setStorage] = useState<StorageData | null>(null);
    const [storageError, setStorageError] = useState(false);

    // --- Live ---
    const [live, setLive] = useState<LiveData | null>(null);
    const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // --- Export ---
    const [exporting, setExporting] = useState<"events" | "daily" | null>(null);
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

    const loadAll = useCallback(async () => {
        setSummaryLoading(true);
        setSummaryError(false);
        setTimeseriesError(false);
        setTopErrors({});
        setEventsError(false);
        setStorageError(false);

        const q = `from=${from}&to=${to}`;

        const [sumRes, tsRes, topRes, evRes, stRes] = await Promise.all([
            apiFetch(`/api/analytics/summary?${q}`, token).then(
                (value) => ({ ok: true as const, value }),
                (reason: Error) => ({ ok: false as const, reason })
            ),
            apiFetch(`/api/analytics/timeseries?${q}&granularity=${granularity}`, token).then(
                (value) => ({ ok: true as const, value }),
                (reason: Error) => ({ ok: false as const, reason })
            ),
            Promise.allSettled(TOP_KINDS.map((kind) => apiFetch(`/api/analytics/top?${q}&kind=${kind}`, token))),
            apiFetch(`/api/analytics/events?${q}`, token).then(
                (value) => ({ ok: true as const, value }),
                (reason: Error) => ({ ok: false as const, reason })
            ),
            apiFetch(`/api/analytics/storage`, token).then(
                (value) => ({ ok: true as const, value }),
                (reason: Error) => ({ ok: false as const, reason })
            )
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

        if (stRes.ok) setStorage(stRes.value as StorageData);
        else if (!load401(stRes.reason)) setStorageError(true);
    }, [token, from, to, granularity, load401]);

    // Load data when range changes
    useEffect(() => {
        loadAll();
    }, [loadAll]);

    // Live counter every 30 s
    useEffect(() => {
        const loadLive = async () => {
            try {
                const data = await apiFetch("/api/analytics/live", token);
                setLive(data as LiveData);
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
    async function downloadCsv(type: "events" | "daily") {
        setExporting(type);
        setExportError(null);
        try {
            const res = await fetch(`/api/analytics/export?from=${from}&to=${to}&type=${type}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!res.ok) {
                if (res.status === 401) {
                    load401(new Error("401"));
                    return;
                }
                throw new Error(String(res.status));
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `analytics-${type}-${from}-${to}.csv`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1_000);
        } catch {
            setExportError("Export failed. Try again.");
        } finally {
            setExporting(null);
        }
    }

    const cur = summary?.current;
    const prev = summary?.previous;

    const topList = (kind: TopKind, rows: number, map?: (r: TopRow) => { label: string; value: number; sublabel?: string }) => {
        if (topErrors[kind]) return <CardError onRetry={loadAll} />;
        const data = top[kind];
        if (!data) return <SectionSkeleton rows={rows} />;
        return <BarList items={data.map(map ?? ((r) => ({ label: r.label, value: r.views })))} />;
    };

    const search = eventsData?.search;
    const operations = eventsData?.operations;

    return (
        <div className="min-h-screen bg-paper">
            {/* Header */}
            <header className="sticky top-0 z-50 border-b border-rule bg-paper/90 backdrop-blur-md">
                <div className="page-x flex flex-wrap items-center justify-between gap-3 py-3">
                    <div className="flex items-center gap-3">
                        <h1 className="font-display text-2xl">Analytics</h1>
                        {live !== null && (
                            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
                                {live.activeSessions} reading now
                            </span>
                        )}
                    </div>

                    {/* Range picker */}
                    <nav aria-label="Date range" className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-rule bg-surface p-1">
                        {RANGES.map((r) => (
                            <button
                                key={r.key}
                                type="button"
                                onClick={() => setRange(r.key)}
                                aria-pressed={range === r.key}
                                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${range === r.key
                                    ? "bg-ink text-paper"
                                    : "text-ink-soft hover:text-ink"
                                    }`}
                            >
                                {r.label}
                            </button>
                        ))}
                    </nav>
                </div>
            </header>

            <div className="page-x py-8 space-y-10">

                {/* KPI row */}
                <section aria-label="Key metrics">
                    <h2 className="sr-only">Key metrics</h2>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                        {summaryLoading && !cur ? (
                            Array.from({ length: 6 }).map((_, i) => <CardSkeleton key={i} />)
                        ) : summaryError ? (
                            <div className="sm:col-span-2 lg:col-span-3 xl:col-span-6">
                                <CardError onRetry={loadAll} />
                            </div>
                        ) : cur ? (
                            <>
                                <KpiTile label="Page views" value={cur.views} previous={prev?.views}
                                    sparkline={timeseries?.map((d) => d.views)} />
                                <KpiTile label="Visitor-days" value={cur.visitors} previous={prev?.visitors}
                                    sparkline={timeseries?.map((d) => d.visitors)} />
                                <KpiTile label="Sessions" value={cur.sessions} previous={prev?.sessions} />
                                <KpiTile label="Completion rate" value={cur.completionRate} previous={prev?.completionRate} suffix="%" />
                                <KpiTile label="Shares" value={cur.shares} previous={prev?.shares} />
                                <KpiTile label="Repo clicks" value={cur.repoClicks} previous={prev?.repoClicks} />
                            </>
                        ) : null}
                    </div>
                    {cur && (
                        <p className="mt-3 text-xs text-muted">
                            Average read depth {cur.avgReadDepth}% · compared with the previous {range === "all" ? "period" : "period of the same length"} · days in UTC
                        </p>
                    )}
                </section>

                {/* Timeseries chart */}
                <section aria-labelledby="chart-heading" className="rounded-2xl border border-rule bg-surface p-5 sm:p-6">
                    <h2 id="chart-heading" className="font-display text-xl mb-4">Traffic</h2>
                    {timeseriesError ? (
                        <CardError onRetry={loadAll} />
                    ) : timeseries ? (
                        <LineChart data={timeseries} granularity={timeseriesGranularity} />
                    ) : (
                        <div className="h-48 animate-pulse motion-reduce:animate-none rounded bg-rule/50" />
                    )}
                </section>

                {/* Top editions + Top stories */}
                <div className="grid gap-6 lg:grid-cols-2">
                    <section aria-labelledby="top-editions-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="top-editions-heading" className="font-display text-xl mb-4">Top editions</h2>
                        {topList("editions", 5)}
                    </section>
                    <section aria-labelledby="top-stories-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="top-stories-heading" className="font-display text-xl mb-4">Top stories</h2>
                        {topList("stories", 5, (r) => ({
                            label: r.label,
                            value: r.views,
                            sublabel: r.extra ? `${(r.extra as { completionPct?: number }).completionPct ?? 0}% read` : undefined
                        }))}
                    </section>
                </div>

                {/* Referrers + Countries + Devices */}
                <div className="grid gap-6 md:grid-cols-3">
                    <section aria-labelledby="top-referrers-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="top-referrers-heading" className="font-display text-lg mb-4">Referrers</h2>
                        {topList("referrers", 4)}
                    </section>
                    <section aria-labelledby="top-countries-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="top-countries-heading" className="font-display text-lg mb-4">Countries</h2>
                        {topList("countries", 4)}
                    </section>
                    <section aria-labelledby="top-devices-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="top-devices-heading" className="font-display text-lg mb-4">Devices</h2>
                        {topList("devices", 3)}
                    </section>
                </div>

                {/* Events + Funnel */}
                <div className="grid gap-6 lg:grid-cols-2">
                    <section aria-labelledby="event-counts-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="event-counts-heading" className="font-display text-xl mb-4">Interaction events</h2>
                        {eventsError ? <CardError onRetry={loadAll} />
                            : eventsData ? (
                                <BarList
                                    items={eventsData.counts.map((e) => ({ label: e.name, value: e.count }))}
                                    valueLabel="Count"
                                />
                            )
                                : <SectionSkeleton />}
                    </section>
                    <section aria-labelledby="funnel-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="funnel-heading" className="font-display text-xl mb-4">Conversion funnel</h2>
                        {eventsError ? <CardError onRetry={loadAll} />
                            : eventsData ? <Funnel steps={eventsData.funnel} />
                                : <SectionSkeleton rows={4} />}
                    </section>
                </div>

                {/* Search + Operations */}
                <div className="grid gap-6 lg:grid-cols-2">
                    <section aria-labelledby="search-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="search-heading" className="font-display text-xl mb-1">Search</h2>
                        <p className="mb-4 text-xs text-muted">Result counts only; search text is never stored.</p>
                        {eventsError ? <CardError onRetry={loadAll} />
                            : search ? (
                                <dl className="grid grid-cols-2 gap-5">
                                    <Stat label="Palette opens" value={search.paletteOpens} />
                                    <Stat label="Palette searches" value={search.paletteSearches}
                                        note={`${share(search.paletteChose, search.paletteSearches)} chose a result`} />
                                    <Stat label="Archive searches" value={search.archiveSearches} />
                                    <Stat label="Archive, no results" value={search.archiveZeroResults}
                                        note={share(search.archiveZeroResults, search.archiveSearches)} />
                                </dl>
                            )
                                : <SectionSkeleton rows={2} />}
                    </section>
                    <section aria-labelledby="ops-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="ops-heading" className="font-display text-xl mb-4">Operations</h2>
                        {eventsError ? <CardError onRetry={loadAll} />
                            : operations ? (
                                <div className="space-y-5">
                                    <div>
                                        <h3 className="label mb-2">Generation requests by status</h3>
                                        <BarList
                                            items={operations.generateRequests.map((g) => ({ label: `HTTP ${g.status}`, value: g.count }))}
                                            valueLabel="Requests"
                                        />
                                    </div>
                                    <div>
                                        <h3 className="label mb-2">404 pages · {operations.notFoundViews.toLocaleString()} views</h3>
                                        <BarList
                                            items={operations.notFoundPaths.map((p) => ({ label: p.path, value: p.views }))}
                                        />
                                    </div>
                                </div>
                            )
                                : <SectionSkeleton rows={4} />}
                        <div className="mt-5 border-t border-rule pt-4">
                            <h3 className="label mb-2">Database storage</h3>
                            {storageError ? <CardError onRetry={loadAll} />
                                : storage ? (
                                    <>
                                        <p className={`text-sm ${storage.warning ? "text-signal" : "text-ink-soft"}`}>
                                            {formatBytes(storage.databaseBytes)} of {formatBytes(storage.limitBytes)} ({storage.usedPct}%)
                                            {storage.warning && " · over 80% of the plan limit"}
                                        </p>
                                        <p className="mt-1 text-xs text-muted">
                                            Events {formatBytes(storage.eventsBytes)} (~{storage.eventRows.toLocaleString()} rows) · rollups {formatBytes(storage.rollupBytes)}
                                        </p>
                                    </>
                                )
                                    : <SectionSkeleton rows={1} />}
                        </div>
                    </section>
                </div>

                {/* Live paths */}
                {live && live.topPaths.length > 0 && (
                    <section aria-labelledby="live-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="live-heading" className="font-display text-xl mb-4 flex items-center gap-2">
                            Live
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
                        </h2>
                        <BarList
                            items={live.topPaths.map((p) => ({ label: p.path, value: p.sessions }))}
                            valueLabel="Sessions"
                        />
                    </section>
                )}

                {/* CSV export */}
                <section aria-labelledby="export-heading" className="rounded-2xl border border-rule bg-surface p-5">
                    <h2 id="export-heading" className="font-display text-xl mb-4">Export</h2>
                    <div className="flex flex-wrap gap-3">
                        <button type="button" className="btn" disabled={exporting !== null} onClick={() => downloadCsv("events")}>
                            {exporting === "events" ? "Preparing…" : "↓ Raw events CSV"}
                        </button>
                        <button type="button" className="btn" disabled={exporting !== null} onClick={() => downloadCsv("daily")}>
                            {exporting === "daily" ? "Preparing…" : "↓ Daily page stats CSV"}
                        </button>
                    </div>
                    {exportError && (
                        <p role="alert" className="mt-3 text-sm text-signal">{exportError}</p>
                    )}
                    <p className="mt-3 text-xs text-muted">
                        Date range: {from} → {to} (UTC)
                    </p>
                </section>
            </div>
        </div>
    );
}
