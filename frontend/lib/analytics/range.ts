// Client-safe date-range helpers (UTC days as "YYYY-MM-DD").

const DAY_MS = 86_400_000;

const ms = (day: string) => Date.parse(`${day}T00:00:00Z`);
const toDay = (value: number) => new Date(value).toISOString().slice(0, 10);

/** Number of days in [from, to], both inclusive. */
export function daysBetween(from: string, to: string): number {
    return Math.round((ms(to) - ms(from)) / DAY_MS) + 1;
}

/** The range of equal length that ends the day before `from`. */
export function previousRange(from: string, to: string): { from: string; to: string } {
    const days = daysBetween(from, to);
    return { from: toDay(ms(from) - days * DAY_MS), to: toDay(ms(from) - DAY_MS) };
}

export function addDays(day: string, n: number): string {
    return toDay(ms(day) + n * DAY_MS);
}

/** Percentage change, or null when both periods are too small for a percentage to mean anything. */
export function pctChange(current: number, previous: number, minSample = 20): number | null {
    if (previous <= 0 || (current < minSample && previous < minSample)) return null;
    return ((current - previous) / previous) * 100;
}
