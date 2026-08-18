const FIRST_ISSUE_DATE = "2026-01-01";

export function toEditionDate(date = new Date()): string {
  // Use explicit UTC date components to avoid timezone offset issues
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isValidEditionDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && toEditionDate(parsed) === value;
}

export function compareEditionDate(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function computeIssueNumber(date: string): number {
  const editionDate = new Date(`${date}T00:00:00Z`);
  const epoch = new Date(`${FIRST_ISSUE_DATE}T00:00:00Z`);
  const days = Math.floor((editionDate.getTime() - epoch.getTime()) / 86400000);
  return Math.max(1, days + 1);
}

export function formatDisplayDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  });
}

export function isPastDate(date: string, reference = toEditionDate()): boolean {
  return compareEditionDate(date, reference) < 0;
}