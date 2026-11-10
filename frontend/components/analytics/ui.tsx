"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

import type { Filters } from "@/lib/analytics/filters";
import type { ClockMode, Zone } from "@/lib/analytics/timezone";

// ---------------------------------------------------------------------------
// Dashboard context: what every panel needs to fetch and to format times.
// ---------------------------------------------------------------------------
export type Density = "comfortable" | "compact";

export interface DashContextValue {
    token: string;
    /** UTC days, inclusive. */
    from: string;
    to: string;
    zone: Zone;
    clock: ClockMode;
    density: Density;
    /** Global filters; panels that support them get them added to their requests by useApi. */
    filters: Filters;
    onUnauthorized: () => void;
}

export const DashContext = createContext<DashContextValue | null>(null);

export function useDash(): DashContextValue {
    const value = useContext(DashContext);
    if (!value) throw new Error("useDash must be used inside the dashboard");
    return value;
}

/** Row padding and text size for tables, from the density setting. */
export function useCell() {
    const { density } = useDash();
    return density === "compact"
        ? { py: "py-1", text: "text-xs", gap: "gap-1" }
        : { py: "py-2.5", text: "text-sm", gap: "gap-2" };
}

// ---------------------------------------------------------------------------
// Data hook
// ---------------------------------------------------------------------------
export function qs(params: Record<string, string | number | undefined | null>): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
    }
    return search.toString();
}

export interface ApiState<T> {
    data: T | null;
    error: boolean;
    loading: boolean;
    reload: () => void;
}

/** Endpoints (and insight types) whose queries honour the global filters. */
const FILTERED_INSIGHTS = new Set(["heatmap", "editions", "peak", "story", "nav", "anomalies"]);
const FILTERED_EXTRAS = new Set(["vitals"]);
const FILTERED_PATHS = /^\/api\/analytics\/(summary|timeseries|top|events|sources|visitors)(\?|$)/;

/** Appends the active filters to a request for a route that supports them. */
export function withFilters(path: string, filters: Filters): string {
    if (!filters.device && !filters.country && !filters.channel) return path;
    const type = /[?&]type=([a-z]+)/.exec(path)?.[1] ?? "";
    const filtered = FILTERED_PATHS.test(path)
        || (path.startsWith("/api/analytics/insights") && FILTERED_INSIGHTS.has(type))
        || (path.startsWith("/api/analytics/extras") && FILTERED_EXTRAS.has(type));
    if (!filtered) return path;
    const extra = qs({ f_device: filters.device, f_country: filters.country, f_channel: filters.channel });
    return `${path}${path.includes("?") ? "&" : "?"}${extra}`;
}

