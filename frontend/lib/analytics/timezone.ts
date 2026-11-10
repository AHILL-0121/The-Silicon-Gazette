// Client-safe display helpers for the IST / UTC toggle on the dashboard.
//
// The toggle changes how times are *shown* (chart axis, tooltips, "last seen").
// Stored data and day boundaries stay UTC: IST is UTC+05:30 all year (India has
// no daylight saving), so a UTC instant converts to IST by adding 330 minutes.

export type Zone = "UTC" | "IST";

export const ZONES: Zone[] = ["UTC", "IST"];

/** How clock times are written: "14:30" or "2:30 PM". */
export type ClockMode = "12h" | "24h";

export const CLOCK_MODES: ClockMode[] = ["12h", "24h"];

const IST_OFFSET_MIN = 330;

export function offsetMinutes(zone: Zone): number {
    return zone === "IST" ? IST_OFFSET_MIN : 0;
}

/** ISO string whose digits are the wall-clock time of a UTC instant in `zone`. */
function wallClock(iso: string, zone: Zone): string {
    return new Date(Date.parse(iso) + offsetMinutes(zone) * 60_000).toISOString();
}

/** "14:30", or "2:30 PM" in 12-hour mode. */
export function clockLabel(iso: string, zone: Zone, mode: ClockMode = "24h"): string {
    const hhmm = wallClock(iso, zone).slice(11, 16);
    if (mode === "24h") return hhmm;
    const hour = Number(hhmm.slice(0, 2));
    return `${hour % 12 === 0 ? 12 : hour % 12}:${hhmm.slice(3)} ${hour < 12 ? "AM" : "PM"}`;
}

/** "2026-11-09" in the zone's calendar. */
export function dateLabel(iso: string, zone: Zone): string {
    return wallClock(iso, zone).slice(0, 10);
}

/** "2026-11-09 14:30 IST" */
export function dateTimeLabel(iso: string, zone: Zone, mode: ClockMode = "24h"): string {
    return `${dateLabel(iso, zone)} ${clockLabel(iso, zone, mode)} ${zone}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "9 Nov, 14:30 IST" */
export function shortDateTime(iso: string, zone: Zone, mode: ClockMode = "24h"): string {
    const p = wallClock(iso, zone);
    return `${Number(p.slice(8, 10))} ${MONTHS[Number(p.slice(5, 7)) - 1]}, ${clockLabel(iso, zone, mode)} ${zone}`;
}

/** "5m ago", "3h ago", "2d ago"; the date for anything older than a week. */
export function relativeTime(iso: string, now = Date.now()): string {
    const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d ago`;
    return iso.slice(0, 10);
}
