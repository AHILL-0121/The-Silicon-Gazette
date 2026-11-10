"use client";

import { useState } from "react";

import type { Filters } from "@/lib/analytics/filters";
import { CHANNEL_LABELS, type Channel } from "@/lib/analytics/sources";
import { VITAL_THRESHOLDS, type VitalName } from "@/lib/analytics/vitals-client";

import { BarList } from "./charts";
import { Async, MiniBars, Stat, qs, useApi, useCell, useDash } from "./ui";

// Types mirror the JSON of /api/analytics/extras, /digest, /tokens and /annotations.

const nf = (n: number) => n.toLocaleString("en-US");

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
    return <th scope="col" className={`label whitespace-nowrap py-2 pr-4 font-normal ${right ? "text-right" : "text-left"}`}>{children}</th>;
}

function Empty({ children }: { children: React.ReactNode }) {
    return <p className="py-3 text-sm text-muted">{children}</p>;
}

/** Shown when a panel's table or credentials are not set up yet. */
function Setup({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-xl border border-dashed border-rule bg-paper/40 p-4 text-sm text-ink-soft">
            <p className="font-medium text-ink">{title}</p>
            <div className="mt-1 space-y-1 text-xs text-muted">{children}</div>
        </div>
    );
}

const TABLES_NOTE = (
    <p>The table for this does not exist in the database yet. Run <code className="font-mono">npx drizzle-kit push</code> from the frontend folder, then reload.</p>
);

/** Authenticated JSON request for the small write actions on this page. */
function useAuthedFetch() {
    const { token, onUnauthorized } = useDash();
    return async function request<T>(url: string, init: { method: string; body?: unknown }): Promise<T> {
        const res = await fetch(url, {
            method: init.method,
            headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}) },
            body: init.body ? JSON.stringify(init.body) : undefined
        });
        if (res.status === 401) {
            onUnauthorized();
            throw new Error("Session expired");
        }
        const data = (await res.json().catch(() => ({}))) as T & { error?: string };
        if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
        return data;
    };
}

// ---------------------------------------------------------------------------
// 1. Global filters
// ---------------------------------------------------------------------------
const DEVICES = ["mobile", "tablet", "desktop"] as const;

