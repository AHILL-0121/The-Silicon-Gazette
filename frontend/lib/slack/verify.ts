import { createHmac, timingSafeEqual } from "node:crypto";

/** Slack's recommended window; older requests are treated as replays. */
const MAX_AGE_SECONDS = 5 * 60;

/**
 * Checks Slack's request signature (`X-Slack-Signature`, an HMAC-SHA256 of
 * `v0:<timestamp>:<raw body>` keyed with `SLACK_SIGNING_SECRET`). False when
 * the secret isn't set, so the endpoint is closed until it is configured.
 */
export function verifySlackSignature(rawBody: string, headers: Headers, now = Date.now()): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  const timestamp = headers.get("x-slack-request-timestamp");
  const signature = headers.get("x-slack-signature");
  if (!secret || !timestamp || !signature) return false;

  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(now / 1000 - seconds) > MAX_AGE_SECONDS) return false;

  const expected = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`);
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Slack user IDs from `SLACK_ALLOWED_USERS` (comma or space separated). */
export function allowedSlackUsers(): Set<string> {
  return new Set((process.env.SLACK_ALLOWED_USERS ?? "").split(/[\s,]+/).filter(Boolean));
}
