"use client";

import { useEffect, useState } from "react";

import { EVENT_NAMES } from "@/lib/analytics/events";
import { METRIC_KEYS, METRIC_LABELS, type MetricKey } from "@/lib/analytics/metric-keys";
import { previousRange } from "@/lib/analytics/range";
import { shortDateTime } from "@/lib/analytics/timezone";

import { Async, Loading, MiniBars, Stat, qs, useApi, useCell, useDash } from "./ui";

// ---------------------------------------------------------------------------
// Story drill-down
// ---------------------------------------------------------------------------
interface TopRow { label: string; views: number; visitors: number }
interface StoryDetail {
    slug: string; views: number; visitors: number; completions: number; avgSeconds: number | null;
    depth: { depth: number; sessions: number }[];
    shares: { method: string; count: number }[];
    sources: { platform: string; sessions: number }[];
    countries: { country: string; views: number }[];
    daily: { day: string; views: number }[];
}

function Bars({ items, empty }: { items: { label: string; value: number }[]; empty: string }) {
    if (items.length === 0) return <p className="text-xs text-muted">{empty}</p>;
    const max = Math.max(...items.map((i) => i.value), 1);
    return (
        <ul className="space-y-1.5">
            {items.map((i) => (
                <li key={i.label} className="flex items-center gap-3 text-sm">
                    <span className="relative h-6 flex-1 overflow-hidden rounded-sm bg-rule/50">
                        <span className="absolute inset-y-0 left-0 bg-signal/20" style={{ width: `${(i.value / max) * 100}%` }} />
                        <span className="absolute inset-y-0 left-2 flex items-center truncate text-xs">{i.label}</span>
                    </span>
                    <span className="w-10 text-right font-mono text-xs tabular-nums text-ink-soft">{i.value}</span>
                </li>
            ))}
        </ul>
    );
}