export function FilterBar({ filters, onChange, countries }: { filters: Filters; onChange: (next: Filters) => void; countries: string[] }) {
    const active = Boolean(filters.device || filters.country || filters.channel);
    const countryOptions = [...new Set([...countries.filter((c) => /^[A-Z]{2}$/.test(c)), ...(filters.country && filters.country !== "unknown" ? [filters.country] : [])])].sort();
    const set = (patch: Partial<Filters>) => {
        const next: Filters = { ...filters, ...patch };
        for (const key of Object.keys(next) as (keyof Filters)[]) if (!next[key]) delete next[key];
        onChange(next);
    };
    const select = "rounded-lg border border-rule bg-surface px-2 py-1.5 text-xs text-ink-soft";
    return (
        <div className="flex flex-wrap items-center gap-2 pb-2" role="group" aria-label="Filters for every number on the page">
            <span className="label">Filter</span>
            <select aria-label="Device" className={select} value={filters.device ?? ""} onChange={(e) => set({ device: (e.target.value || undefined) as Filters["device"] })}>
                <option value="">All devices</option>
                {DEVICES.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select aria-label="Country" className={select} value={filters.country ?? ""} onChange={(e) => set({ country: e.target.value || undefined })}>
                <option value="">All countries</option>
                {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                <option value="unknown">Unknown</option>
            </select>
            <select aria-label="Source channel" className={select} value={filters.channel ?? ""} onChange={(e) => set({ channel: e.target.value || undefined })}>
                <option value="">All sources</option>
                {(Object.keys(CHANNEL_LABELS) as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABELS[c]}</option>)}
            </select>
            {active && (
                <button type="button" onClick={() => onChange({})} className="label rounded-full border border-rule px-3 py-1.5 text-ink-soft hover:text-ink">Clear</button>
            )}
        </div>
    );
}

export function FilterNotice({ filters }: { filters: Filters }) {
    if (!filters.device && !filters.country && !filters.channel) return null;
    const parts = [filters.device, filters.country, filters.channel && CHANNEL_LABELS[filters.channel as Channel]].filter(Boolean).join(" · ");
    return (
        <div role="status" className="rounded-xl border border-signal/30 bg-signal/5 px-4 py-3 text-sm text-ink-soft">
            Filtered to <strong className="text-ink">{parts}</strong>. Traffic, visitors, sources, timing, stories and behavior follow the filter and are read from raw events, so they load a little slower.
            Alerts, the edition pipeline, tracking health, search console, custom metrics and the tools below do not.
        </div>
    );
}

// ---------------------------------------------------------------------------
// 6. Core Web Vitals
// ---------------------------------------------------------------------------
interface VitalsData {
    metrics: { metric: string; samples: number; p75: number | null; good: number; needsImprovement: number; poor: number }[];
    byDevice: { metric: string; device: string; samples: number; p75: number | null }[];
    slowPages: { path: string; samples: number; p75: number }[];
    daily: { day: string; lcp: number | null }[];
}

const VITAL_NAMES: Record<string, string> = {
    LCP: "Largest Contentful Paint", INP: "Interaction to Next Paint", CLS: "Cumulative Layout Shift", FCP: "First Contentful Paint", TTFB: "Time to First Byte"
};

function formatVital(metric: string, value: number | null): string {
    if (value === null) return "–";
    if (metric === "CLS") return value.toFixed(3);
    return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}

function ratingOf(metric: string, value: number | null): "good" | "needs" | "poor" | null {
    const t = VITAL_THRESHOLDS[metric as VitalName];
    if (!t || value === null) return null;
    return value <= t[0] ? "good" : value <= t[1] ? "needs" : "poor";
}

const RATING_TEXT = { good: "text-emerald-700 dark:text-emerald-300", needs: "text-amber-700 dark:text-amber-300", poor: "text-signal" } as const;

export function VitalsPanel() {
    const { from, to } = useDash();
    const cell = useCell();
    const api = useApi<VitalsData>(`/api/analytics/extras?${qs({ type: "vitals", from, to })}`);
    return (
        <Async api={api} rows={4}>
            {(data) => {
                if (data.metrics.length === 0) {
                    return <Empty>No samples in this range. Readers&apos; browsers report these numbers when they leave a page, so they appear a day after this feature ships. Browsers with Do Not Track on, bots and the opt-out are never measured.</Empty>;
                }
                const devices = [...new Set(data.byDevice.map((d) => d.device))].sort();
                return (
                    <div className="space-y-5">
                        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                            {data.metrics.map((m) => {
                                const rating = ratingOf(m.metric, m.p75);
                                const total = m.good + m.needsImprovement + m.poor;
                                return (
                                    <div key={m.metric} className="rounded-xl border border-rule p-3" title={VITAL_NAMES[m.metric]}>
                                        <dt className="label">{m.metric} · 75th pct</dt>
                                        <dd className={`mt-2 font-display text-2xl tabular-nums ${rating ? RATING_TEXT[rating] : ""}`}>{formatVital(m.metric, m.p75)}</dd>
                                        {total > 0 && (
                                            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-rule" role="img"
                                                aria-label={`${Math.round((m.good / total) * 100)}% good, ${Math.round((m.needsImprovement / total) * 100)}% needs improvement, ${Math.round((m.poor / total) * 100)}% poor`}>
                                                <span className="bg-emerald-500" style={{ width: `${(m.good / total) * 100}%` }} />
                                                <span className="bg-amber-500" style={{ width: `${(m.needsImprovement / total) * 100}%` }} />
                                                <span className="bg-signal" style={{ width: `${(m.poor / total) * 100}%` }} />
                                            </div>
                                        )}
                                        <p className="mt-1.5 text-xs text-muted">{nf(m.samples)} page loads</p>
                                    </div>
                                );
                            })}
                        </dl>
                        <p className="text-xs text-muted">Good means at or under {Object.entries(VITAL_THRESHOLDS).map(([k, v]) => `${k} ${k === "CLS" ? v[0] : v[0] >= 1000 ? `${v[0] / 1000} s` : `${v[0]} ms`}`).join(", ")}. The 75th percentile is the value three in four visits beat.</p>
                        {devices.length > 1 && (
                            <div className="overflow-x-auto">
                                <table className={`w-full min-w-[24rem] border-collapse ${cell.text}`}>
                                    <caption className="sr-only">75th percentile by device</caption>
                                    <thead><tr className="border-b border-rule"><Th>Device</Th>{data.metrics.map((m) => <Th key={m.metric} right>{m.metric}</Th>)}</tr></thead>
                                    <tbody>
                                        {devices.map((device) => (
                                            <tr key={device} className="border-b border-rule/60 last:border-0">
                                                <td className={`${cell.py} pr-4`}>{device}</td>
                                                {data.metrics.map((m) => {
                                                    const row = data.byDevice.find((d) => d.metric === m.metric && d.device === device);
                                                    const rating = ratingOf(m.metric, row?.p75 ?? null);
                                                    return <td key={m.metric} className={`${cell.py} pr-4 text-right tabular-nums ${rating ? RATING_TEXT[rating] : "text-muted"}`}>{formatVital(m.metric, row?.p75 ?? null)}</td>;
                                                })}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        {data.slowPages.length > 0 && (
                            <div>
                                <h4 className="label mb-2">Slowest pages by LCP</h4>
                                <BarList items={data.slowPages.map((p) => ({ label: p.path, value: p.p75, sublabel: `${p.samples} loads` }))} valueLabel="LCP ms" />
                            </div>
                        )}
                        {data.daily.length > 1 && (
                            <div>
                                <h4 className="label mb-2">LCP by day (75th percentile)</h4>
                                <MiniBars values={data.daily.map((d) => d.lcp ?? 0)} title={(i) => `${data.daily[i].day}: ${formatVital("LCP", data.daily[i].lcp)}`} />
                            </div>
                        )}
                    </div>
                );
            }}
        </Async>
    );
}

// ---------------------------------------------------------------------------
// 7. Bot-filter rate
// ---------------------------------------------------------------------------
type BotData = { available: false } | {
    accepted: number; bot: number; dnt: number; gpc: number; filteredPct: number | null; since: string | null;
    daily: { day: string; accepted: number; filtered: number }[];
};

export function BotFilterPanel() {
    const { from, to } = useDash();
    const api = useApi<BotData>(`/api/analytics/extras?${qs({ type: "botfilter", from, to })}`);
    return (
        <Async api={api} rows={2}>
            {(data) => {
                if ("available" in data) return <Setup title="Counter table missing">{TABLES_NOTE}</Setup>;
                const refused = data.bot + data.dnt + data.gpc;
                if (refused + data.accepted === 0) {
                    return <Empty>No counts in this range{data.since ? ` (counting began ${data.since})` : ". Counting starts once this release is live"}.</Empty>;
                }
                return (
                    <div className="space-y-4">
                        <dl className="grid grid-cols-2 gap-5 sm:grid-cols-5">
                            <Stat label="Refused" value={data.filteredPct === null ? "–" : `${data.filteredPct}%`} note="of events" />
                            <Stat label="Stored" value={data.accepted} />
                            <Stat label="Bots" value={data.bot} />
                            <Stat label="Do Not Track" value={data.dnt} />
                            <Stat label="Global Privacy Control" value={data.gpc} />
                        </dl>
                        {data.daily.length > 1 && (
                            <div>
                                <h4 className="label mb-2">Refused events per day</h4>
                                <MiniBars values={data.daily.map((d) => d.filtered)} title={(i) => `${data.daily[i].day}: ${data.daily[i].filtered} refused, ${data.daily[i].accepted} stored`} />
                            </div>
                        )}
                        <p className="text-xs text-muted">
                            Counted from {data.since ?? "the first request"}; earlier traffic was not counted. These requests are dropped before anything is stored, so only a daily tally exists: no IP, user agent or identifier. A high bot share explains why Search Console clicks can exceed the visits counted here.
                        </p>
                    </div>
                );
            }}
        </Async>
    );
}

// ---------------------------------------------------------------------------
// 2. Search Console
// ---------------------------------------------------------------------------
interface GscRow { clicks: number; impressions: number; ctr: number; position: number }
type GscData = { configured: false } | {
    configured: true; property: string; totals: GscRow;
    queries: (GscRow & { query: string })[]; pages: (GscRow & { page: string })[];
    daily: { day: string; clicks: number; impressions: number }[]; note: string;
};

export function SearchConsolePanel() {
    const { from, to } = useDash();
    const api = useApi<GscData>(`/api/analytics/extras?${qs({ type: "searchconsole", from, to })}`);
    if (api.error && !api.data) {
        return <Setup title="Search Console did not answer">
            <p>Check that the service account&apos;s email is added as a user on the property, and that <code className="font-mono">GSC_SITE_URL</code> matches it exactly (for a domain property: <code className="font-mono">sc-domain:example.com</code>).</p>
            <button type="button" onClick={api.reload} className="label mt-2 rounded-full border border-rule px-3 py-1 text-ink-soft hover:text-ink">Retry</button>
        </Setup>;
    }
    return (
        <Async api={api} rows={3}>
            {(data) => {
                if (!data.configured) {
                    return (
                        <Setup title="Connect Google Search Console">
                            <p>1. In Google Cloud, create a service account and enable the Search Console API. Download its JSON key.</p>
                            <p>2. In Search Console, Settings, Users and permissions: add the service account&apos;s email with Restricted (read) access.</p>
                            <p>3. Set <code className="font-mono">GSC_SERVICE_ACCOUNT_JSON</code> (the key, raw or base64) and, if needed, <code className="font-mono">GSC_SITE_URL</code> in the environment, then redeploy.</p>
                        </Setup>
                    );
                }
                return (
                    <div className="space-y-5">
                        <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                            <Stat label="Clicks" value={data.totals.clicks} />
                            <Stat label="Impressions" value={data.totals.impressions} />
                            <Stat label="Click rate" value={`${data.totals.ctr}%`} />
                            <Stat label="Avg position" value={data.totals.position || "–"} />
                        </dl>
                        {data.daily.length > 1 && <MiniBars values={data.daily.map((d) => d.clicks)} title={(i) => `${data.daily[i].day}: ${data.daily[i].clicks} clicks, ${nf(data.daily[i].impressions)} impressions`} />}
                        <div className="grid gap-6 lg:grid-cols-2">
                            <div>
                                <h4 className="label mb-2">Top searches</h4>
                                {data.queries.length === 0 ? <Empty>No searches in this range.</Empty>
                                    : <BarList valueLabel="Clicks" items={data.queries.map((q) => ({ label: q.query, value: q.clicks, sublabel: `${nf(q.impressions)} impressions · position ${q.position}` }))} />}
                            </div>
                            <div>
                                <h4 className="label mb-2">Top pages from search</h4>
                                {data.pages.length === 0 ? <Empty>No pages in this range.</Empty>
                                    : <BarList valueLabel="Clicks" items={data.pages.map((p) => ({ label: p.page.replace(/^https?:\/\/[^/]+/, "") || "/", value: p.clicks, sublabel: `${nf(p.impressions)} impressions · position ${p.position}` }))} />}
                            </div>
                        </div>
                        <p className="text-xs text-muted">{data.property} · {data.note}</p>
                    </div>
                );
            }}
        </Async>
    );
}

// ---------------------------------------------------------------------------
// 4. Pipeline: API usage, fact-check history, source reliability, quality vs engagement
// ---------------------------------------------------------------------------
type Unavailable = { available: false };

interface UsageData {
    byModel: { provider: string; model: string; kind: string; calls: number; failures: number; promptTokens: number; completionTokens: number; credits: number; avgLatencyMs: number | null }[];
    daily: { day: string; tokens: number; credits: number; calls: number }[];
    tavily: { monthCredits: number; monthlyLimit: number; usedPct: number };
    todayTokens: number;
    since: string | null;
}

export function UsagePanel() {
    const { from, to } = useDash();
    const cell = useCell();
    const api = useApi<UsageData | Unavailable>(`/api/analytics/extras?${qs({ type: "usage", from, to })}`);
    return (
        <Async api={api} rows={3}>
            {(data) => {
                if ("available" in data) return <Setup title="Usage table missing">{TABLES_NOTE}</Setup>;
                if (data.byModel.length === 0) return <Empty>No API calls recorded in this range{data.since ? ` (recording began ${data.since})` : ". Recording starts with the next edition that is generated"}.</Empty>;
                const tavilyWarn = data.tavily.usedPct >= 80;
                return (
                    <div className="space-y-5">
                        <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                            <Stat label="Tokens today" value={data.todayTokens} />
                            <Stat label="Tavily credits this month" value={`${data.tavily.monthCredits} / ${nf(data.tavily.monthlyLimit)}`} note={`${data.tavily.usedPct}%`} />
                            <Stat label="API calls in range" value={data.byModel.reduce((t, m) => t + m.calls, 0)} />
                            <Stat label="Failed calls" value={data.byModel.reduce((t, m) => t + m.failures, 0)} />
                        </dl>
                        {tavilyWarn && <p role="alert" className="text-sm text-signal">Tavily is at {data.tavily.usedPct}% of its monthly credits. Set NEWS_SOURCES=free to stop using them.</p>}
                        <div className="overflow-x-auto">
                            <table className={`w-full min-w-[36rem] border-collapse ${cell.text}`}>
                                <caption className="sr-only">API usage by provider and model</caption>
                                <thead><tr className="border-b border-rule"><Th>Provider</Th><Th>Model</Th><Th>Used for</Th><Th right>Calls</Th><Th right>Failed</Th><Th right>Tokens in</Th><Th right>Tokens out</Th><Th right>Credits</Th><Th right>Avg time</Th></tr></thead>
                                <tbody>
                                    {data.byModel.map((m) => (
                                        <tr key={`${m.provider}${m.model}${m.kind}`} className="border-b border-rule/60 last:border-0">
                                            <td className={`${cell.py} pr-4`}>{m.provider}</td>
                                            <td className={`${cell.py} pr-4 text-ink-soft`}>{m.model.replace("openai/", "") || "–"}</td>
                                            <td className={`${cell.py} pr-4 text-ink-soft`}>{m.kind}</td>
                                            <td className={`${cell.py} pr-4 text-right tabular-nums`}>{nf(m.calls)}</td>
                                            <td className={`${cell.py} pr-4 text-right tabular-nums ${m.failures > 0 ? "text-signal" : "text-muted"}`}>{m.failures}</td>
                                            <td className={`${cell.py} pr-4 text-right tabular-nums text-ink-soft`}>{m.promptTokens ? nf(m.promptTokens) : "–"}</td>
                                            <td className={`${cell.py} pr-4 text-right tabular-nums text-ink-soft`}>{m.completionTokens ? nf(m.completionTokens) : "–"}</td>
                                            <td className={`${cell.py} pr-4 text-right tabular-nums text-ink-soft`}>{m.credits || "–"}</td>
                                            <td className={`${cell.py} pr-4 text-right tabular-nums text-ink-soft`}>{m.avgLatencyMs === null ? "–" : `${(m.avgLatencyMs / 1000).toFixed(1)}s`}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {data.daily.length > 1 && (
                            <div>
                                <h4 className="label mb-2">Tokens per day</h4>
                                <MiniBars values={data.daily.map((d) => d.tokens)} title={(i) => `${data.daily[i].day}: ${nf(data.daily[i].tokens)} tokens, ${data.daily[i].calls} calls`} />
                            </div>
                        )}
                        <p className="text-xs text-muted">One row is written per call, with the token counts the provider reports. Tavily credits are an estimate from the search depth (2 advanced, 1 basic); set TAVILY_MONTHLY_CREDITS if your plan differs from 1,000.</p>
                    </div>
                );
            }}
        </Async>
    );
}

interface FactChecksData {
    rows: { date: string; model: string; storiesIn: number; storiesOut: number; droppedStories: number; trimmedSentences: number; headlinesReplaced: number; fallbackSummaries: number; droppedRepos: number; repoFixes: number; sourceRelabeled: number; marketBriefReplaced: boolean; dropped: { headline: string; reason: string }[] }[];
    totals: { editions: number; droppedStories: number; trimmedSentences: number; headlinesReplaced: number; cleanEditions: number };
}

export function FactCheckPanel() {
    const cell = useCell();
    const api = useApi<FactChecksData | Unavailable>(`/api/analytics/extras?${qs({ type: "factchecks" })}`);
    return (
        <Async api={api} rows={4}>
            {(data) => {
                if ("available" in data) return <Setup title="Fact-check table missing">{TABLES_NOTE}</Setup>;
                if (data.rows.length === 0) return <Empty>No fact checks recorded yet. Each edition that is generated from now on adds one row.</Empty>;
                const dropped = data.rows.flatMap((r) => r.dropped.map((d) => ({ ...d, date: r.date }))).slice(0, 8);
                return (
                    <div className="space-y-5">
                        <dl className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                            <Stat label="Editions checked" value={data.totals.editions} />
                            <Stat label="Needed no fixes" value={data.totals.cleanEditions} note={`${Math.round((data.totals.cleanEditions * 100) / data.totals.editions)}%`} />
                            <Stat label="Stories dropped" value={data.totals.droppedStories} />
                            <Stat label="Sentences removed" value={data.totals.trimmedSentences} />
                        </dl>
                        <div className="overflow-x-auto">
                            <table className={`w-full min-w-[40rem] border-collapse ${cell.text}`}>
                                <caption className="sr-only">What the fact check changed in each edition</caption>
                                <thead><tr className="border-b border-rule"><Th>Edition</Th><Th>Model</Th><Th right>Stories</Th><Th right>Dropped</Th><Th right>Sentences cut</Th><Th right>Headlines swapped</Th><Th right>Repos dropped</Th><Th right>Relabeled</Th></tr></thead>
                                <tbody>
                                    {data.rows.map((r) => {
                                        const fixes = r.droppedStories + r.trimmedSentences + r.headlinesReplaced + r.droppedRepos;
                                        const cellClass = (n: number) => `${cell.py} pr-4 text-right tabular-nums ${n > 0 ? "" : "text-muted"}`;
                                        return (
                                            <tr key={r.date} className="border-b border-rule/60 last:border-0">
                                                <td className={`${cell.py} whitespace-nowrap pr-4 ${fixes === 0 ? "" : "font-medium"}`}>{r.date}</td>
                                                <td className={`${cell.py} pr-4 text-ink-soft`}>{r.model.replace("openai/", "")}</td>
                                                <td className={`${cell.py} pr-4 text-right tabular-nums text-ink-soft`}>{r.storiesIn} → {r.storiesOut}</td>
                                                <td className={`${cellClass(r.droppedStories)} ${r.droppedStories > 0 ? "text-signal" : ""}`}>{r.droppedStories}</td>
                                                <td className={cellClass(r.trimmedSentences)}>{r.trimmedSentences}</td>
                                                <td className={cellClass(r.headlinesReplaced)}>{r.headlinesReplaced}</td>
                                                <td className={cellClass(r.droppedRepos)}>{r.droppedRepos}</td>
                                                <td className={cellClass(r.sourceRelabeled)}>{r.sourceRelabeled}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {dropped.length > 0 && (
                            <div>
                                <h4 className="label mb-2">Recently dropped stories</h4>
                                <ul className="space-y-1.5 text-sm">
                                    {dropped.map((d, i) => (
                                        <li key={i} className="text-ink-soft"><span className="font-mono text-xs text-muted">{d.date}</span> {d.headline} <span className="text-xs text-muted">({d.reason})</span></li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                );
            }}
        </Async>
    );
}

interface ReliabilityData { sources: { host: string; kept: number; dropped: number; editions: number; keptPct: number }[] }

export function ReliabilityPanel() {
    const cell = useCell();
    const api = useApi<ReliabilityData | Unavailable>(`/api/analytics/extras?${qs({ type: "reliability" })}`);
    return (
        <Async api={api} rows={4}>
            {(data) => {
                if ("available" in data) return <Setup title="Fact-check table missing">{TABLES_NOTE}</Setup>;
                if (data.sources.length === 0) return <Empty>No source data yet. It fills as fact-checked editions are generated.</Empty>;
                return (
                    <div className="space-y-2">
                        <div className="overflow-x-auto">
                            <table className={`w-full min-w-[28rem] border-collapse ${cell.text}`}>
                                <caption className="sr-only">Share of stories from each site that survived the fact check</caption>
                                <thead><tr className="border-b border-rule"><Th>Site</Th><Th right>Kept</Th><Th right>Dropped</Th><Th right>Editions</Th><Th right>Survival</Th></tr></thead>
                                <tbody>
                                    {data.sources.map((s) => (
                                        <tr key={s.host} className="border-b border-rule/60 last:border-0">
                                            <td className={`${cell.py} pr-4`}>{s.host}</td>
                                            <td className={`${cell.py} pr-4 text-right tabular-nums`}>{s.kept}</td>
                                            <td className={`${cell.py} pr-4 text-right tabular-nums ${s.dropped > 0 ? "text-signal" : "text-muted"}`}>{s.dropped}</td>
                                            <td className={`${cell.py} pr-4 text-right tabular-nums text-ink-soft`}>{s.editions}</td>
                                            <td className={`${cell.py} pr-4 text-right tabular-nums ${s.keptPct < 60 ? "text-signal" : ""}`}>{s.keptPct}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="text-xs text-muted">Of the stories the model wrote from each site, the share that passed the fact check. A low share can mean the site is thin on checkable detail, not that it is wrong. Sites with few stories are noise.</p>
                    </div>
                );
            }}
        </Async>
    );
}

interface QualityEngagementData {
    editions: { date: string; fixes: number; droppedStories: number; views48h: number; completions48h: number }[];
    correlations: { trait: string; r: number | null }[];
    cleanAvgViews: number | null;
    fixedAvgViews: number | null;
}

export function QualityEngagementPanel() {
    const api = useApi<QualityEngagementData | Unavailable>(`/api/analytics/extras?${qs({ type: "quality" })}`);
    return (
        <Async api={api} rows={3}>
            {(data) => {
                if ("available" in data) return <Setup title="Fact-check table missing">{TABLES_NOTE}</Setup>;
                if (data.editions.length === 0) return <Empty>Nothing to compare yet.</Empty>;
                const withCorr = data.correlations.filter((c) => c.r !== null);
                return (
                    <div className="space-y-4">
                        <dl className="grid grid-cols-2 gap-5 sm:grid-cols-3">
                            <Stat label="Views 48h, no fixes needed" value={data.cleanAvgViews ?? "–"} note="average" />
                            <Stat label="Views 48h, fixes needed" value={data.fixedAvgViews ?? "–"} note="average" />
                            <Stat label="Editions compared" value={data.editions.length} />
                        </dl>
                        {withCorr.length === 0 ? (
                            <p className="text-xs text-muted">Not enough settled editions yet (needs 8), or no variation to measure.</p>
                        ) : (
                            <ul className="space-y-1 text-sm">
                                {withCorr.map((c) => (
                                    <li key={c.trait} className="flex items-center justify-between gap-3">
                                        <span className="text-ink-soft">{c.trait} vs views in the first 48 hours</span>
                                        <span className="font-mono tabular-nums">{(c.r as number) > 0 ? "+" : ""}{c.r}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        <p className="text-xs text-muted">Correlation runs from −1 to +1. A fix is a dropped story, a removed sentence, a swapped headline or a dropped repo. With a few dozen editions this is a hint at best, and it cannot say which way cause runs.</p>
                    </div>
                );
            }}
        </Async>
    );
}

// ---------------------------------------------------------------------------
// 5a. Manual annotations
// ---------------------------------------------------------------------------
interface AnnotationsData { available: boolean; annotations: { id: number; day: string; label: string }[] }

export function AnnotationsPanel({ onChange }: { onChange: () => void }) {
    const { from, to } = useDash();
    const request = useAuthedFetch();
    const api = useApi<AnnotationsData>(`/api/analytics/annotations?${qs({ from, to })}`);
    const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
    const [label, setLabel] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    async function add(event: React.FormEvent) {
        event.preventDefault();
        if (!label.trim()) return;
        setBusy(true);
        setError(null);
        try {
            await request("/api/analytics/annotations", { method: "POST", body: { day, label } });
            setLabel("");
            api.reload();
            onChange();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save");
        } finally {
            setBusy(false);
        }
    }

    async function remove(id: number) {
        try {
            await request(`/api/analytics/annotations?id=${id}`, { method: "DELETE" });
            api.reload();
            onChange();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not delete");
        }
    }

    return (
        <div className="space-y-3">
            <form onSubmit={add} className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-muted">Day
                    <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required className="rounded-lg border border-rule bg-surface px-2 py-1.5 text-sm text-ink" />
                </label>
                <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-muted">Note on the chart
                    <input type="text" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="Launched the newsletter" required
                        className="rounded-lg border border-rule bg-surface px-3 py-1.5 text-sm text-ink" />
                </label>
                <button type="submit" disabled={busy || !label.trim()} className="btn">{busy ? "Saving…" : "Add note"}</button>
            </form>
            {error && <p role="alert" className="text-sm text-signal">{error}</p>}
            <Async api={api} rows={1}>
                {(data) => !data.available ? <Setup title="Annotations table missing">{TABLES_NOTE}</Setup>
                    : data.annotations.length === 0 ? <p className="text-xs text-muted">No notes in this range. Notes appear as markers on the traffic chart.</p>
                        : (
                            <ul className="divide-y divide-rule/60 text-sm">
                                {data.annotations.map((a) => (
                                    <li key={a.id} className="flex items-center justify-between gap-3 py-1.5">
                                        <span><span className="font-mono text-xs text-muted">{a.day}</span> {a.label}</span>
                                        <button type="button" onClick={() => remove(a.id)} aria-label={`Delete note ${a.label}`} className="text-xs text-muted hover:text-signal">Delete</button>
                                    </li>
                                ))}
                            </ul>
                        )}
            </Async>
        </div>
    );
}

// ---------------------------------------------------------------------------
// 5b. API tokens
// ---------------------------------------------------------------------------
interface TokensData { available: boolean; tokens?: { id: number; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }[] }

export function TokensPanel() {
    const request = useAuthedFetch();
    const api = useApi<TokensData>("/api/analytics/tokens");
    const [name, setName] = useState("");
    const [created, setCreated] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [copied, setCopied] = useState(false);

    async function create(event: React.FormEvent) {
        event.preventDefault();
        setBusy(true);
        setError(null);
        setCopied(false);
        try {
            const result = await request<{ token: string }>("/api/analytics/tokens", { method: "POST", body: { name } });
            setCreated(result.token);
            setName("");
            api.reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not create");
        } finally {
            setBusy(false);
        }
    }

    async function revoke(id: number) {
        try {
            await request(`/api/analytics/tokens?id=${id}`, { method: "DELETE" });
            api.reload();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not revoke");
        }
    }

    const origin = typeof window === "undefined" ? "" : window.location.origin;
    return (
        <div className="space-y-3">
            <form onSubmit={create} className="flex flex-wrap items-end gap-2">
                <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-muted">Token name
                    <input type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Weekly spreadsheet" required
                        className="rounded-lg border border-rule bg-surface px-3 py-1.5 text-sm text-ink" />
                </label>
                <button type="submit" disabled={busy || !name.trim()} className="btn">{busy ? "Creating…" : "Create token"}</button>
            </form>
            {error && <p role="alert" className="text-sm text-signal">{error}</p>}
            {created && (
                <div className="rounded-xl border border-signal/30 bg-signal/5 p-3 text-sm" role="status">
                    <p className="font-medium">Copy this token now. It is shown once and cannot be recovered.</p>
                    <code className="mt-1 block break-all font-mono text-xs">{created}</code>
                    <div className="mt-2 flex gap-2">
                        <button type="button" className="label rounded-full border border-rule px-3 py-1 text-ink-soft hover:text-ink"
                            onClick={async () => { try { await navigator.clipboard.writeText(created); setCopied(true); } catch { /* select by hand */ } }}>{copied ? "Copied" : "Copy"}</button>
                        <button type="button" className="label rounded-full border border-rule px-3 py-1 text-ink-soft hover:text-ink" onClick={() => setCreated(null)}>Done</button>
                    </div>
                </div>
            )}
            <Async api={api} rows={2}>
                {(data) => !data.available ? <Setup title="Tokens table missing">{TABLES_NOTE}</Setup>
                    : (data.tokens ?? []).length === 0 ? <p className="text-xs text-muted">No tokens yet.</p>
                        : (
                            <ul className="divide-y divide-rule/60 text-sm">
                                {data.tokens!.map((t) => (
                                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                                        <span className={t.revokedAt ? "text-muted line-through" : ""}>
                                            {t.name} <span className="font-mono text-xs text-muted">{t.prefix}…</span>
                                            <span className="ml-2 text-xs text-muted">created {t.createdAt.slice(0, 10)} · {t.revokedAt ? `revoked ${t.revokedAt.slice(0, 10)}` : t.lastUsedAt ? `last used ${t.lastUsedAt.slice(0, 10)}` : "never used"}</span>
                                        </span>
                                        {!t.revokedAt && <button type="button" onClick={() => revoke(t.id)} className="text-xs text-muted hover:text-signal">Revoke</button>}
                                    </li>
                                ))}
                            </ul>
                        )}
            </Async>
            <p className="text-xs text-muted">
                A token can read the data routes (GET only) and nothing else: no backup, no token management, no writes. Example:{" "}
                <code className="break-all font-mono">curl -H &quot;Authorization: Bearer sga_…&quot; &quot;{origin}/api/analytics/summary?from=2026-11-01&amp;to=2026-11-07&quot;</code>
            </p>
        </div>
    );
}

// ---------------------------------------------------------------------------
// 3. Scheduled digest
// ---------------------------------------------------------------------------
interface DigestData {
    channels: { webhook: boolean; email: boolean };
    schedule: string;
    digest: { title: string; lines: string[]; alerts: { id: string; severity: string; message: string }[] };
}

export function DigestPanel() {
    const request = useAuthedFetch();
    const api = useApi<DigestData>("/api/analytics/digest");
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

    async function sendTest() {
        setBusy(true);
        setResult(null);
        try {
            const sent = await request<{ sent: { webhook: boolean; email: boolean } }>("/api/analytics/digest", { method: "POST" });
            const where = [sent.sent.webhook && "the webhook", sent.sent.email && "email"].filter(Boolean).join(" and ");
            setResult({ ok: true, text: `Sent to ${where || "no channel"}.` });
        } catch (err) {
            setResult({ ok: false, text: err instanceof Error ? err.message : "Send failed" });
        } finally {
            setBusy(false);
        }
    }

    return (
        <Async api={api} rows={3}>
            {(data) => {
                const any = data.channels.webhook || data.channels.email;
                return (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className={`chip ${data.channels.webhook ? "" : "chip-signal"}`}>Slack / Discord webhook: {data.channels.webhook ? "on" : "off"}</span>
                            <span className={`chip ${data.channels.email ? "" : "chip-signal"}`}>Email: {data.channels.email ? "on" : "off"}</span>
                            <span className="text-muted">{data.schedule}. Open alerts are pushed in the same run.</span>
                        </div>
                        {!any && (
                            <Setup title="Choose where the digest goes">
                                <p>Set <code className="font-mono">ANALYTICS_DIGEST_WEBHOOK_URL</code> (or reuse <code className="font-mono">ALERT_WEBHOOK_URL</code>) for a Slack or Discord channel.</p>
                                <p>For email set <code className="font-mono">RESEND_API_KEY</code>, <code className="font-mono">DIGEST_EMAIL_TO</code> and <code className="font-mono">DIGEST_EMAIL_FROM</code>. The schedule itself is the cron in vercel.json.</p>
                            </Setup>
                        )}
                        <div className="rounded-xl border border-rule p-4">
                            <h4 className="label mb-2">Preview: the next digest</h4>
                            <p className="mb-2 text-sm font-medium">{data.digest.title}</p>
                            <ul className="space-y-1 text-sm text-ink-soft">{data.digest.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <button type="button" className="btn" disabled={busy || !any} onClick={sendTest}>{busy ? "Sending…" : "Send a test now"}</button>
                            {result && <span role="status" className={`text-sm ${result.ok ? "text-ink-soft" : "text-signal"}`}>{result.text}</span>}
                        </div>
                    </div>
                );
            }}
        </Async>
    );
}