/** GET `path` with the session token. `null` skips the request. Keeps the previous data while reloading. */
export function useApi<T>(rawPath: string | null): ApiState<T> {
    const { token, onUnauthorized, filters } = useDash();
    const path = rawPath === null ? null : withFilters(rawPath, filters);
    const [state, setState] = useState<{ data: T | null; error: boolean; loading: boolean }>({ data: null, error: false, loading: path !== null });
    const [nonce, setNonce] = useState(0);

    useEffect(() => {
        if (path === null) return;
        let cancelled = false;
        setState((s) => ({ ...s, loading: true, error: false }));
        fetch(path, { headers: { Authorization: `Bearer ${token}` } })
            .then((res) => {
                if (res.status === 401) {
                    onUnauthorized();
                    throw new Error("401");
                }
                if (!res.ok) throw new Error(String(res.status));
                return res.json() as Promise<T>;
            })
            .then((data) => {
                if (!cancelled) setState({ data, error: false, loading: false });
            })
            .catch((err: Error) => {
                if (!cancelled && err.message !== "401") setState((s) => ({ ...s, error: true, loading: false }));
            });
        return () => {
            cancelled = true;
        };
    }, [path, token, onUnauthorized, nonce]);

    const reload = useCallback(() => setNonce((n) => n + 1), []);
    return { ...state, reload };
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------
export function Loading({ rows = 4 }: { rows?: number }) {
    return (
        <div className="flex animate-pulse flex-col gap-2 motion-reduce:animate-none" role="status" aria-label="Loading">
            {Array.from({ length: rows }).map((_, i) => (
                <div key={i} className="h-6 rounded bg-rule/60" />
            ))}
        </div>
    );
}

export function ErrorBox({ onRetry, message = "Failed to load." }: { onRetry: () => void; message?: string }) {
    return (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-signal/30 bg-signal/5 p-4" role="alert">
            <p className="text-sm text-signal">{message}</p>
            <button type="button" onClick={onRetry}
                className="label rounded-full border border-rule px-3 py-1 text-ink-soft transition-colors hover:text-ink">
                Retry
            </button>
        </div>
    );
}

/** Renders loading / error / content for an ApiState. */
export function Async<T>({ api, rows, children }: { api: ApiState<T>; rows?: number; children: (data: T) => React.ReactNode }) {
    if (api.error && !api.data) return <ErrorBox onRetry={api.reload} />;
    if (!api.data) return <Loading rows={rows} />;
    return <div className={api.loading ? "opacity-60 transition-opacity" : "transition-opacity"}>{children(api.data)}</div>;
}

export function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
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

/** Vertical bars from a list of numbers; no measuring needed. `title(i)` labels each bar. */
export function MiniBars({ values, title, height = 64, highlight }: {
    values: number[];
    title: (index: number) => string;
    height?: number;
    /** Index to draw in the signal colour. */
    highlight?: number | null;
}) {
    const max = Math.max(...values, 1);
    return (
        <div className="flex items-end gap-px" style={{ height }} role="img" aria-label={`Bar chart, ${values.length} values, maximum ${max}`}>
            {values.map((v, i) => (
                <div key={i} title={title(i)} className="flex-1 rounded-t-sm"
                    style={{
                        height: `${Math.max(v > 0 ? 4 : 1, (v / max) * 100)}%`,
                        background: i === highlight ? "rgb(var(--signal))" : "rgb(var(--ink) / 0.28)"
                    }} />
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Collapsible panel; remembers whether it was open.
// ---------------------------------------------------------------------------
export const OPEN_PANEL_EVENT = "sg-open-panel";

export function Panel({ id, title, subtitle, actions, children }: {
    id: string;
    title: string;
    subtitle?: string;
    actions?: React.ReactNode;
    children: React.ReactNode;
}) {
    const key = `sg-analytics-open:${id}`;
    const [open, setOpen] = useState(true);

    useEffect(() => {
        try {
            if (localStorage.getItem(key) === "0") setOpen(false);
        } catch {
            // storage unavailable: stay open
        }
        // The section nav and command palette ask a collapsed panel to open before scrolling to it.
        const onOpen = (event: Event) => {
            if ((event as CustomEvent<string>).detail === id) setOpen(true);
        };
        window.addEventListener(OPEN_PANEL_EVENT, onOpen);
        return () => window.removeEventListener(OPEN_PANEL_EVENT, onOpen);
    }, [id, key]);

    const toggle = () => {
        setOpen((value) => {
            try {
                localStorage.setItem(key, value ? "0" : "1");
            } catch {
                // ignore
            }
            return !value;
        });
    };

    return (
        <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-44 rounded-2xl sm:scroll-mt-28 border border-rule bg-surface">
            <div className="flex items-start justify-between gap-3 p-5 sm:px-6">
                <button type="button" onClick={toggle} aria-expanded={open} aria-controls={`${id}-body`}
                    className="group flex min-w-0 flex-1 items-start gap-3 text-left">
                    <span aria-hidden="true" className={`mt-1.5 inline-block text-xs text-muted transition-transform ${open ? "rotate-90" : ""}`}>▶</span>
                    <span className="min-w-0">
                        <h2 id={`${id}-heading`} className="font-display text-xl group-hover:text-signal">{title}</h2>
                        {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
                    </span>
                </button>
                {open && actions}
            </div>
            {open && (
                <div id={`${id}-body`} className="space-y-8 px-5 pb-6 sm:px-6">
                    {children}
                </div>
            )}
        </section>
    );
}

export function SubHeading({ children, note }: { children: React.ReactNode; note?: string }) {
    return (
        <div className="mb-3">
            <h3 className="font-display text-lg">{children}</h3>
            {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
        </div>
    );
}
