"use client";

import { useMemo, useState } from "react";

import { clockLabel, relativeTime, shortDateTime } from "@/lib/analytics/timezone";

import { Async, MiniBars, SubHeading, qs, useApi, useCell, useDash } from "./ui";

// Types mirror lib/analytics/insights.ts (the API's JSON).
interface HeatmapData { cells: number[][]; total: number; max: number }
interface AnomalyDay { day: string; views: number; expected: number; ratio: number | null; flag: "high" | "low" | null }
interface EditionRow { date: string; views: number; visitors: number; completions: number; shares: number; avgSeconds: number | null; generatedAt: string | null; model: string | null; stories: number | null }
interface PeakData { hours: number[]; editions: number; total: number; peakHour: number | null; shareFirst24h: number; shareFirst48h: number }
interface PipelineRow { date: string; model: string; latencySeconds: number | null; stories: number; repos: number; linkedStories: number; sourceHosts: number; generatedAt: string; views48h: number; completions48h: number }
interface PipelineData { editions: PipelineRow[]; correlations: { trait: string; r: number | null }[] }
interface NavData { transitions: { from: string; to: string; count: number }[]; exits: { type: string; views: number; exitPct: number }[] }
interface NotFoundData { daily: { day: string; views: number }[]; paths: { path: string; views: number; suggestion: string | null }[] }
interface QualityData { hourly: { t: string; events: number }[]; lastEvent: string | null; lastPageview: string | null; eventsLast24h: number; avgEventsPerDay7d: number; silentHours24h: number }
interface PreviewData { platforms: { platform: string; previews: number; visits: number }[]; pages: { path: string; previews: number }[] }

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Empty({ children }: { children: React.ReactNode }) {
    return <p className="py-3 text-sm text-muted">{children}</p>;
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
    return <th scope="col" className={`label whitespace-nowrap py-2 pr-4 font-normal ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

function seconds(value: number | null): string {
    if (value === null) return "–";
    return value >= 60 ? `${Math.floor(value / 60)}m ${value % 60}s` : `${value}s`;
}

// ---------------------------------------------------------------------------
// Heatmap: weekday x hour, in the display zone.
// ---------------------------------------------------------------------------
export function HeatmapPanel() {
    const { from, to, zone, clock } = useDash();
    const api = useApi<HeatmapData>(`/api/analytics/insights?${qs({ type: "heatmap", from, to, tz: zone })}`);
    const hourLabel = (h: number) => (clock === "24h" ? String(h).padStart(2, "0") : `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`);

    return (
        <Async api={api} rows={5}>
            {(data) => {
                if (data.total === 0) return <Empty>No page views in this range.</Empty>;
                const slots = data.cells
                    .flatMap((hours, d) => hours.map((v, h) => ({ d, h, v })))
                    .filter((s) => s.v > 0)
                    .sort((a, b) => b.v - a.v)
                    .slice(0, 5);
                return (
                    <div>
                        <div className="overflow-x-auto">
                            <div className="min-w-[36rem]" role="img"
                                aria-label={`Heatmap of page views by weekday and hour in ${zone}. Busiest: ${slots.map((s) => `${WEEKDAYS[s.d]} ${hourLabel(s.h)}h ${s.v} views`).join(", ")}`}>
                                <div className="grid gap-px" style={{ gridTemplateColumns: "2.5rem repeat(24, minmax(0, 1fr))" }}>
                                    <span />
                                    {Array.from({ length: 24 }, (_, h) => (
                                        <span key={h} className="text-center font-mono text-[10px] text-muted">{h % 3 === 0 ? hourLabel(h) : ""}</span>
                                    ))}
                                    {data.cells.map((hours, d) => (
                                        <div key={d} className="contents">
                                            <span className="pr-1 text-right font-mono text-[11px] leading-6 text-muted">{WEEKDAYS[d]}</span>
                                            {hours.map((v, h) => (
                                                <span key={h} title={`${WEEKDAYS[d]} ${hourLabel(h)}:00 ${zone}: ${v} views`}
                                                    className="h-6 rounded-[3px] bg-rule/40"
                                                    style={v > 0 ? { background: `rgb(var(--signal) / ${0.15 + 0.85 * (v / data.max)})` } : undefined} />
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <p className="mt-3 text-xs text-muted">
                            Times in {zone}. Busiest slots:{" "}
                            {slots.map((s) => `${WEEKDAYS[s.d]} ${clockLabel(`2026-01-01T${String(s.h).padStart(2, "0")}:00:00Z`, "UTC", clock)} (${s.v})`).join(" · ")}
                        </p>
                    </div>
                );
            }}
        </Async>
    );
}

// ---------------------------------------------------------------------------
// Anomalies against the same weekday of the previous 8 weeks.
// ---------------------------------------------------------------------------
export function AnomaliesPanel() {
    const { from, to } = useDash();
    const api = useApi<AnomalyDay[]>(`/api/analytics/insights?${qs({ type: "anomalies", from, to })}`);
    return (
        <Async api={api} rows={2}>
            {(days) => {
                const flagged = days.filter((d) => d.flag);
                if (flagged.length === 0) {
                    return <Empty>No unusual days. A day is flagged when it is far outside the same weekday over the previous 8 weeks; days with a baseline under 10 views are never flagged.</Empty>;
                }
                return (
                    <ul className="space-y-2 text-sm">
                        {flagged.map((d) => (
                            <li key={d.day} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-rule px-3 py-2">
                                <span className={`label rounded-full px-2 py-0.5 ${d.flag === "high" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-signal/10 text-signal"}`}>{d.flag === "high" ? "High" : "Low"}</span>
                                <span className="font-mono">{d.day}</span>
                                <span className="text-ink-soft">{d.views.toLocaleString()} views vs about {d.expected.toLocaleString()} usual{d.ratio !== null ? ` (${d.ratio}×)` : ""}</span>
                            </li>
                        ))}
                    </ul>
                );
            }}
        </Async>
    );
}

