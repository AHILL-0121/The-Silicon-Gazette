"use client";

import { useState } from "react";

import { CHANNEL_LABELS, type Channel } from "@/lib/analytics/sources";
import { SHARE_TARGETS } from "@/lib/share";

import { BarList } from "./charts";

// ---------------------------------------------------------------------------
// Types (mirror lib/analytics/queries SourcesResult)
// ---------------------------------------------------------------------------
interface SourceRow {
    channel: string;
    platform: string;
    sessions: number;
    visitors: number;
    views: number;
    storySessions: number;
    completeSessions: number;
    shareSessions: number;
}

interface CampaignRow {
    campaign: string;
    platform: string;
    medium: string;
    sessions: number;
    storySessions: number;
    completeSessions: number;
}

export interface SourcesData {
    totalSessions: number;
    channels: { channel: string; sessions: number; visitors: number }[];
    platforms: SourceRow[];
    campaigns: CampaignRow[];
    shares: { method: string; placement: string; count: number }[];
    previews: { platform: string; count: number }[];
}

const SHARE_LABELS: Record<string, string> = {
    ...Object.fromEntries(SHARE_TARGETS.map((t) => [t.id, t.label])),
    copy: "Copied link",
    native: "Share sheet"
};

const PLACEMENT_LABELS: Record<string, string> = {
    story: "Story header",
    edition: "Edition lead",
    footer: "Footer",
    "": "Before placements were recorded"
};

function channelLabel(channel: string): string {
    return CHANNEL_LABELS[channel as Channel] ?? channel;
}

function pct(part: number, whole: number): string {
    return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}

/** Sums `count` by `key`, largest first. */
function totals<T>(items: T[], key: (item: T) => string, count: (item: T) => number) {
    const map = new Map<string, number>();
    for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + count(item));
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

