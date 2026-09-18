import { Ratelimit } from "@upstash/ratelimit";

import { sendAlert } from "./alerts";
import { logEvent } from "./logger";
import { getRedis } from "./redis";

let limiter: Ratelimit | null = null;

function getLimiter(): Ratelimit | null {
  if (limiter) return limiter;

  const redis = getRedis();
  if (!redis) return null;

  limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, "1 d"),
    prefix: "silicon-gazette-generate"
  });

  return limiter;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
  /** True when the limiter itself was unavailable and the request was refused for safety. */
  unavailable?: boolean;
}

/**
 * Rate limit for anonymous generation requests.
 *
 * Without Upstash configured (local development) every request is allowed.
 * When Upstash is configured but the check errors, production fails closed:
 * an outage of the limiter must not turn the paid pipeline into an open
 * endpoint. Development keeps failing open so a flaky network doesn't block work.
 */
export async function checkGenerateRateLimit(identifier: string): Promise<RateLimitResult> {
  const activeLimiter = getLimiter();
  if (!activeLimiter) {
    return { success: true, remaining: 3, reset: Date.now() + 86400000 };
  }

  try {
    return await activeLimiter.limit(identifier);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failClosed = process.env.NODE_ENV === "production";
    logEvent("warn", "ratelimit.unavailable", { action: failClosed ? "refused" : "allowed", error: message });
    if (failClosed) {
      await sendAlert("ratelimit-unavailable", "Rate limiter (Upstash) is unreachable; anonymous generation requests are being refused.", {
        error: message
      });
    }
    return {
      success: !failClosed,
      remaining: 0,
      reset: Date.now() + 60_000,
      unavailable: failClosed
    };
  }
}