// ---------------------------------------------------------------------------
// Edition performance (sortable) + publish-to-peak.
// ---------------------------------------------------------------------------
type SortKey = "date" | "views" | "visitors" | "finish" | "shares" | "avgSeconds" | "stories";

export function EditionsPanel() {
    const { from, to, zone, clock } = useDash();
    const cell = useCell();
    const api = useApi<EditionRow[]>(`/api/analytics/insights?${qs({ type: "editions", from, to })}`);
    const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "date", dir: -1 });

    const value = (e: EditionRow, key: SortKey): number | string =>
        key === "date" ? e.date : key === "finish" ? (e.views ? e.completions / e.views : 0) : (e[key] ?? -1);
    const heads: Array<[SortKey, string, boolean]> = [
        ["date", "Edition", false], ["views", "Views", true], ["visitors", "Visitors", true], ["finish", "Finish rate", true],
        ["shares", "Shares", true], ["avgSeconds", "Avg time", true], ["stories", "Stories", true]
    ];

    return (
        <Async api={api} rows={5}>
            {(rows) => {
                if (rows.length === 0) return <Empty>No edition views in this range.</Empty>;
                const sorted = [...rows].sort((a, b) => {
                    const x = value(a, sort.key);
                    const y = value(b, sort.key);
                    return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
                });
                return (
                    <div className="overflow-x-auto">
                        <table className={`w-full min-w-[40rem] border-collapse ${cell.text}`}>
                            <caption className="sr-only">Edition performance; click a column heading to sort</caption>
                            <thead>
                                <tr className="border-b border-rule">
                                    {heads.map(([key, label, right]) => (
                                        <th key={key} scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                                            className={`py-2 pr-4 font-normal ${right ? "text-right" : "text-left"}`}>
                                            <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }))}
                                                className="label hover:text-ink">
                                                {label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                                            </button>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.map((e) => (
                                    <tr key={e.date} className="border-b border-rule/60 last:border-0">
                                        <td className={`${cell.py} whitespace-nowrap pr-4`} title={e.generatedAt ? `Generated ${shortDateTime(e.generatedAt, zone, clock)} by ${e.model}` : undefined}>{e.date}</td>
                                        <td className={`${cell.py} pr-4 text-right tabular-nums`}>{e.views.toLocaleString()}</td>
                                        <td className={`${cell.py} pr-4 text-right tabular-nums text-ink-soft`}>{e.visitors.toLocaleString()}</td>
                                        <td className={`${cell.py} pr-4 text-right tabular-nums`}>{e.views ? `${Math.round((e.completions * 100) / e.views)}%` : "–"}</td>
                                        <td className={`${cell.py} pr-4 text-right tabular-nums text-ink-soft`}>{e.shares}</td>
                                        <td className={`${cell.py} pr-4 text-right tabular-nums text-ink-soft`}>{seconds(e.avgSeconds)}</td>
                                        <td className={`${cell.py} pr-4 text-right tabular-nums text-ink-soft`}>{e.stories ?? "–"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <p className="mt-2 text-xs text-muted">Views are of each edition (and its stories) inside the selected range, including views of older editions. Finish rate = finished reads ÷ views.</p>
                    </div>
                );
            }}
        </Async>
    );
}

export function PeakPanel() {
    const { from, to } = useDash();
    const api = useApi<PeakData>(`/api/analytics/insights?${qs({ type: "peak", from, to })}`);
    return (
        <Async api={api} rows={3}>
            {(data) => {
                if (data.total === 0) return <Empty>No views of editions generated in this range.</Empty>;
                return (
                    <div>
                        <MiniBars values={data.hours} height={72} highlight={data.peakHour}
                            title={(h) => `${h}–${h + 1} h after generation: ${data.hours[h]} views`} />
                        <div className="mt-1 flex justify-between font-mono text-[10px] text-muted"><span>0 h</span><span>24 h</span><span>48 h</span><span>72 h</span></div>
                        <p className="mt-3 text-xs text-ink-soft">
                            {data.shareFirst24h}% of views arrive in the first 24 hours and {data.shareFirst48h}% in the first 48 ({data.total.toLocaleString()} views across {data.editions} editions).
                            {data.peakHour !== null && ` Busiest hour: ${data.peakHour} hours after generation.`}
                        </p>
                    </div>
                );
            }}
        </Async>
    );
}

// ---------------------------------------------------------------------------
// Pipeline health + whether production traits relate to readership.
// ---------------------------------------------------------------------------
export function PipelinePanel() {
    const { zone, clock } = useDash();
    const cell = useCell();
    const api = useApi<PipelineData>(`/api/analytics/insights?${qs({ type: "pipeline" })}`);
    return (
        <Async api={api} rows={5}>
            {(data) => {
                const withCorr = data.correlations.filter((c) => c.r !== null);
                return (
                    <div className="space-y-5">
                        <div className="overflow-x-auto">
                            <table className={`w-full min-w-[40rem] border-collapse ${cell.text}`}>
                                <caption className="sr-only">Last 30 editions: how each was produced and how it was read</caption>
                                <thead>
                                    <tr className="border-b border-rule">
                                        <Th>Edition</Th><Th>Model</Th><Th right>Time</Th><Th right>Stories</Th><Th right>Linked</Th><Th right>Sites</Th><Th right>Views 48h</Th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.editions.map((e) => {
                                        const fallback = e.model.includes("gemini");
                                        const thin = e.stories < 8;
                                        return (
                                            <tr key={e.date} className="border-b border-rule/60 last:border-0">
                                                <td className={`${cell.py} whitespace-nowrap pr-4`} title={`Generated ${shortDateTime(e.generatedAt, zone, clock)}`}>{e.date}</td>
                                                <td className={`${cell.py} pr-4 ${fallback ? "text-signal" : "text-ink-soft"}`} title={fallback ? "Gemini fallback: Groq failed for this edition" : undefined}>{e.model.replace("openai/", "")}</td>
                                                <td className={`${cell.py} pr-4 text-right tabular-nums text-ink-soft`}>{e.latencySeconds === null ? "–" : `${e.latencySeconds}s`}</td>
                                                <td className={`${cell.py} pr-4 text-right tabular-nums ${thin ? "text-signal" : ""}`}>{e.stories}</td>
                                                <td className={`${cell.py} pr-4 text-right tabular-nums text-ink-soft`}>{e.linkedStories}</td>
                                                <td className={`${cell.py} pr-4 text-right tabular-nums text-ink-soft`}>{e.sourceHosts}</td>
                                                <td className={`${cell.py} pr-4 text-right tabular-nums`}>{e.views48h}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div>
                            <h4 className="label mb-2">Does how an edition is made relate to how it is read?</h4>
                            {withCorr.length === 0 ? (
                                <p className="text-xs text-muted">Not enough settled editions yet (needs 8) or no variation in these traits.</p>
                            ) : (
                                <ul className="space-y-1 text-sm">
                                    {withCorr.map((c) => (
                                        <li key={c.trait} className="flex items-center justify-between gap-3">
                                            <span className="text-ink-soft">{c.trait}</span>
                                            <span className="font-mono tabular-nums">{(c.r as number) > 0 ? "+" : ""}{c.r}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <p className="mt-2 text-xs text-muted">Correlation of each trait with views in an edition&apos;s first 48 hours (−1 to +1). With this few editions it is a hint, not proof, and says nothing about cause. Fact-check results are in the Production section.</p>
                        </div>
                    </div>
                );
            }}
        </Async>
    );
}

// ---------------------------------------------------------------------------
// Navigation paths.
// ---------------------------------------------------------------------------
const TYPE_LABEL: Record<string, string> = { home: "Home", edition: "Edition", story: "Story", archive: "Archive", latest: "Latest", "404": "404 page", other: "Other", exit: "Left the site" };
const typeLabel = (t: string) => TYPE_LABEL[t] ?? t;

export function NavPanel() {
    const { from, to } = useDash();
    const cell = useCell();
    const api = useApi<NavData>(`/api/analytics/insights?${qs({ type: "nav", from, to })}`);
    return (
        <Async api={api} rows={4}>
            {(data) => {
                if (data.transitions.length === 0) return <Empty>No page views in this range.</Empty>;
                const max = Math.max(...data.transitions.map((t) => t.count), 1);
                return (
                    <div className="grid gap-6 md:grid-cols-2">
                        <div>
                            <h4 className="label mb-2">Where readers go next</h4>
                            <ul className="space-y-1.5">
                                {data.transitions.map((t) => (
                                    <li key={`${t.from}>${t.to}`} className="flex items-center gap-3 text-sm">
                                        <span className="relative h-6 flex-1 overflow-hidden rounded-sm bg-rule/50">
                                            <span className="absolute inset-y-0 left-0 bg-signal/20" style={{ width: `${(t.count / max) * 100}%` }} />
                                            <span className="absolute inset-y-0 left-2 flex items-center text-xs">{typeLabel(t.from)} → {typeLabel(t.to)}</span>
                                        </span>
                                        <span className="w-10 text-right font-mono text-xs tabular-nums text-ink-soft">{t.count}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        <div>
                            <h4 className="label mb-2">Where sessions end</h4>
                            <table className={`w-full border-collapse ${cell.text}`}>
                                <thead><tr className="border-b border-rule"><Th>Page type</Th><Th right>Views</Th><Th right>Ended session</Th></tr></thead>
                                <tbody>
                                    {data.exits.map((e) => (
                                        <tr key={e.type} className="border-b border-rule/60 last:border-0">
                                            <td className={`${cell.py} pr-4`}>{typeLabel(e.type)}</td>
                                            <td className={`${cell.py} pr-4 text-right tabular-nums`}>{e.views}</td>
                                            <td className={`${cell.py} pr-4 text-right tabular-nums text-ink-soft`}>{e.exitPct}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                );
            }}
        </Async>
    );
}

// ---------------------------------------------------------------------------
// 404 trend + suggested redirects.
// ---------------------------------------------------------------------------
export function NotFoundPanel() {
    const { from, to } = useDash();
    const cell = useCell();
    const api = useApi<NotFoundData>(`/api/analytics/insights?${qs({ type: "notfound", from, to })}`);
    return (
        <Async api={api} rows={3}>
            {(data) => {
                if (data.paths.length === 0) return <Empty>No 404 pages in this range.</Empty>;
                return (
                    <div className="space-y-4">
                        <MiniBars values={data.daily.map((d) => d.views)} height={40} title={(i) => `${data.daily[i].day}: ${data.daily[i].views} 404 views`} />
                        <table className={`w-full border-collapse ${cell.text}`}>
                            <thead><tr className="border-b border-rule"><Th>Missing path</Th><Th right>Views</Th><Th>Closest real page</Th></tr></thead>
                            <tbody>
                                {data.paths.map((p) => (
                                    <tr key={p.path} className="border-b border-rule/60 last:border-0">
                                        <td className={`${cell.py} max-w-[16rem] truncate pr-4 font-mono text-xs`}>{p.path}</td>
                                        <td className={`${cell.py} pr-4 text-right tabular-nums`}>{p.views}</td>
                                        <td className={`${cell.py} max-w-[16rem] truncate pr-4 font-mono text-xs text-ink-soft`}>{p.suggestion ?? "no close match"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <p className="text-xs text-muted">Suggestions are the most similar real page by name. Check one before adding a redirect.</p>
                    </div>
                );
            }}
        </Async>
    );
}

// ---------------------------------------------------------------------------
// Tracking health.
// ---------------------------------------------------------------------------
export function QualityPanel() {
    const { zone, clock } = useDash();
    const api = useApi<QualityData>(`/api/analytics/insights?${qs({ type: "quality" })}`);
    return (
        <Async api={api} rows={3}>
            {(q) => {
                const stale = q.lastEvent ? Date.now() - Date.parse(q.lastEvent) > 24 * 3_600_000 : true;
                return (
                    <div className="space-y-4">
                        <div>
                            <MiniBars values={q.hourly.map((h) => h.events)} height={48}
                                title={(i) => `${shortDateTime(q.hourly[i].t, zone, clock)}: ${q.hourly[i].events} events`} />
                            <div className="mt-1 flex justify-between font-mono text-[10px] text-muted"><span>48 h ago</span><span>now</span></div>
                        </div>
                        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                            <div><dt className="label">Last event</dt><dd className={stale ? "text-signal" : ""}>{q.lastEvent ? `${relativeTime(q.lastEvent)} · ${shortDateTime(q.lastEvent, zone, clock)}` : "never"}</dd></div>
                            <div><dt className="label">Last page view</dt><dd>{q.lastPageview ? relativeTime(q.lastPageview) : "never"}</dd></div>
                            <div><dt className="label">Events, last 24 h</dt><dd className="tabular-nums">{q.eventsLast24h} <span className="text-xs text-muted">(avg {q.avgEventsPerDay7d}/day this week)</span></dd></div>
                            <div><dt className="label">Silent hours, last 24 h</dt><dd className="tabular-nums">{q.silentHours24h} of 24</dd></div>
                        </dl>
                        <p className="text-xs text-muted">Bots, Do-Not-Track and opted-out browsers are dropped before anything is stored, so a bot-filter rate and failed-ingest counts are not recorded here; ingest failures are written to the server log.</p>
                    </div>
                );
            }}
        </Async>
    );
}

// ---------------------------------------------------------------------------
// Link previews vs visits.
// ---------------------------------------------------------------------------
export function PreviewsPanel() {
    const { from, to } = useDash();
    const cell = useCell();
    const api = useApi<PreviewData>(`/api/analytics/insights?${qs({ type: "previews", from, to })}`);
    const totals = useMemo(() => api.data?.platforms.reduce((a, p) => a + p.previews, 0) ?? 0, [api.data]);
    return (
        <Async api={api} rows={3}>
            {(data) => {
                if (data.platforms.length === 0) return <Empty>No link previews fetched in this range.</Empty>;
                return (
                    <div className="grid gap-6 md:grid-cols-2">
                        <div>
                            <table className={`w-full border-collapse ${cell.text}`}>
                                <thead><tr className="border-b border-rule"><Th>Platform</Th><Th right>Previews</Th><Th right>Visits from it</Th></tr></thead>
                                <tbody>
                                    {data.platforms.map((p) => (
                                        <tr key={p.platform} className="border-b border-rule/60 last:border-0">
                                            <td className={`${cell.py} pr-4`}>{p.platform}</td>
                                            <td className={`${cell.py} pr-4 text-right tabular-nums`}>{p.previews}</td>
                                            <td className={`${cell.py} pr-4 text-right tabular-nums text-ink-soft`}>{p.visits}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className="mt-2 text-xs text-muted">{totals} preview fetches. A platform with many previews and no visits suggests the card is shown but not clicked: check its image and title.</p>
                        </div>
                        <div>
                            <h4 className="label mb-2">Most previewed links</h4>
                            <ul className="space-y-1 text-sm">
                                {data.pages.map((p) => (
                                    <li key={p.path} className="flex items-center justify-between gap-3">
                                        <span className="truncate font-mono text-xs">{p.path}</span>
                                        <span className="font-mono text-xs tabular-nums text-ink-soft">{p.previews}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                );
            }}
        </Async>
    );
}

export { SubHeading };