const th = "label py-2 pr-3 text-left font-normal";
const thNum = "label py-2 pl-3 text-right font-normal";
const td = "py-2 pr-3";
const tdNum = "py-2 pl-3 text-right font-mono text-xs tabular-nums text-ink-soft";

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------
export function SourcesSection({ data }: { data: SourcesData }) {
    const shareTotal = data.shares.reduce((total, s) => total + s.count, 0);
    const shareByPlatform = totals(data.shares, (s) => SHARE_LABELS[s.method] ?? s.method, (s) => s.count);
    const shareByPlacement = totals(data.shares, (s) => PLACEMENT_LABELS[s.placement] ?? s.placement, (s) => s.count);
    const direct = data.channels.find((c) => c.channel === "direct")?.sessions ?? 0;

    return (
        <div className="space-y-8">
            <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
                <div>
                    <h3 className="label mb-3">Channels · {data.totalSessions.toLocaleString()} sessions</h3>
                    <BarList
                        items={data.channels.map((c) => ({
                            label: channelLabel(c.channel),
                            value: c.sessions,
                            sublabel: pct(c.sessions, data.totalSessions)
                        }))}
                        valueLabel="Sessions"
                    />
                    {direct > 0 && (
                        <p className="mt-3 text-xs text-muted">
                            Direct / unknown includes apps that send no referrer (WhatsApp, Discord, Signal, email apps).
                            Tagged links move these visits to their platform.
                        </p>
                    )}
                </div>

                <div className="min-w-0">
                    <h3 className="label mb-3">Platforms</h3>
                    {data.platforms.length === 0 ? (
                        <p className="py-4 text-center text-sm text-muted">No data for this range yet.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[34rem] text-sm">
                                <thead className="border-b border-rule">
                                    <tr>
                                        <th scope="col" className={th}>Platform</th>
                                        <th scope="col" className={th}>Channel</th>
                                        <th scope="col" className={thNum}>Sessions</th>
                                        <th scope="col" className={thNum} title="Page views per session">Pages / session</th>
                                        <th scope="col" className={thNum} title="Sessions that finished a story, of those that opened one">Read rate</th>
                                        <th scope="col" className={thNum} title="Sessions that shared">Share rate</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-rule/60">
                                    {data.platforms.map((p) => (
                                        <tr key={`${p.channel}:${p.platform}`}>
                                            <th scope="row" className={`${td} max-w-[12rem] truncate text-left font-normal text-ink`}>{p.platform}</th>
                                            <td className={`${td} text-ink-soft`}>{channelLabel(p.channel)}</td>
                                            <td className={tdNum}>{p.sessions.toLocaleString()}</td>
                                            <td className={tdNum}>{p.sessions > 0 ? (p.views / p.sessions).toFixed(1) : "–"}</td>
                                            <td className={tdNum}>{pct(p.completeSessions, p.storySessions)}</td>
                                            <td className={tdNum}>{pct(p.shareSessions, p.sessions)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            <div className="grid gap-8 lg:grid-cols-3">
                <div className="min-w-0">
                    <h3 className="label mb-3">Campaigns</h3>
                    {data.campaigns.length === 0 ? (
                        <p className="text-sm text-muted">
                            No tagged campaigns in this range. Use the link builder below when you post a link.
                        </p>
                    ) : (
                        <BarList
                            items={data.campaigns.map((c) => ({
                                // One campaign can run on several platforms; labels must be unique.
                                label: `${c.campaign} · ${c.platform}`,
                                value: c.sessions,
                                sublabel: c.medium || undefined
                            }))}
                            valueLabel="Sessions"
                        />
                    )}
                </div>

                <div className="min-w-0">
                    <h3 className="label mb-3">Reader shares · {shareTotal.toLocaleString()} clicks</h3>
                    <BarList items={shareByPlatform} valueLabel="Clicks" />
                    {shareByPlacement.length > 0 && (
                        <>
                            <h4 className="label mb-2 mt-4">By button</h4>
                            <BarList items={shareByPlacement} valueLabel="Clicks" />
                        </>
                    )}
                </div>

                <div className="min-w-0">
                    <h3 className="label mb-1">Link previews</h3>
                    <p className="mb-3 text-xs text-muted">
                        Preview cards built when a link is pasted. Shows where links are shared, even when the clicks arrive as direct. Approximate.
                    </p>
                    <BarList
                        items={data.previews.map((p) => ({ label: p.platform, value: p.count }))}
                        valueLabel="Previews"
                    />
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Link builder: tagged links for posting the site yourself
// ---------------------------------------------------------------------------
const BUILDER_SOURCES = [
    ["linkedin", "LinkedIn"],
    ["x", "X"],
    ["whatsapp", "WhatsApp"],
    ["instagram", "Instagram"],
    ["facebook", "Facebook"],
    ["reddit", "Reddit"],
    ["hackernews", "Hacker News"],
    ["producthunt", "Product Hunt"],
    ["telegram", "Telegram"],
    ["discord", "Discord"],
    ["slack", "Slack"],
    ["youtube", "YouTube"],
    ["tiktok", "TikTok"],
    ["threads", "Threads"],
    ["bluesky", "Bluesky"],
    ["newsletter", "Newsletter"]
] as const;

const BUILDER_MEDIUMS = [
    ["social", "Organic post"],
    ["email", "Email"],
    ["paid", "Paid ad"],
    ["referral", "Referral / partner"],
    ["", "None"]
] as const;

function slug(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function LinkBuilder() {
    const [path, setPath] = useState("/");
    const [source, setSource] = useState<string>("linkedin");
    const [customSource, setCustomSource] = useState("");
    const [medium, setMedium] = useState<string>("social");
    const [campaign, setCampaign] = useState("");
    const [copied, setCopied] = useState(false);

    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const sourceTag = source === "other" ? slug(customSource) : source;
    const url = (() => {
        try {
            const built = new URL(path.trim() || "/", origin || "http://localhost");
            if (sourceTag) built.searchParams.set("utm_source", sourceTag);
            if (medium) built.searchParams.set("utm_medium", medium);
            if (slug(campaign)) built.searchParams.set("utm_campaign", slug(campaign));
            return built.toString();
        } catch {
            return "";
        }
    })();

    async function copy() {
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopied(false);
        }
    }

    const field = "w-full rounded-lg border border-rule bg-paper px-3 py-2 text-sm text-ink";

    return (
        <div>
            <p className="mb-4 text-xs text-muted">
                Tag every link you post so its visits are credited to the right platform and campaign. Apps like WhatsApp and Discord send no referrer, so an untagged link from them counts as direct.
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <label className="flex flex-col gap-1.5">
                    <span className="label">Page</span>
                    <input className={field} value={path} onChange={(e) => setPath(e.target.value)} placeholder="/" />
                </label>
                <label className="flex flex-col gap-1.5">
                    <span className="label">Platform</span>
                    <select className={field} value={source} onChange={(e) => setSource(e.target.value)}>
                        {BUILDER_SOURCES.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                        ))}
                        <option value="other">Other…</option>
                    </select>
                </label>
                <label className="flex flex-col gap-1.5">
                    <span className="label">Type</span>
                    <select className={field} value={medium} onChange={(e) => setMedium(e.target.value)}>
                        {BUILDER_MEDIUMS.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1.5">
                    <span className="label">Campaign (optional)</span>
                    <input className={field} value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="launch-week" />
                </label>
                {source === "other" && (
                    <label className="flex flex-col gap-1.5 sm:col-span-2">
                        <span className="label">Platform name</span>
                        <input className={field} value={customSource} onChange={(e) => setCustomSource(e.target.value)} placeholder="my-podcast" />
                    </label>
                )}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
                <code className="min-w-0 flex-1 break-all rounded-lg border border-rule bg-paper px-3 py-2 font-mono text-xs text-ink">
                    {url || "Enter a valid page path"}
                </code>
                <button type="button" className="btn" onClick={copy} disabled={!url || !sourceTag}>
                    {copied ? "Copied" : "Copy link"}
                </button>
            </div>
            <p className="mt-2 text-xs text-muted" aria-live="polite">
                {copied ? "Link copied to clipboard." : "Short form without a campaign: add ?ref=platform to any link."}
            </p>
        </div>
    );
}
