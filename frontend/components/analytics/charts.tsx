"use client";

import { useEffect, useRef, useState } from "react";

import { clockLabel, dateLabel, dateTimeLabel, type ClockMode, type Zone } from "@/lib/analytics/timezone";

interface KpiTileProps {
    label: string;
    value: string | number;
    previous?: string | number;
    /** Optional small sparkline data as an array of numbers */
    sparkline?: number[];
    suffix?: string;
    /** Events behind this number. Under 20, a percentage change is noise and is shown greyed out. */
    sample?: number;
}

/** Below this many events a percentage change says nothing. */
const SMALL_SAMPLE = 20;

function pct(current: number, prev: number): { sign: string; value: string } {
    if (!prev) return { sign: "", value: "–" };
    const delta = ((current - prev) / prev) * 100;
    return {
        sign: delta > 0 ? "+" : delta < 0 ? "" : "",
        value: `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`
    };
}

export function KpiTile({ label, value, previous, sparkline, suffix, sample }: KpiTileProps) {
    const numValue = typeof value === "number" ? value : parseFloat(String(value).replace(/,/g, ""));
    const numPrev = typeof previous === "number" ? previous : parseFloat(String(previous ?? "0").replace(/,/g, ""));
    const change = previous !== undefined ? pct(numValue, numPrev) : null;
    const small = (sample ?? Math.max(numValue, numPrev)) < SMALL_SAMPLE;
    const up = change && !small && parseFloat(change.value) > 0;
    const down = change && !small && parseFloat(change.value) < 0;

    return (
        <div className="flex flex-col gap-2 rounded-2xl border border-rule bg-surface p-5">
            <span className="label">{label}</span>
            <div className="flex items-end justify-between gap-2">
                <span className="font-display text-3xl leading-none tabular-nums">
                    {typeof value === "number" ? value.toLocaleString() : value}
                    {suffix && <span className="ml-1 text-lg text-muted">{suffix}</span>}
                </span>
                {change && change.value !== "–" && (
                    <span
                        title={small ? `Small sample: fewer than ${SMALL_SAMPLE} events, so this change is mostly noise` : undefined}
                        className={`label rounded-full px-2 py-0.5 ${up ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : down ? "bg-signal/10 text-signal"
                                    : "bg-rule text-muted"
                            }`}
                    >
                        {change.value}{small ? " *" : ""}
                    </span>
                )}
            </div>
            {sparkline && sparkline.length > 1 && <Sparkline data={sparkline} />}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------
interface SparklineProps {
    data: number[];
    width?: number;
    height?: number;
}

export function Sparkline({ data, width = 120, height = 32 }: SparklineProps) {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pts = data.map((v, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((v - min) / range) * (height - 4);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return (
        <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            aria-hidden="true"
            className="mt-1 opacity-60"
        >
            <polyline
                points={pts.join(" ")}
                fill="none"
                stroke="rgb(var(--signal))"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

// ---------------------------------------------------------------------------
// BarList
// ---------------------------------------------------------------------------
interface BarListItem {
    label: string;
    value: number;
    sublabel?: string;
}

interface BarListProps {
    items: BarListItem[];
    valueLabel?: string;
}

export function BarList({ items, valueLabel = "Views" }: BarListProps) {
    const max = Math.max(...items.map((i) => i.value), 1);
    return (
        <div className="flex flex-col gap-2">
            {/* screen-reader table */}
            <div className="sr-only">
                <table>
                    <caption>Top items</caption>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>{valueLabel}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => (
                            <tr key={item.label}>
                                <td>{item.label}</td>
                                <td>{item.value}</td>
                            </tr>
                        ))}
                    </tbody>
            </table>
            </div>
            <div aria-hidden="true" className="flex flex-col gap-1.5">
                {items.map((item) => (
                    <div key={item.label} className="flex items-center gap-3 text-sm">
                        <div className="relative h-6 flex-1 overflow-hidden rounded-sm bg-rule/50">
                            <div
                                className="absolute left-0 top-0 h-full rounded-sm bg-signal/20 transition-all duration-500 motion-reduce:transition-none"
                                style={{ width: `${(item.value / max) * 100}%` }}
                            />
                            <span className="absolute inset-y-0 left-2 flex items-center truncate text-xs text-ink">
                                {item.label}
                                {item.sublabel && <span className="ml-1 text-muted">· {item.sublabel}</span>}
                            </span>
                        </div>
                        <span className="w-12 text-right font-mono text-xs tabular-nums text-ink-soft">
                            {item.value.toLocaleString()}
                        </span>
                    </div>
                ))}
                {items.length === 0 && (
                    <p className="py-4 text-center text-sm text-muted">No data for this range yet.</p>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// LineChart
// ---------------------------------------------------------------------------
interface LineChartPoint {
    /** ISO 8601 UTC bucket start. */
    t: string;
    views: number;
    visitors: number;
}

interface LineChartProps {
    data: LineChartPoint[];
    granularity?: "hour" | "day" | "week";
    /** Zone for hour labels. Day and week buckets are UTC days and are never shifted. */
    zone?: Zone;
    /** 12-hour or 24-hour clock for hour labels. */
    clock?: ClockMode;
    /** The previous period, same granularity, drawn dashed and compared bucket by bucket. */
    compare?: { t: string; views: number }[] | null;
    /** Events to mark on the time axis (e.g. an edition being generated). */
    markers?: { t: string; label: string }[];
    height?: number;
}

/** Axis label: "14:00" for hours (in `zone`), "09-19" for days and weeks. */
function axisLabel(t: string, granularity: LineChartProps["granularity"], zone: Zone, clock: ClockMode): string {
    return granularity === "hour" ? clockLabel(t, zone, clock) : t.slice(5, 10);
}

/** Second axis line for hourly charts: the date, shown where a new day starts. */
function axisDate(t: string, zone: Zone): string {
    return dateLabel(t, zone).slice(5);
}

/** Full label for tooltips and the screen-reader table. */
function fullLabel(t: string, granularity: LineChartProps["granularity"], zone: Zone, clock: ClockMode): string {
    if (granularity === "hour") return dateTimeLabel(t, zone, clock);
    if (granularity === "week") return `Week of ${t.slice(0, 10)} (UTC)`;
    return `${t.slice(0, 10)} (UTC day)`;
}

/** Minimum horizontal room per x-axis label, in px. Keeps the times from running together. */
const LABEL_SPACING = 72;
/** "12:30 PM" is wider than "12:30". */
const LABEL_SPACING_12H = 90;

export function LineChart({ data, granularity = "day", zone = "UTC", clock = "24h", compare = null, markers = [], height = 280 }: LineChartProps) {
    const spacing = granularity === "hour" && clock === "12h" ? LABEL_SPACING_12H : LABEL_SPACING;
    const [hover, setHover] = useState<number | null>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(720);

    // Draw at the real pixel width of the card so the chart fills it and text is never stretched.
    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const measure = () => setWidth(Math.max(320, Math.floor(el.getBoundingClientRect().width)));
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    if (!data.length) {
        return (
            <div className="flex items-center justify-center py-12 text-sm text-muted">
                No data for this range yet.
            </div>
        );
    }

    const hourly = granularity === "hour";
    const pad = { top: 12, right: 20, bottom: hourly ? 44 : 30, left: 44 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;

    const compared = compare && compare.length > 0 ? compare.slice(0, data.length) : null;
    const maxV = Math.max(...data.map((d) => Math.max(d.views, d.visitors)), ...(compared ?? []).map((d) => d.views), 1);
    const xOf = (i: number) => (i / (data.length - 1 || 1)) * innerW;
    const yOf = (v: number) => innerH - (v / maxV) * innerH;

    const line = (pick: (d: LineChartPoint) => number) =>
        data.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(pick(d)).toFixed(1)}`).join(" ");
    const viewsPath = line((d) => d.views);
    const comparePath = compared
        ? compared.map((d, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(d.views).toFixed(1)}`).join(" ")
        : null;

    // Each marker sits on the bucket that contains it.
    const bucketMs = granularity === "hour" ? 3_600_000 : granularity === "week" ? 7 * 86_400_000 : 86_400_000;
    const markerAt = markers
        .map((m) => ({ ...m, i: data.findIndex((d) => Date.parse(m.t) >= Date.parse(d.t) && Date.parse(m.t) < Date.parse(d.t) + bucketMs) }))
        .filter((m) => m.i >= 0);
    const visitorsPath = line((d) => d.visitors);

    // Y axis labels (deduplicated so a max of 1 doesn't repeat ticks)
    const yTicks = [...new Set([0, 0.5, 1].map((t) => Math.round(t * maxV)))];

    // X axis: as many labels as fit at LABEL_SPACING, evenly stepped; the last one is
    // only added when it would not touch its neighbour.
    const fit = Math.max(2, Math.floor(innerW / spacing));
    const step = Math.max(1, Math.ceil(data.length / fit));
    const labelIdx: number[] = [];
    for (let i = 0; i < data.length; i += step) labelIdx.push(i);
    const lastIdx = data.length - 1;
    if (labelIdx[labelIdx.length - 1] !== lastIdx && (lastIdx - labelIdx[labelIdx.length - 1]) * (innerW / (data.length - 1 || 1)) >= spacing) {
        labelIdx.push(lastIdx);
    }

    /** Nearest point to the pointer. */
    const onPointer = (event: React.PointerEvent<SVGRectElement>) => {
        const box = event.currentTarget.getBoundingClientRect();
        const ratio = (event.clientX - box.left) / box.width;
        setHover(Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1)))));
    };

    const hovered = hover !== null ? data[hover] : null;
    const tipLeftPx = hover !== null ? pad.left + xOf(hover) : 0;

    return (
        <div className="w-full">
            {/* Legend */}
            <div className="mb-3 flex items-center gap-4 text-xs text-muted">
                <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-signal" />
                    Views
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-ink/30" />
                    Visitors
                </span>
                {comparePath && (
                    <span className="flex items-center gap-1.5">
                        <svg width="16" height="6" aria-hidden="true"><line x1="0" y1="3" x2="16" y2="3" stroke="rgb(var(--signal))" strokeWidth="2" strokeDasharray="4 3" strokeOpacity="0.6" /></svg>
                        Previous period (views)
                    </span>
                )}
                {markerAt.length > 0 && <span className="flex items-center gap-1.5"><span aria-hidden="true" className="text-[10px]">▲</span>Edition generated</span>}
                {hourly && <span className="ml-auto font-mono text-[11px]">Times in {zone} · {clock === "12h" ? "12-hour" : "24-hour"}</span>}
            </div>

            {/* Screen-reader table */}
            <div className="sr-only">
                <table>
                    <caption>Views and visitors over time ({hourly ? zone : "UTC days"})</caption>
                    <thead>
                        <tr>
                            <th>{hourly ? "Hour" : granularity === "week" ? "Week" : "Date"}</th>
                            <th>Views</th>
                            <th>Visitors</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((d) => (
                            <tr key={d.t}>
                                <td>{fullLabel(d.t, granularity, zone, clock)}</td>
                                <td>{d.views}</td>
                                <td>{d.visitors}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div ref={wrapRef} className="relative w-full" aria-hidden="true">
                <svg width={width} height={height} className="block max-w-full">
                    <g transform={`translate(${pad.left},${pad.top})`}>
                        {/* Grid lines */}
                        {yTicks.map((tick) => (
                            <g key={tick}>
                                <line
                                    x1={0} y1={yOf(tick)} x2={innerW} y2={yOf(tick)}
                                    stroke="rgb(var(--rule))" strokeWidth="1"
                                />
                                <text x={-8} y={yOf(tick)} textAnchor="end" dominantBaseline="middle"
                                    fill="rgb(var(--muted))" fontSize="11">
                                    {tick >= 1000 ? `${(tick / 1000).toFixed(1)}k` : tick}
                                </text>
                            </g>
                        ))}

                        {/* Visitor area fill */}
                        <path
                            d={`${visitorsPath} L${xOf(data.length - 1).toFixed(1)},${innerH} L0,${innerH} Z`}
                            fill="rgb(var(--ink))"
                            fillOpacity="0.06"
                        />

                        {/* Previous period */}
                        {comparePath && (
                            <path d={comparePath} fill="none" stroke="rgb(var(--signal))" strokeWidth="1.75" strokeOpacity="0.55"
                                strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />
                        )}

                        {/* Markers */}
                        {markerAt.map((m) => (
                            <g key={m.t}>
                                <line x1={xOf(m.i)} y1={0} x2={xOf(m.i)} y2={innerH} stroke="rgb(var(--ink))" strokeOpacity="0.15" strokeDasharray="2 3" />
                                <path d={`M${xOf(m.i) - 4},${innerH} l4,-7 l4,7 z`} fill="rgb(var(--ink))" fillOpacity="0.55"><title>{m.label}</title></path>
                            </g>
                        ))}

                        {/* Lines */}
                        <path d={visitorsPath} fill="none" stroke="rgb(var(--ink))" strokeWidth="1.5"
                            strokeOpacity="0.4" strokeLinecap="round" strokeLinejoin="round" />
                        <path d={viewsPath} fill="none" stroke="rgb(var(--signal))" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round" />

                        {/* Hover guide */}
                        {hovered && hover !== null && (
                            <g>
                                <line x1={xOf(hover)} y1={0} x2={xOf(hover)} y2={innerH}
                                    stroke="rgb(var(--ink))" strokeOpacity="0.25" strokeDasharray="3 3" />
                                <circle cx={xOf(hover)} cy={yOf(hovered.visitors)} r="3" fill="rgb(var(--ink))" fillOpacity="0.5" />
                                <circle cx={xOf(hover)} cy={yOf(hovered.views)} r="3.5" fill="rgb(var(--signal))" />
                            </g>
                        )}

                        {/* X axis labels */}
                        {labelIdx.map((i, n) => {
                            const d = data[i];
                            const firstOfDay = hourly && (n === 0 || clockLabel(d.t, zone, "24h") === "00:00" || axisDate(d.t, zone) !== axisDate(data[labelIdx[n - 1]].t, zone));
                            return (
                                <text key={d.t} x={xOf(i)} y={innerH + 18}
                                    textAnchor={i === 0 ? "start" : i === lastIdx ? "end" : "middle"}
                                    fill="rgb(var(--muted))" fontSize="11">
                                    {axisLabel(d.t, granularity, zone, clock)}
                                    {firstOfDay && (
                                        <tspan x={xOf(i)} dy="14" fillOpacity="0.8">{axisDate(d.t, zone)}</tspan>
                                    )}
                                </text>
                            );
                        })}

                        {/* Pointer capture */}
                        <rect
                            x={0} y={0} width={innerW} height={innerH}
                            fill="transparent"
                            onPointerMove={onPointer}
                            onPointerDown={onPointer}
                            onPointerLeave={() => setHover(null)}
                        />
                    </g>
                </svg>

                {hovered && (
                    <div
                        className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-rule bg-surface px-3 py-2 text-xs shadow-md"
                        style={{ left: Math.min(Math.max(tipLeftPx, 80), width - 80) }}
                    >
                        <p className="font-medium text-ink">{fullLabel(hovered.t, granularity, zone, clock)}</p>
                        <p className="text-ink-soft">
                            <span className="text-signal">●</span> {hovered.views.toLocaleString()} views
                        </p>
                        <p className="text-ink-soft">
                            <span className="text-muted">●</span> {hovered.visitors.toLocaleString()} visitors
                        </p>
                        {compared && hover !== null && compared[hover] && (
                            <p className="text-ink-soft">
                                <span className="text-signal opacity-60">○</span> {compared[hover].views.toLocaleString()} views before
                            </p>
                        )}
                        {markerAt.filter((m) => m.i === hover).map((m) => (
                            <p key={m.t} className="text-ink-soft">▲ {m.label}</p>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------
interface FunnelStep {
    label: string;
    sessions: number;
}

export function Funnel({ steps }: { steps: FunnelStep[] }) {
    const max = steps[0]?.sessions || 1;
    return (
        <div className="flex flex-col gap-2">
            <div className="sr-only">
                <table>
                    <caption>Conversion funnel</caption>
                    <thead>
                        <tr>
                            <th>Step</th>
                            <th>Sessions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {steps.map((s) => (
                            <tr key={s.label}>
                                <td>{s.label}</td>
                                <td>{s.sessions}</td>
                            </tr>
                        ))}
                    </tbody>
            </table>
            </div>
            <div aria-hidden="true" className="flex flex-col gap-2">
                {steps.map((step, i) => {
                    const pct = (step.sessions / max) * 100;
                    const prevPct = i > 0 ? (steps[i - 1].sessions / max) * 100 : 100;
                    const dropoff = i > 0 ? prevPct - pct : 0;
                    return (
                        <div key={step.label} className="flex flex-col gap-1">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-ink-soft">{step.label}</span>
                                <span className="font-mono text-ink">{step.sessions.toLocaleString()}</span>
                            </div>
                            <div className="h-8 relative w-full overflow-hidden rounded bg-rule/40">
                                <div
                                    className="absolute left-0 top-0 h-full rounded bg-signal/70 transition-all duration-700 motion-reduce:transition-none"
                                    style={{ width: `${pct}%` }}
                                />
                            </div>
                            {i > 0 && dropoff > 0.1 && (
                                <span className="text-[11px] text-muted">
                                    −{dropoff.toFixed(1)}% drop-off
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