export function StoryDrilldown({ slug, onSlug }: { slug: string | null; onSlug: (slug: string | null) => void }) {
    const { from, to } = useDash();
    const list = useApi<TopRow[]>(`/api/analytics/top?${qs({ from, to, kind: "stories", limit: 30 })}`);
    const detail = useApi<StoryDetail>(slug ? `/api/analytics/insights?${qs({ type: "story", from, to, slug })}` : null);

    return (
        <div className="space-y-5">
            <Async api={list} rows={1}>
                {(rows) => (
                    <div className="flex flex-wrap items-center gap-3">
                        <label htmlFor="story-pick" className="label">Story</label>
                        <select id="story-pick" value={slug ?? ""} onChange={(e) => onSlug(e.target.value || null)}
                            className="max-w-full rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm">
                            <option value="">{rows.length ? "Choose a story…" : "No story views in this range"}</option>
                            {slug && !rows.some((r) => r.label === slug) && <option value={slug}>{slug}</option>}
                            {rows.map((r) => <option key={r.label} value={r.label}>{r.label} ({r.views} views)</option>)}
                        </select>
                    </div>
                )}
            </Async>
            {slug && (
                <Async api={detail} rows={4}>
                    {(d) => {
                        const reached = Math.max(d.views, 1);
                        return (
                            <div className="space-y-6">
                                <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                                    <Stat label="Views" value={d.views} />
                                    <Stat label="Visitors" value={d.visitors} />
                                    <Stat label="Finished" value={d.completions} note={d.views ? `${Math.round((d.completions * 100) / d.views)}%` : undefined} />
                                    <Stat label="Avg time on page" value={d.avgSeconds === null ? "–" : `${d.avgSeconds}s`} />
                                </dl>
                                <div className="grid gap-6 md:grid-cols-2">
                                    <div>
                                        <h4 className="label mb-2">How far readers scrolled</h4>
                                        <ul className="space-y-1.5">
                                            {d.depth.map((step) => (
                                                <li key={step.depth} className="flex items-center gap-3 text-sm">
                                                    <span className="w-10 font-mono text-xs text-muted">{step.depth}%</span>
                                                    <span className="relative h-5 flex-1 overflow-hidden rounded-sm bg-rule/50">
                                                        <span className="absolute inset-y-0 left-0 bg-signal/60" style={{ width: `${Math.min(100, (step.sessions / reached) * 100)}%` }} />
                                                    </span>
                                                    <span className="w-24 text-right font-mono text-xs tabular-nums text-ink-soft">{step.sessions} · {d.views ? Math.round((step.sessions * 100) / d.views) : 0}%</span>
                                                </li>
                                            ))}
                                        </ul>
                                        <p className="mt-2 text-xs text-muted">Sessions that reached each depth, as a share of views. A steep fall-off marks where the story loses readers.</p>
                                    </div>
                                    <div>
                                        <h4 className="label mb-2">Views by day</h4>
                                        <MiniBars values={d.daily.map((x) => x.views)} height={72} title={(i) => `${d.daily[i].day}: ${d.daily[i].views} views`} />
                                    </div>
                                </div>
                                <div className="grid gap-6 md:grid-cols-3">
                                    <div><h4 className="label mb-2">Shared via</h4><Bars items={d.shares.map((s) => ({ label: s.method, value: s.count }))} empty="Not shared in this range." /></div>
                                    <div><h4 className="label mb-2">Readers came from</h4><Bars items={d.sources.map((s) => ({ label: s.platform, value: s.sessions }))} empty="No source data." /></div>
                                    <div><h4 className="label mb-2">Countries</h4><Bars items={d.countries.map((c) => ({ label: c.country, value: c.views }))} empty="No country data." /></div>
                                </div>
                            </div>
                        );
                    }}
                </Async>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Custom metrics (saved in this browser)
// ---------------------------------------------------------------------------
interface CustomMetric { id: string; name: string; num: MetricKey; den: MetricKey; as: "percent" | "ratio" }
interface MetricData { counts: Record<MetricKey, number> }

const METRICS_KEY = "sg-analytics-metrics";
const DEFAULT_METRICS: CustomMetric[] = [
    { id: "engaged", name: "Engaged-reader rate", num: "deep_sessions", den: "sessions", as: "percent" },
    { id: "finish", name: "Finish rate", num: "completions", den: "views", as: "percent" },
    { id: "share", name: "Share rate", num: "shares", den: "views", as: "percent" }
];

function format(metric: CustomMetric, counts: Record<MetricKey, number> | undefined): string {
    if (!counts || counts[metric.den] <= 0) return "–";
    const ratio = counts[metric.num] / counts[metric.den];
    return metric.as === "percent" ? `${(ratio * 100).toFixed(1)}%` : ratio.toFixed(2);
}

export function CustomMetrics() {
    const { from, to } = useDash();
    const prev = previousRange(from, to);
    const current = useApi<MetricData>(`/api/analytics/insights?${qs({ type: "metrics", from, to })}`);
    const previous = useApi<MetricData>(`/api/analytics/insights?${qs({ type: "metrics", from: prev.from, to: prev.to })}`);
    const [metrics, setMetrics] = useState<CustomMetric[]>(DEFAULT_METRICS);
    const [draft, setDraft] = useState<{ name: string; num: MetricKey; den: MetricKey; as: "percent" | "ratio" }>({ name: "", num: "shares", den: "visitors", as: "percent" });

    useEffect(() => {
        try {
            const stored = localStorage.getItem(METRICS_KEY);
            if (stored) setMetrics(JSON.parse(stored) as CustomMetric[]);
        } catch {
            // keep defaults
        }
    }, []);
    const save = (next: CustomMetric[]) => {
        setMetrics(next);
        try {
            localStorage.setItem(METRICS_KEY, JSON.stringify(next));
        } catch {
            // ignore
        }
    };

    return (
        <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {metrics.map((m) => {
                    const sample = current.data?.counts[m.den] ?? 0;
                    return (
                        <div key={m.id} className="rounded-xl border border-rule p-4">
                            <div className="flex items-start justify-between gap-2">
                                <span className="label">{m.name}</span>
                                <button type="button" onClick={() => save(metrics.filter((x) => x.id !== m.id))} aria-label={`Remove ${m.name}`}
                                    className="text-xs text-muted hover:text-signal">✕</button>
                            </div>
                            <p className="mt-2 font-display text-3xl tabular-nums">{format(m, current.data?.counts)}</p>
                            <p className="mt-1 text-xs text-muted">
                                {METRIC_LABELS[m.num]} ÷ {METRIC_LABELS[m.den]} · before: {format(m, previous.data?.counts)}
                                {current.data && sample < 20 && sample > 0 ? " · small sample" : ""}
                            </p>
                        </div>
                    );
                })}
            </div>
            <form className="flex flex-wrap items-end gap-3 border-t border-rule pt-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    const name = draft.name.trim();
                    if (!name) return;
                    save([...metrics, { id: `${Date.now()}`, name: name.slice(0, 40), num: draft.num, den: draft.den, as: draft.as }]);
                    setDraft({ ...draft, name: "" });
                }}>
                <label className="flex flex-col gap-1 text-xs text-muted">Name
                    <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={40} required placeholder="e.g. Repo click rate"
                        className="rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm text-ink" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">Count
                    <select value={draft.num} onChange={(e) => setDraft({ ...draft, num: e.target.value as MetricKey })} className="rounded-lg border border-rule bg-paper px-2 py-1.5 text-sm text-ink">
                        {METRIC_KEYS.map((k) => <option key={k} value={k}>{METRIC_LABELS[k]}</option>)}
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">Divided by
                    <select value={draft.den} onChange={(e) => setDraft({ ...draft, den: e.target.value as MetricKey })} className="rounded-lg border border-rule bg-paper px-2 py-1.5 text-sm text-ink">
                        {METRIC_KEYS.map((k) => <option key={k} value={k}>{METRIC_LABELS[k]}</option>)}
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">Show as
                    <select value={draft.as} onChange={(e) => setDraft({ ...draft, as: e.target.value as "percent" | "ratio" })} className="rounded-lg border border-rule bg-paper px-2 py-1.5 text-sm text-ink">
                        <option value="percent">Percent</option><option value="ratio">Ratio</option>
                    </select>
                </label>
                <button type="submit" className="btn">Add metric</button>
            </form>
            <p className="text-xs text-muted">Saved in this browser only. Each metric is one count divided by another over the selected range, compared with the period before it.</p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Event explorer
// ---------------------------------------------------------------------------
interface ExplorerRow { ts: string; name: string; path: string; visitor: string; sessionId: string; country: string | null; device: string; platform: string | null; props: Record<string, unknown> }
interface ExplorerData { rows: ExplorerRow[]; hasMore: boolean }
const PAGE = 25;

export function EventExplorer() {
    const { from, to, zone, clock } = useDash();
    const cell = useCell();
    const [filters, setFilters] = useState({ name: "", path: "", country: "", device: "" });
    const [applied, setApplied] = useState(filters);
    const [session, setSession] = useState<string | null>(null);
    const [page, setPage] = useState(0);

    useEffect(() => setPage(0), [from, to, applied, session]);

    const api = useApi<ExplorerData>(
        `/api/analytics/insights?${qs({
            type: "explorer", from, to, name: applied.name, path: applied.path,
            country: applied.country.length === 2 ? applied.country : undefined,
            device: applied.device, session: session ?? undefined, limit: PAGE, offset: page * PAGE
        })}`
    );

    return (
        <div className="space-y-4">
            <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); setSession(null); setApplied(filters); }}>
                <label className="flex flex-col gap-1 text-xs text-muted">Event
                    <select value={filters.name} onChange={(e) => setFilters({ ...filters, name: e.target.value })} className="rounded-lg border border-rule bg-paper px-2 py-1.5 text-sm text-ink">
                        <option value="">Any</option>{EVENT_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">Path contains
                    <input value={filters.path} onChange={(e) => setFilters({ ...filters, path: e.target.value })} maxLength={100} className="rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm text-ink" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">Country
                    <input value={filters.country} onChange={(e) => setFilters({ ...filters, country: e.target.value.toUpperCase().slice(0, 2) })} placeholder="IN" className="w-16 rounded-lg border border-rule bg-paper px-3 py-1.5 text-sm text-ink" />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted">Device
                    <select value={filters.device} onChange={(e) => setFilters({ ...filters, device: e.target.value })} className="rounded-lg border border-rule bg-paper px-2 py-1.5 text-sm text-ink">
                        <option value="">Any</option><option value="mobile">mobile</option><option value="tablet">tablet</option><option value="desktop">desktop</option>
                    </select>
                </label>
                <button type="submit" className="btn">Search</button>
            </form>

            {session && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rule bg-paper px-3 py-2 text-sm">
                    <span>Session timeline <span className="font-mono text-xs">{session.slice(0, 8)}</span>, oldest first</span>
                    <button type="button" onClick={() => setSession(null)} className="label rounded-full border border-rule px-3 py-1 hover:text-ink">Back to all events</button>
                </div>
            )}

            <Async api={api} rows={5}>
                {(data) => data.rows.length === 0 ? <p className="py-3 text-sm text-muted">No events match.</p> : (
                    <div className="overflow-x-auto">
                        <table className={`w-full min-w-[44rem] border-collapse ${cell.text}`}>
                            <caption className="sr-only">Raw events</caption>
                            <thead><tr className="border-b border-rule">{["Time", "Event", "Path", "Where", "Details", ""].map((h) => <th key={h} scope="col" className="label py-2 pr-4 text-left font-normal">{h}</th>)}</tr></thead>
                            <tbody>
                                {data.rows.map((r, i) => {
                                    const offset = session ? Math.round((Date.parse(r.ts) - Date.parse(data.rows[0].ts)) / 1000) : null;
                                    return (
                                        <tr key={`${r.ts}-${i}`} className="border-b border-rule/60 align-top last:border-0">
                                            <td className={`${cell.py} whitespace-nowrap pr-4`}>{shortDateTime(r.ts, zone, clock)}{offset !== null && <span className="ml-2 text-xs text-muted">+{offset}s</span>}</td>
                                            <td className={`${cell.py} pr-4 font-mono text-xs`}>{r.name}</td>
                                            <td className={`${cell.py} max-w-[14rem] truncate pr-4 font-mono text-xs`} title={r.path}>{r.path}</td>
                                            <td className={`${cell.py} whitespace-nowrap pr-4 text-ink-soft`}>{[r.country, r.device, r.platform].filter(Boolean).join(" · ")}</td>
                                            <td className={`${cell.py} max-w-[14rem] truncate pr-4 font-mono text-[11px] text-muted`} title={JSON.stringify(r.props)}>{Object.keys(r.props).length ? JSON.stringify(r.props) : ""}</td>
                                            <td className={`${cell.py}`}>{!session && <button type="button" onClick={() => setSession(r.sessionId)} className="label hover:text-ink">timeline</button>}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div className="mt-3 flex items-center gap-3">
                            <button type="button" className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Newer</button>
                            <span className="text-xs text-muted">Page {page + 1}</span>
                            <button type="button" className="btn" disabled={!data.hasMore} onClick={() => setPage((p) => p + 1)}>Older →</button>
                        </div>
                    </div>
                )}
            </Async>
            <p className="text-xs text-muted">Visitors are only a daily pseudonym; a timeline is one browser tab&apos;s session, not a person.</p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Gemini: narrative + ask box
// ---------------------------------------------------------------------------
interface NarrativeData { text: string; droppedSentences: number }
interface AskData { title: string; query: string; data: { rows?: Record<string, unknown>[] } & Record<string, unknown>; answer: string; answerUnavailable?: boolean }

export function AiTools() {
    const { token, from, to, onUnauthorized } = useDash();
    const status = useApi<{ configured: boolean }>("/api/analytics/ai?mode=status");
    const [narrative, setNarrative] = useState<NarrativeData | null>(null);
    const [question, setQuestion] = useState("");
    const [answer, setAnswer] = useState<AskData | null>(null);
    const [busy, setBusy] = useState<"narrative" | "ask" | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function call(kind: "narrative" | "ask") {
        setBusy(kind);
        setError(null);
        try {
            const res = kind === "narrative"
                ? await fetch(`/api/analytics/ai?${qs({ from, to })}`, { headers: { Authorization: `Bearer ${token}` } })
                : await fetch("/api/analytics/ai", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
            if (res.status === 401) return onUnauthorized();
            const body = await res.json();
            if (!res.ok) throw new Error(body.error ?? "Request failed");
            if (kind === "narrative") setNarrative(body as NarrativeData);
            else setAnswer(body as AskData);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Request failed");
        } finally {
            setBusy(null);
        }
    }

    if (!status.data) return <Loading rows={2} />;
    if (!status.data.configured) return <p className="text-sm text-muted">AI features need <code className="font-mono">GEMINI_API_KEY</code> to be set on the server.</p>;

    const rows = answer?.data.rows ?? [];
    const columns = rows[0] ? Object.keys(rows[0]).slice(0, 6) : [];

    return (
        <div className="space-y-8">
            <div>
                <button type="button" className="btn" disabled={busy !== null} onClick={() => call("narrative")}>
                    {busy === "narrative" ? "Writing…" : "Summarise this period with Gemini"}
                </button>
                {narrative && (
                    <div className="mt-4 rounded-xl border border-rule bg-paper p-4">
                        <p className="text-sm leading-relaxed">{narrative.text || "Nothing in the summary could be verified against the data."}</p>
                        <p className="mt-2 text-xs text-muted">
                            Written by Gemini from this dashboard&apos;s numbers only.
                            {narrative.droppedSentences > 0 && ` ${narrative.droppedSentences} sentence(s) were removed because their figures were not in the data.`}
                        </p>
                    </div>
                )}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); if (question.trim().length >= 3) call("ask"); }} className="space-y-3">
                <label htmlFor="ask-q" className="label">Ask a question</label>
                <div className="flex flex-wrap gap-3">
                    <input id="ask-q" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300}
                        placeholder="Which story did Indian mobile readers finish most last month?"
                        className="min-w-0 flex-1 rounded-lg border border-rule bg-paper px-3 py-2 text-sm" />
                    <button type="submit" className="btn" disabled={busy !== null || question.trim().length < 3}>{busy === "ask" ? "Thinking…" : "Ask"}</button>
                </div>
                <p className="text-xs text-muted">Gemini only picks one of seven ready-made queries (stories, traffic by day, sources, countries, editions, busiest hours, totals) and fills in dates and filters. It never writes SQL.</p>
            </form>
            {error && <p role="alert" className="text-sm text-signal">{error}</p>}
            {answer && (
                <div className="space-y-3 rounded-xl border border-rule bg-paper p-4">
                    <h4 className="font-display text-lg">{answer.title}</h4>
                    {answer.answer && <p className="text-sm">{answer.answer}</p>}
                    {answer.answerUnavailable && <p className="text-xs text-muted">Gemini was too busy to write a sentence, but the data below is the answer.</p>}
                    {rows.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse text-xs">
                                <thead><tr className="border-b border-rule">{columns.map((c) => <th key={c} scope="col" className="label py-1.5 pr-4 text-left font-normal">{c}</th>)}</tr></thead>
                                <tbody>{rows.slice(0, 12).map((r, i) => <tr key={i} className="border-b border-rule/60 last:border-0">{columns.map((c) => <td key={c} className="max-w-[16rem] truncate py-1.5 pr-4 font-mono">{String(r[c] ?? "")}</td>)}</tr>)}</tbody>
                            </table>
                        </div>
                    )}
                    <p className="text-xs text-muted">Query used: <span className="font-mono">{answer.query}</span>. {String(answer.data.from ?? "")} → {String(answer.data.to ?? "")} (UTC days).</p>
                </div>
            )}
        </div>
    );
}
