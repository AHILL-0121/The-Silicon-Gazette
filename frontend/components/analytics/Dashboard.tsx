"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KpiTile, LineChart, BarList, Funnel } from "./charts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SummaryData {
    current: { views: number; visitors: number; sessions: number; shares: number; repoClicks: number; avgReadDepth: number; completionRate: number };
    previous: { views: number; visitors: number; sessions: number; shares: number; repoClicks: number; avgReadDepth: number; completionRate: number };
}
interface LiveData { activeSessions: number; topPaths: { path: string; sessions: number }[] }
interface TopRow { label: string; views: number; visitors: number; extra?: Record<string, unknown> }
interface EventCount { name: string; count: number; visitors: number }
interface FunnelStep { label: string; sessions: number }
interface EventsData { counts: EventCount[]; funnel: FunnelStep[] }
interface TimeseriesPoint { t: string; views: number; visitors: number }

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
            d.setUTCDate(d.getUTCDate() - 7);
            return { from: d.toISOString().slice(0, 10), to: toStr, granularity: "day" };
        }
        case "30d": {
            const d = new Date(today);
            d.setUTCDate(d.getUTCDate() - 30);
            return { from: d.toISOString().slice(0, 10), to: toStr, granularity: "day" };
        }
        case "90d": {
            const d = new Date(today);
            d.setUTCDate(d.getUTCDate() - 90);
            return { from: d.toISOString().slice(0, 10), to: toStr, granularity: "week" };
        }
        case "all": {
            return { from: "2024-01-01", to: toStr, granularity: "week" };
        }
    }
}

// ---------------------------------------------------------------------------
// Fetcher helper
// ---------------------------------------------------------------------------
async function apiFetch(url: string, token: string) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.json();
}

// ---------------------------------------------------------------------------
// Card skeleton
// ---------------------------------------------------------------------------
function CardSkeleton() {
    return (
        <div className="flex flex-col gap-3 rounded-2xl border border-rule bg-surface p-5 animate-pulse">
            <div className="h-3 w-24 rounded bg-rule" />
            <div className="h-8 w-32 rounded bg-rule" />
        </div>
    );
}

