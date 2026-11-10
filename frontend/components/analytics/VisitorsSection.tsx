"use client";

import { useEffect, useMemo, useState } from "react";

import { relativeTime, shortDateTime, type ClockMode, type Zone } from "@/lib/analytics/timezone";

import { BarList } from "./charts";
import { useDash, withFilters } from "./ui";

interface VisitorRow {
    id: string;
    lastSeen: string;
    firstSeen: string;
    country: string | null;
    device: string;
    channel: string;
    platform: string;
    views: number;
    sessions: number;
    maxDepth: number | null;
    completed: boolean;
}

interface VisitorsData {
    summary: {
        visitors: number;
        viewsPerVisitor: number;
        singlePagePct: number;
        engagedPct: number;
        devices: { device: string; visitors: number }[];
        countries: { country: string; visitors: number }[];
        sources: { platform: string; visitors: number }[];
    };
    rows: VisitorRow[];
    truncated: boolean;
}

const PAGE = 25;
const MAX_ROWS = 200;

function useCountryName() {
    return useMemo(() => {
        let names: Intl.DisplayNames | null = null;
        try {
            names = new Intl.DisplayNames(["en"], { type: "region" });
        } catch {
            names = null;
        }
        return (code: string | null) => {
            if (!code || code === "??") return "Unknown";
            try {
                return names?.of(code) ?? code;
            } catch {
                return code;
            }
        };
    }, []);
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
    return (
        <div className="flex flex-col gap-1">
            <dt className="label">{label}</dt>
            <dd className="font-display text-2xl leading-none tabular-nums">
                {value}
                {note && <span className="ml-2 font-sans text-xs text-muted">{note}</span>}
            </dd>
        </div>
    );
}

function depthLabel(row: VisitorRow): string {
    if (row.completed) return "Finished a story";
    if (row.maxDepth === null) return "–";
    return `${row.maxDepth}% scroll`;
}

interface VisitorsSectionProps {
    token: string;
    from: string;
    to: string;
    zone: Zone;
    clock: ClockMode;
    /** Called when the API answers 401, so the dashboard can sign out. */
    onUnauthorized: () => void;
}

