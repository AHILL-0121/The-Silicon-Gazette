import { querySummary, queryEvents, queryLive, queryTop, type SummaryResult, type TopKind } from "@/lib/analytics/queries";
import { getGenerationBudgetUsage } from "@/lib/budget";
import { formatDisplayDate, isValidEditionDate, toEditionDate } from "@/lib/date";
import { getEditionByDate, getLatestEditionDate } from "@/lib/db";
import { buildEditionView } from "@/lib/edition-view";
import { isGenerationLocked } from "@/lib/generation-lock";
import { EDITION_DUE_HOUR_UTC, runHealthChecks, type HealthCheck } from "@/lib/health";
import { absoluteUrl } from "@/lib/site";

/** A reply for Slack: `text` is the notification fallback, `blocks` what's shown. */
export interface SlackMessage {
  text: string;
  blocks?: unknown[];
}

export interface ParsedCommand {
  name: string;
  args: string[];
  /** `public` anywhere in the text posts the reply to the channel. */
  inChannel: boolean;
}

export function parseCommandText(text: string): ParsedCommand {
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const inChannel = words.includes("public");
  const [name = "help", ...args] = words.filter((word) => word !== "public");
  return { name, args, inChannel };
}

type Handler = (args: string[]) => Promise<SlackMessage>;

const HANDLERS: Record<string, Handler> = {
  health,
  today,
  edition,
  live,
  stats,
  top,
  "404s": notFound
};

/** Commands that query the database or Redis, and so are answered after the 3 s ack. */
export function isSlowCommand(name: string): boolean {
  return Object.hasOwn(HANDLERS, name);
}

export async function runSlashCommand(command: ParsedCommand): Promise<SlackMessage> {
  if (!isSlowCommand(command.name)) return help(command.name === "help" ? undefined : command.name);
  return HANDLERS[command.name](command.args);
}