function SectionSkeleton({ rows = 5 }: { rows?: number }) {
    return (
        <div className="flex flex-col gap-2 animate-pulse">
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
            <button onClick={onRetry} className="label rounded-full border border-rule px-3 py-1 text-ink-soft hover:text-ink transition-colors">
                Retry
            </button>
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
    const [timeseriesError, setTimeseriesError] = useState(false);

    // --- Top lists ---
    const [topEditions, setTopEditions] = useState<TopRow[] | null>(null);
    const [topStories, setTopStories] = useState<TopRow[] | null>(null);
    const [topReferrers, setTopReferrers] = useState<TopRow[] | null>(null);
    const [topCountries, setTopCountries] = useState<TopRow[] | null>(null);
    const [topDevices, setTopDevices] = useState<TopRow[] | null>(null);
    const [topError, setTopError] = useState(false);

    // --- Events ---
    const [eventsData, setEventsData] = useState<EventsData | null>(null);
    const [eventsError, setEventsError] = useState(false);

    // --- Live ---
    const [live, setLive] = useState<LiveData | null>(null);
    const liveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        setTopError(false);
        setEventsError(false);

        const q = `from=${from}&to=${to}`;

        // Run all in parallel
        const [sumRes, tsRes, topRes, evRes] = await Promise.allSettled([
            apiFetch(`/api/analytics/summary?${q}`, token),
            apiFetch(`/api/analytics/timeseries?${q}&granularity=${granularity}`, token),
            Promise.allSettled([
                apiFetch(`/api/analytics/top?${q}&kind=editions`, token),
                apiFetch(`/api/analytics/top?${q}&kind=stories`, token),
                apiFetch(`/api/analytics/top?${q}&kind=referrers`, token),
                apiFetch(`/api/analytics/top?${q}&kind=countries`, token),
                apiFetch(`/api/analytics/top?${q}&kind=devices`, token)
            ]),
            apiFetch(`/api/analytics/events?${q}`, token)
        ]);

        if (sumRes.status === "fulfilled") {
            setSummary(sumRes.value as SummaryData);
        } else {
            if (!load401(sumRes.reason as Error)) setSummaryError(true);
        }
        setSummaryLoading(false);

        if (tsRes.status === "fulfilled") {
            setTimeseries(tsRes.value as TimeseriesPoint[]);
        } else {
            if (!load401(tsRes.reason as Error)) setTimeseriesError(true);
        }

        if (topRes.status === "fulfilled") {
            const [ed, st, ref, co, dev] = topRes.value;
            if (ed.status === "fulfilled") setTopEditions(ed.value as TopRow[]);
            if (st.status === "fulfilled") setTopStories(st.value as TopRow[]);
            if (ref.status === "fulfilled") setTopReferrers(ref.value as TopRow[]);
            if (co.status === "fulfilled") setTopCountries(co.value as TopRow[]);
            if (dev.status === "fulfilled") setTopDevices(dev.value as TopRow[]);
            const anyErr = [ed, st, ref, co, dev].some((r) => r.status === "rejected");
            if (anyErr) setTopError(true);
        } else {
            if (!load401(topRes.reason as Error)) setTopError(true);
        }

        if (evRes.status === "fulfilled") {
            setEventsData(evRes.value as EventsData);
        } else {
            if (!load401(evRes.reason as Error)) setEventsError(true);
        }
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

    const cur = summary?.current;
    const prev = summary?.previous;

    return (
        <div className="min-h-screen bg-paper">
            {/* Header */}
            <header className="sticky top-0 z-50 border-b border-rule bg-paper/90 backdrop-blur-md">
                <div className="page-x flex items-center justify-between gap-4 py-3">
                    <div className="flex items-center gap-3">
                        <h1 className="font-display text-2xl">Analytics</h1>
                        {live !== null && (
                            <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
                                {live.activeSessions} reading now
                            </span>
                        )}
                    </div>

                    {/* Range picker */}
                    <nav aria-label="Date range" className="flex items-center gap-1 rounded-xl border border-rule bg-surface p-1">
                        {RANGES.map((r) => (
                            <button
                                key={r.key}
                                type="button"
                                onClick={() => setRange(r.key)}
                                aria-pressed={range === r.key}
                                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${range === r.key
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
                        {summaryLoading ? (
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
                </section>

                {/* Timeseries chart */}
                <section aria-labelledby="chart-heading" className="rounded-2xl border border-rule bg-surface p-5 sm:p-6">
                    <h2 id="chart-heading" className="font-display text-xl mb-4">Traffic</h2>
                    {timeseriesError ? (
                        <CardError onRetry={loadAll} />
                    ) : timeseries ? (
                        <LineChart data={timeseries} />
                    ) : (
                        <div className="h-48 animate-pulse rounded bg-rule/50" />
                    )}
                </section>

                {/* Top editions + Top stories */}
                <div className="grid gap-6 lg:grid-cols-2">
                    <section aria-labelledby="top-editions-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="top-editions-heading" className="font-display text-xl mb-4">Top editions</h2>
                        {topError ? <CardError onRetry={loadAll} />
                            : topEditions ? <BarList items={topEditions.map((r) => ({ label: r.label, value: r.views }))} />
                                : <SectionSkeleton />}
                    </section>
                    <section aria-labelledby="top-stories-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="top-stories-heading" className="font-display text-xl mb-4">Top stories</h2>
                        {topError ? <CardError onRetry={loadAll} />
                            : topStories ? (
                                <BarList
                                    items={topStories.map((r) => ({
                                        label: r.label,
                                        value: r.views,
                                        sublabel: r.extra ? `${(r.extra as { completionPct?: number }).completionPct ?? 0}% read` : undefined
                                    }))}
                                />
                            )
                                : <SectionSkeleton />}
                    </section>
                </div>

                {/* Referrers + Countries + Devices */}
                <div className="grid gap-6 md:grid-cols-3">
                    <section aria-labelledby="top-referrers-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="top-referrers-heading" className="font-display text-lg mb-4">Referrers</h2>
                        {topError ? <CardError onRetry={loadAll} />
                            : topReferrers ? <BarList items={topReferrers.map((r) => ({ label: r.label, value: r.views }))} />
                                : <SectionSkeleton rows={4} />}
                    </section>
                    <section aria-labelledby="top-countries-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="top-countries-heading" className="font-display text-lg mb-4">Countries</h2>
                        {topError ? <CardError onRetry={loadAll} />
                            : topCountries ? <BarList items={topCountries.map((r) => ({ label: r.label, value: r.views }))} />
                                : <SectionSkeleton rows={4} />}
                    </section>
                    <section aria-labelledby="top-devices-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="top-devices-heading" className="font-display text-lg mb-4">Devices</h2>
                        {topError ? <CardError onRetry={loadAll} />
                            : topDevices ? <BarList items={topDevices.map((r) => ({ label: r.label, value: r.views }))} />
                                : <SectionSkeleton rows={3} />}
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

                {/* Live paths */}
                {live && live.topPaths.length > 0 && (
                    <section aria-labelledby="live-heading" className="rounded-2xl border border-rule bg-surface p-5">
                        <h2 id="live-heading" className="font-display text-xl mb-4 flex items-center gap-2">
                            Live
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
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
                        <a
                            href={`/api/analytics/export?from=${from}&to=${to}&type=events`}
                            className="btn"
                            download
                        >
                            ↓ Raw events CSV
                        </a>
                        <a
                            href={`/api/analytics/export?from=${from}&to=${to}&type=daily`}
                            className="btn"
                            download
                        >
                            ↓ Daily rollup CSV
                        </a>
                    </div>
                    <p className="mt-3 text-xs text-muted">
                        Date range: {from} → {to}
                    </p>
                </section>
            </div>
        </div>
    );
}