export function VisitorsSection({ token, from, to, zone, clock, onUnauthorized }: VisitorsSectionProps) {
    const [limit, setLimit] = useState(PAGE);
    const [data, setData] = useState<VisitorsData | null>(null);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const countryName = useCountryName();
    const { filters } = useDash();

    // A new range starts again at the first page.
    useEffect(() => {
        setLimit(PAGE);
    }, [from, to]);

    useEffect(() => {
        let cancelled = false;
        setError(false);
        fetch(withFilters(`/api/analytics/visitors?from=${from}&to=${to}&limit=${limit}`, filters), {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then((res) => {
                if (res.status === 401) {
                    onUnauthorized();
                    throw new Error("401");
                }
                if (!res.ok) throw new Error(String(res.status));
                return res.json() as Promise<VisitorsData>;
            })
            .then((value) => {
                if (!cancelled) setData(value);
            })
            .catch((err: Error) => {
                if (!cancelled && err.message !== "401") setError(true);
            });
        return () => {
            cancelled = true;
        };
    }, [token, from, to, limit, attempt, onUnauthorized, filters]);

    const summary = data?.summary;
    const maxDevice = summary ? Math.max(...summary.devices.map((d) => d.visitors), 1) : 1;

    return (
        <div>
            <p className="mb-5 text-xs text-muted">
                Each row is one visitor on one UTC day: identities are re-salted daily and IPs are never stored, so the same person on two days counts twice.
                City, browser and OS are not collected.
            </p>

            {error ? (
                <div className="flex flex-col items-start gap-3 rounded-2xl border border-signal/30 bg-signal/5 p-5">
                    <p className="text-sm text-signal">Failed to load visitors.</p>
                    <button type="button" onClick={() => setAttempt((n) => n + 1)}
                        className="label rounded-full border border-rule px-3 py-1 text-ink-soft transition-colors hover:text-ink">
                        Retry
                    </button>
                </div>
            ) : !data || !summary ? (
                <div className="flex flex-col gap-2 animate-pulse motion-reduce:animate-none">
                    {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-7 rounded bg-rule/60" />)}
                </div>
            ) : summary.visitors === 0 ? (
                <p className="py-6 text-center text-sm text-muted">No visitors in this range.</p>
            ) : (
                <>
                    <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                        <Stat label="Visitors" value={summary.visitors.toLocaleString()} />
                        <Stat label="Pages per visitor" value={summary.viewsPerVisitor.toLocaleString()} />
                        <Stat label="Single-page visits" value={`${summary.singlePagePct}%`} />
                        <Stat label="Engaged readers" value={`${summary.engagedPct}%`} note="scrolled 75%+ or finished" />
                    </dl>

                    <div className="mt-6 grid gap-6 md:grid-cols-3">
                        <div>
                            <h3 className="label mb-2">Top countries</h3>
                            <BarList
                                items={summary.countries.map((c) => ({ label: countryName(c.country), value: c.visitors }))}
                                valueLabel="Visitors"
                            />
                        </div>
                        <div>
                            <h3 className="label mb-2">Devices</h3>
                            <ul className="flex flex-col gap-2 text-sm">
                                {summary.devices.map((d) => (
                                    <li key={d.device} className="flex items-center gap-3">
                                        <span className="w-16 capitalize text-ink-soft">{d.device}</span>
                                        <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-rule/50">
                                            <span className="absolute inset-y-0 left-0 rounded-full bg-signal/60"
                                                style={{ width: `${(d.visitors / maxDevice) * 100}%` }} />
                                        </span>
                                        <span className="w-20 text-right font-mono text-xs tabular-nums text-ink-soft">
                                            {d.visitors.toLocaleString()} · {Math.round((d.visitors * 100) / summary.visitors)}%
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div>
                            <h3 className="label mb-2">Top sources</h3>
                            <BarList
                                items={summary.sources.map((s) => ({ label: s.platform, value: s.visitors }))}
                                valueLabel="Visitors"
                            />
                        </div>
                    </div>

                    <div className="mt-8">
                        <h3 className="label mb-3">Recent visitors · times in {zone}</h3>
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[40rem] border-collapse text-sm">
                                <thead>
                                    <tr className="border-b border-rule text-left">
                                        {["Last seen", "Country", "Device", "Source", "Pages", "Sessions", "Reading"].map((h, i) => (
                                            <th key={h} scope="col"
                                                className={`label whitespace-nowrap py-2 pr-4 font-normal ${i >= 4 && i <= 5 ? "text-right" : ""}`}>
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.rows.map((row) => (
                                        <tr key={`${row.id}-${row.firstSeen}`} className="border-b border-rule/60 last:border-0">
                                            <td className="whitespace-nowrap py-2.5 pr-4">
                                                <span className="text-ink">{shortDateTime(row.lastSeen, zone, clock)}</span>
                                                <span className="ml-2 text-xs text-muted">{relativeTime(row.lastSeen)}</span>
                                            </td>
                                            <td className="whitespace-nowrap py-2.5 pr-4 text-ink">{countryName(row.country)}</td>
                                            <td className="py-2.5 pr-4 font-mono text-[11px] uppercase tracking-wider text-ink-soft">{row.device}</td>
                                            <td className="max-w-[12rem] truncate py-2.5 pr-4 text-ink-soft">{row.platform}</td>
                                            <td className="py-2.5 pr-4 text-right tabular-nums text-ink">{row.views}</td>
                                            <td className="py-2.5 pr-4 text-right tabular-nums text-ink-soft">{row.sessions}</td>
                                            <td className="whitespace-nowrap py-2.5 text-ink-soft">{depthLabel(row)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {data.truncated && limit < MAX_ROWS && (
                            <button type="button" onClick={() => setLimit((n) => Math.min(MAX_ROWS, n + PAGE))}
                                className="btn mt-4">
                                Show {Math.min(PAGE, MAX_ROWS - limit)} more
                            </button>
                        )}
                        {data.truncated && limit >= MAX_ROWS && (
                            <p className="mt-3 text-xs text-muted">Showing the {MAX_ROWS} most recent visitors. Narrow the date range to see others.</p>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