export function help(unknown?: string): SlackMessage {
  const lines = [
    "`/gazette health`: database, Redis and today's edition",
    "`/gazette today`: today's edition, generation runs used, and whether a run is in progress",
    "`/gazette edition [YYYY-MM-DD | latest]`: details of one edition",
    "`/gazette live`: readers on the site in the last 30 minutes",
    "`/gazette stats [today | 7d | 30d]`: traffic compared with the previous period",
    "`/gazette top [stories | referrers | countries | devices | editions | paths] [today | 7d | 30d]`",
    "`/gazette 404s [today | 7d | 30d]`: missing pages readers are hitting",
    "",
    "Replies are only visible to you. Add `public` to post one to the channel."
  ];
  return message(unknown ? `Unknown command \`${escape(unknown)}\`. Try one of these:` : "The Silicon Gazette commands", lines);
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function health(): Promise<SlackMessage> {
  const report = await runHealthChecks();
  const line = (label: string, check: HealthCheck) =>
    `${check.ok ? "✅" : "⚠️"} *${label}*: ${check.ok ? "ok" : "failing"}${check.detail ? ` (${check.detail})` : ""}${
      check.ms !== undefined ? ` · ${check.ms} ms` : ""
    }`;

  return message(
    report.healthy ? "✅ All systems healthy" : "⚠️ Site is degraded",
    [
      line("Database", report.checks.database),
      line("Redis", report.checks.redis),
      `${report.checks.edition.ok ? "✅" : "⚠️"} *Today's edition* (${report.today}): ${report.checks.edition.detail}`,
      `Latest edition: ${report.latestEdition ? editionLink(report.latestEdition) : "none"}`
    ],
    `Checked ${timeUtc(report.checkedAt)}`
  );
}

async function today(): Promise<SlackMessage> {
  const date = toEditionDate();
  const [record, budget, running] = await Promise.all([
    getEditionByDate(date),
    getGenerationBudgetUsage(),
    isGenerationLocked(date)
  ]);
  const due = new Date().getUTCHours() >= EDITION_DUE_HOUR_UTC;

  const lines = [
    record
      ? `✅ *Edition*: No. ${record.issue_num} printed at ${timeUtc(record.generated_at)} · ${editionLink(date, "read it")}`
      : due
        ? `⚠️ *Edition*: missing, was due by 0${EDITION_DUE_HOUR_UTC}:00 UTC`
        : `🕓 *Edition*: not printed yet, due by 0${EDITION_DUE_HOUR_UTC}:00 UTC`,
    `*Generation*: ${running === null ? "unknown (Redis not configured)" : running ? "🖨️ a run is in progress" : "idle"}`,
    `*Runs today*: ${budget.used === null ? "unknown (Redis not configured)" : `${budget.used} of ${budget.limit}`}`
  ];

  if (!record) {
    const latest = await getLatestEditionDate();
    lines.push(`Latest edition: ${latest ? editionLink(latest) : "none"}`);
  }

  return message(`Today · ${formatDisplayDate(date)}`, lines);
}

async function edition(args: string[]): Promise<SlackMessage> {
  const arg = args[0];
  let date: string | null;
  let note: string | undefined;

  if (!arg) {
    date = toEditionDate();
    if (!(await getEditionByDate(date))) {
      note = "Today's edition isn't printed yet, so this is the latest one.";
      date = await getLatestEditionDate();
    }
  } else if (arg === "latest") {
    date = await getLatestEditionDate();
  } else if (isValidEditionDate(arg)) {
    date = arg;
  } else {
    return message("Couldn't read that date", ["Use `YYYY-MM-DD` or `latest`, e.g. `/gazette edition 2026-09-29`."]);
  }

  const record = date ? await getEditionByDate(date) : null;
  if (!date || !record) {
    return message("No edition found", [date ? `Nothing was printed for ${date}.` : "No editions have been printed yet."]);
  }

  const view = buildEditionView(record.content, date);
  const lead = record.content.headline;
  const lines = [
    `*<${absoluteUrl(`/gazette/${date}`)}|${escape(lead.title)}>*`,
    `_${escape(lead.deck)}_`,
    "",
    `*Issue*: No. ${record.issue_num} · ${formatDisplayDate(date)}`,
    `*Contents*: ${view.stories.length} stories, ${record.content.repos.length} repositories`,
    `*Printed*: ${timeUtc(record.generated_at)} · ${escape(record.model)}${
      record.latency_ms !== null ? ` · ${(record.latency_ms / 1000).toFixed(1)} s` : ""
    }`
  ];
  return message(`Edition · ${date}`, lines, note);
}

async function live(): Promise<SlackMessage> {
  const result = await queryLive();
  const lines = [`*${count(result.activeSessions, "reader")}* in the last 30 minutes`];
  if (result.topPaths.length > 0) {
    lines.push("", ...result.topPaths.slice(0, 5).map((row) => `• ${pathLink(row.path)}: ${formatNumber(row.sessions)}`));
  }
  return message("Live readers", lines);
}

async function stats(args: string[]): Promise<SlackMessage> {
  const period = parsePeriod(args[0]);
  if (!period) return badPeriod("stats");

  const [current, previous] = await Promise.all([
    querySummary(period.from, period.to),
    querySummary(period.prevFrom, period.prevTo)
  ]);
  const compared = (label: string, key: keyof SummaryResult) =>
    `*${label}*: ${formatNumber(current[key])}${delta(current[key], previous[key])}`;

  return message(
    `Traffic · ${period.label}`,
    [
      compared("Views", "views"),
      compared("Visitors", "visitors"),
      compared("Sessions", "sessions"),
      compared("Shares", "shares"),
      compared("Repo clicks", "repoClicks"),
      `*Average read depth*: ${current.avgReadDepth}%`,
      `*Stories read to the end*: ${current.completionRate}%`
    ],
    `Changes are against ${period.previousLabel}. Visitors are counted once per day.`
  );
}

const TOP_KINDS: TopKind[] = ["stories", "referrers", "countries", "devices", "editions", "paths"];

async function top(args: string[]): Promise<SlackMessage> {
  const kind = (args.find((arg) => TOP_KINDS.includes(arg as TopKind)) ?? "stories") as TopKind;
  const periodArg = args.find((arg) => !TOP_KINDS.includes(arg as TopKind));
  const period = parsePeriod(periodArg);
  if (!period) return badPeriod("top");

  const rows = await queryTop(period.from, period.to, kind, 10);
  if (rows.length === 0) return message(`Top ${kind} · ${period.label}`, ["No views in this period."]);

  const headlines = kind === "stories" ? await storyHeadlines(rows.map((row) => row.extra?.editionDate)) : new Map<string, string>();
  const label = (row: (typeof rows)[number]): string => {
    switch (kind) {
      case "stories": {
        const date = row.extra?.editionDate;
        const headline = headlines.get(`${date}/${row.label}`) ?? row.label;
        return typeof date === "string" ? pathLink(`/gazette/${date}/story/${row.label}`, headline) : escape(headline);
      }
      case "editions":
        return editionLink(row.label);
      case "paths":
        return pathLink(row.label);
      case "referrers":
        return row.label ? escape(row.label) : "(direct)";
      default:
        return row.label ? escape(row.label) : "(unknown)";
    }
  };

  return message(
    `Top ${kind} · ${period.label}`,
    rows.map(
      (row, index) => `${index + 1}. ${label(row)}: ${count(row.views, "view")} · ${count(row.visitors, "visitor")}`
    )
  );
}

/** Headlines keyed by `date/slug`, for the editions the given stories appeared in. */
async function storyHeadlines(dates: unknown[]): Promise<Map<string, string>> {
  const unique = [...new Set(dates.filter((date): date is string => typeof date === "string"))];
  const records = await Promise.all(unique.map((date) => getEditionByDate(date)));
  const headlines = new Map<string, string>();
  for (const record of records) {
    if (!record) continue;
    for (const story of buildEditionView(record.content, record.date).stories) {
      headlines.set(`${record.date}/${story.slug}`, story.headline);
    }
  }
  return headlines;
}

async function notFound(args: string[]): Promise<SlackMessage> {
  const period = parsePeriod(args[0]);
  if (!period) return badPeriod("404s");

  const { operations } = await queryEvents(period.from, period.to);
  if (operations.notFoundViews === 0) return message(`Missing pages · ${period.label}`, ["✅ No 404s in this period."]);

  return message(`Missing pages · ${period.label}`, [
    `*${count(operations.notFoundViews, "view")}* of the 404 page`,
    "",
    ...operations.notFoundPaths.map((row) => `• \`${escape(row.path)}\`: ${formatNumber(row.views)}`)
  ]);
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

interface Period {
  label: string;
  previousLabel: string;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

const PERIOD_DAYS: Record<string, number> = { today: 1, "7d": 7, "30d": 30 };

/** Whole UTC days ending today; defaults to 7 days. Null for an unknown period. */
function parsePeriod(arg = "7d"): Period | null {
  const days = PERIOD_DAYS[arg];
  if (!days) return null;
  const to = toEditionDate();
  const from = shiftDays(to, -(days - 1));
  return {
    label: days === 1 ? "today so far (UTC)" : `last ${days} days`,
    previousLabel: days === 1 ? "all of yesterday" : `the ${days} days before`,
    from,
    to,
    prevFrom: shiftDays(from, -days),
    prevTo: shiftDays(from, -1)
  };
}

function badPeriod(command: string): SlackMessage {
  return message("Unknown period", [`Use \`today\`, \`7d\` or \`30d\`, e.g. \`/gazette ${command} 30d\`.`]);
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toEditionDate(d);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function message(title: string, lines: string[], footer?: string): SlackMessage {
  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `*${title}*\n${lines.join("\n")}`.slice(0, 3000) } }
  ];
  if (footer) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: footer }] });
  return { text: title, blocks };
}

/** Slack mrkdwn treats these three as control characters. */
function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function pathLink(path: string, text = path): string {
  return `<${absoluteUrl(path)}|${escape(text)}>`;
}

function editionLink(date: string, text = date): string {
  return pathLink(`/gazette/${date}`, text);
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function count(value: number, noun: string): string {
  return `${formatNumber(value)} ${noun}${value === 1 ? "" : "s"}`;
}

function timeUtc(iso: string): string {
  const d = new Date(iso);
  return `${toEditionDate(d)} ${d.toISOString().slice(11, 16)} UTC`;
}

function delta(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? "" : " (new)";
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return " (no change)";
  return pct > 0 ? ` (▲ ${pct}%)` : ` (▼ ${Math.abs(pct)}%)`;
}
