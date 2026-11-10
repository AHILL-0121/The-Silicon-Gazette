import { sendAlert, sendNotice } from "@/lib/alerts";
import { logEvent } from "@/lib/logger";
import { absoluteUrl } from "@/lib/site";

import { queryBotFilter } from "./counters";
import { queryAlerts, type AlertItem } from "./insights";
import { querySources, querySummary, queryTop } from "./queries";

// ---------------------------------------------------------------------------
// Scheduled digest and pushed alerts.
//
// A cron (vercel.json) calls /api/analytics/digest once a day. Each run
//   1. pushes the dashboard's warning alerts (late edition, 404 spike, no
//      traffic, traffic anomaly) to the webhook, and
//   2. sends a digest: yesterday vs the day before, or on Mondays the last
//      7 days vs the 7 before.
// Delivery: ANALYTICS_DIGEST_WEBHOOK_URL (falls back to ALERT_WEBHOOK_URL; a
// Slack or Discord incoming webhook) and, optionally, email through Resend
// (RESEND_API_KEY, DIGEST_EMAIL_TO, DIGEST_EMAIL_FROM).
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const dayString = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface DigestChannels {
    webhook: boolean;
    email: boolean;
}

export function digestChannels(): DigestChannels {
    return {
        webhook: Boolean(process.env.ANALYTICS_DIGEST_WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL),
        email: Boolean(process.env.RESEND_API_KEY && process.env.DIGEST_EMAIL_TO && process.env.DIGEST_EMAIL_FROM)
    };
}

export interface Digest {
    title: string;
    period: { from: string; to: string };
    weekly: boolean;
    lines: string[];
    alerts: AlertItem[];
}

function change(current: number, previous: number): string {
    if (previous <= 0) return current > 0 ? "new" : "no change";
    const pct = Math.round(((current - previous) / previous) * 100);
    return pct === 0 ? "flat" : `${pct > 0 ? "+" : ""}${pct}%`;
}

export async function buildDigest(now = new Date()): Promise<Digest> {
    const weekly = now.getUTCDay() === 1; // Monday: summarise the week
    const today = Date.parse(`${dayString(now.getTime())}T00:00:00Z`);
    const span = weekly ? 7 : 1;
    const to = dayString(today - DAY_MS);
    const from = dayString(today - span * DAY_MS);
    const prevTo = dayString(today - (span + 1) * DAY_MS);
    const prevFrom = dayString(today - 2 * span * DAY_MS);

    const [current, previous, editions, sources, alerts, bots] = await Promise.all([
        querySummary(from, to),
        querySummary(prevFrom, prevTo),
        queryTop(from, to, "editions", 1),
        querySources(from, to),
        queryAlerts(),
        queryBotFilter(from, to).catch(() => null)
    ]);

    const label = weekly ? "last 7 days" : "yesterday";
    const lines = [
        `Page views: ${current.views.toLocaleString("en-US")} (${change(current.views, previous.views)} vs the ${weekly ? "7 days before" : "day before"})`,
        `Visitor-days: ${current.visitors.toLocaleString("en-US")} (${change(current.visitors, previous.visitors)})`,
        `Sessions: ${current.sessions.toLocaleString("en-US")} · completion rate ${current.completionRate}% · shares ${current.shares}`
    ];
    const topEdition = editions[0];
    if (topEdition) lines.push(`Top edition: ${topEdition.label} with ${topEdition.views.toLocaleString("en-US")} views`);
    const topSource = sources.platforms[0];
    if (topSource && sources.totalSessions > 0) {
        lines.push(`Top source: ${topSource.platform}, ${Math.round((topSource.sessions * 100) / sources.totalSessions)}% of sessions`);
    }
    if (bots && bots.filteredPct !== null) lines.push(`Bot and privacy filter: ${bots.filteredPct}% of tracking events were refused`);
    if (alerts.length > 0) lines.push(`${alerts.length} alert${alerts.length === 1 ? "" : "s"} open: ${alerts.map((a) => a.message).join(" | ")}`);
    lines.push(`Dashboard: ${absoluteUrl("/analytics")}`);

    return {
        title: `Silicon Gazette analytics, ${label} (${weekly ? `${from} to ${to}` : to})`,
        period: { from, to },
        weekly,
        lines,
        alerts
    };
}

async function sendEmail(digest: Digest): Promise<boolean> {
    const { email } = digestChannels();
    if (!email) return false;
    const html = `<h2>${escapeHtml(digest.title)}</h2><ul>${digest.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`;
    const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            from: process.env.DIGEST_EMAIL_FROM,
            to: (process.env.DIGEST_EMAIL_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean),
            subject: digest.title,
            html,
            text: digest.lines.join("\n")
        }),
        signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Resend returned HTTP ${response.status}`);
    return true;
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface DigestRun {
    digest: Digest;
    sent: { webhook: boolean; email: boolean };
    alertsPushed: number;
    errors: string[];
}

/** Builds the digest and delivers it. Alerts are pushed only on scheduled runs. */
export async function runDigest(options: { pushAlerts: boolean }): Promise<DigestRun> {
    const digest = await buildDigest();
    const errors: string[] = [];
    const sent = { webhook: false, email: false };
    const channels = digestChannels();

    if (channels.webhook) {
        // sendNotice never throws, so a failed post is only visible in the logs.
        await sendNotice(
            `analytics-digest:${digest.period.to}`,
            digest.title,
            Object.fromEntries(digest.lines.map((line, i) => [String(i + 1), line])),
            process.env.ANALYTICS_DIGEST_WEBHOOK_URL
        );
        sent.webhook = true;
    }
    if (channels.email) {
        try {
            sent.email = await sendEmail(digest);
        } catch (error) {
            errors.push(`email: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    let alertsPushed = 0;
    if (options.pushAlerts) {
        for (const alert of digest.alerts.filter((a) => a.severity === "warning")) {
            await sendAlert(`analytics:${alert.id}`, alert.message);
            alertsPushed += 1;
        }
    }

    if (errors.length > 0) logEvent("warn", "analytics.digest_failed", { errors });
    return { digest, sent, alertsPushed, errors };
}
