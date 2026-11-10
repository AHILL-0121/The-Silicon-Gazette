"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Dates are UTC calendar days as "YYYY-MM-DD", the same unit the API takes.

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
];

const toMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => toDay(toMs(day) + n * DAY_MS);

export function formatDay(day: string): string {
    return new Date(toMs(day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatRange(from: string, to: string): string {
    return from === to ? formatDay(from) : `${formatDay(from)} – ${formatDay(to)}`;
}

function longLabel(day: string): string {
    return new Date(toMs(day)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** 6 weeks (42 days) starting on the Monday on/before the 1st of the month. */
function monthGrid(year: number, month: number): string[] {
    const first = Date.UTC(year, month, 1);
    const weekday = (new Date(first).getUTCDay() + 6) % 7; // Monday = 0
    return Array.from({ length: 42 }, (_, i) => toDay(first + (i - weekday) * DAY_MS));
}

interface DateRangePickerProps {
    from: string;
    to: string;
    /** Earliest selectable day. */
    min: string;
    /** Latest selectable day (today, UTC). */
    max: string;
    onApply: (from: string, to: string) => void;
    onClose: () => void;
}

export function DateRangePicker({ from, to, min, max, onApply, onClose }: DateRangePickerProps) {
    const startDate = new Date(toMs(to));
    const [view, setView] = useState({ year: startDate.getUTCFullYear(), month: startDate.getUTCMonth() });
    const [anchor, setAnchor] = useState<string | null>(null);
    const [hover, setHover] = useState<string | null>(null);
    const [focusDay, setFocusDay] = useState<string | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);

    const grid = monthGrid(view.year, view.month);
    const viewKey = `${view.year}-${String(view.month + 1).padStart(2, "0")}`;
    const defaultFocus = to <= max ? to : max;

    // While picking, the preview runs from the anchor to the hovered day.
    const previewEnd = anchor ? (hover ?? anchor) : null;
    const lo = anchor && previewEnd ? (anchor <= previewEnd ? anchor : previewEnd) : from;
    const hi = anchor && previewEnd ? (anchor <= previewEnd ? previewEnd : anchor) : to;

    const disabled = (day: string) => day < min || day > max;

    const shiftMonth = useCallback((delta: number) => {
        setView((v) => {
            const d = new Date(Date.UTC(v.year, v.month + delta, 1));
            return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
        });
    }, []);

    function pick(day: string) {
        if (disabled(day)) return;
        if (!anchor) {
            setAnchor(day);
            setHover(day);
            return;
        }
        const [a, b] = anchor <= day ? [anchor, day] : [day, anchor];
        onApply(a, b);
    }

    // Close on outside click and Escape.
    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose();
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [onClose]);

    // Focus the selected day on open, and the day an arrow key moved to.
    useEffect(() => {
        rootRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay ?? defaultFocus}"]`)?.focus();
        if (focusDay) setFocusDay(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusDay]);

    function onKeyDown(event: React.KeyboardEvent, day: string) {
        const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[event.key];
        if (step === undefined) return;
        event.preventDefault();
        const next = addDays(day, step);
        if (disabled(next)) return;
        if (next.slice(0, 7) !== viewKey) {
            setView({ year: Number(next.slice(0, 4)), month: Number(next.slice(5, 7)) - 1 });
        }
        if (anchor) setHover(next);
        setFocusDay(next);
    }

    const today = max;
    const quick: Array<{ label: string; from: string; to: string }> = [
        { label: "Today", from: today, to: today },
        { label: "Yesterday", from: addDays(today, -1), to: addDays(today, -1) },
        { label: "This month", from: `${today.slice(0, 7)}-01`, to: today },
        {
            label: "Last month",
            from: toDay(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 2, 1)),
            to: toDay(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 0))
        }
    ];

    return (
        <div
            ref={rootRef}
            role="dialog"
            aria-label="Choose a date or date range"
            className="fixed inset-x-3 top-16 z-[60] mx-auto max-w-sm rounded-2xl border border-rule bg-surface p-4 shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[21rem]"
        >
            <div className="mb-3 flex items-center justify-between">
                <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month"
                    className="rounded-lg px-2.5 py-1 text-ink-soft transition-colors hover:bg-rule/60 hover:text-ink">‹</button>
                <p className="font-display text-base" aria-live="polite">
                    {MONTH_NAMES[view.month]} {view.year}
                </p>
                <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month"
                    disabled={viewKey >= max.slice(0, 7)}
                    className="rounded-lg px-2.5 py-1 text-ink-soft transition-colors hover:bg-rule/60 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent">›</button>
            </div>

            <div className="grid grid-cols-7 gap-y-1 text-center">
                {WEEKDAYS.map((d) => (
                    <span key={d} className="label py-1 text-[10px]">{d}</span>
                ))}
                {grid.map((day) => {
                    const inMonth = day.slice(0, 7) === viewKey;
                    const isOff = disabled(day);
                    const inRange = day >= lo && day <= hi;
                    const isEdge = day === lo || day === hi;
                    return (
                        <button
                            key={day}
                            type="button"
                            data-day={day}
                            disabled={isOff}
                            tabIndex={day === defaultFocus || (focusDay !== null && day === focusDay) ? 0 : -1}
                            aria-label={longLabel(day)}
                            aria-pressed={isEdge}
                            onClick={() => pick(day)}
                            onMouseEnter={() => anchor && setHover(day)}
                            onKeyDown={(event) => onKeyDown(event, day)}
                            className={[
                                "h-9 text-sm tabular-nums transition-colors",
                                inRange ? "bg-signal/10" : "",
                                day === lo ? "rounded-l-lg" : "",
                                day === hi ? "rounded-r-lg" : "",
                                isEdge ? "!bg-ink font-medium text-paper" : inMonth ? "text-ink" : "text-muted/60",
                                !isEdge && !isOff ? "hover:bg-rule/60" : "",
                                isOff ? "cursor-not-allowed opacity-30" : "",
                                day === today && !isEdge ? "font-semibold text-signal" : ""
                            ].join(" ")}
                        >
                            {Number(day.slice(8, 10))}
                        </button>
                    );
                })}
            </div>

            <p className="mt-3 min-h-[1.25rem] text-xs text-ink-soft" aria-live="polite">
                {anchor
                    ? `Start: ${formatDay(anchor)}. Pick the last day, or the same day again for a single date.`
                    : `Showing ${formatRange(from, to)}`}
            </p>

            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-rule pt-3">
                {quick.map((q) => (
                    <button key={q.label} type="button" onClick={() => onApply(q.from, q.to)}
                        className="rounded-full border border-rule px-2.5 py-1 text-xs text-ink-soft transition-colors hover:text-ink">
                        {q.label}
                    </button>
                ))}
            </div>
            <p className="mt-3 text-[11px] text-muted">Days are UTC days, the same as the stored statistics.</p>
        </div>
    );
}
