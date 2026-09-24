import { logEvent } from "./logger";
import { getRedis } from "./redis";

/** The same alert is sent at most once in this window. */
const ALERT_COOLDOWN_SECONDS = 30 * 60;
const recentAlerts = new Map<string, number>();

/**
 * Sends an operational alert to `ALERT_WEBHOOK_URL` (a Slack or Discord
 * incoming webhook; the payload carries both `text` and `content`). Every
 * alert is also logged. Repeats of the same `key` are suppressed for 30
 * minutes, across instances when Redis is available. Never throws.
 */
export async function sendAlert(key: string, message: string, details: Record<string, unknown> = {}): Promise<void> {
  logEvent("error", "alert", { key, message, ...details });

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;

  try {
    const now = Date.now();
    const last = recentAlerts.get(key);
    if (last && now - last < ALERT_COOLDOWN_SECONDS * 1000) return;
    recentAlerts.set(key, now);

    const redis = getRedis();
    if (redis) {
      const first = await redis.set(`silicon-gazette-alert:${key}`, "1", { nx: true, ex: ALERT_COOLDOWN_SECONDS });
      if (first !== "OK") return;
    }

    await postToWebhook(url, key, message, details);
  } catch (error) {
    logEvent("warn", "alert.delivery_failed", { key, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Posts a routine, non-alert message (e.g. a nightly job summary) to
 * `ALERT_WEBHOOK_URL` in the same format as `sendAlert`, without its cooldown.
 * Never throws.
 */
export async function sendNotice(key: string, message: string, details: Record<string, unknown> = {}): Promise<void> {
  logEvent("info", "notice", { key, message, ...details });

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;

  try {
    await postToWebhook(url, key, message, details);
  } catch (error) {
    logEvent("warn", "alert.delivery_failed", { key, error: error instanceof Error ? error.message : String(error) });
  }
}

async function postToWebhook(url: string, key: string, message: string, details: Record<string, unknown>): Promise<void> {
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown";
  const lines = Object.entries(details)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `• ${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  const text = [`🗞️ The Silicon Gazette [${env}] ${message}`, ...lines].join("\n").slice(0, 1900);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) {
    logEvent("warn", "alert.delivery_failed", { key, status: response.status });
  }
}
