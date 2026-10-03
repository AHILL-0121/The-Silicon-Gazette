import { randomUUID } from "node:crypto";

import type { Redis } from "@upstash/redis";

import { logEvent } from "./logger";
import { getRedis } from "./redis";

/** Longer than the slowest stored run (215 s) and the 300 s function limit. */
const LOCK_TTL_MS = 6 * 60 * 1000;

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0`;

export type LockResult =
  | { status: "acquired"; release: () => Promise<void> }
  | { status: "busy" }
  /** No Redis configured, or Redis errored: callers proceed without a cross-instance lock. */
  | { status: "unavailable" };

type LockClient = Pick<Redis, "set" | "eval">;

function lockKey(date: string): string {
  return `silicon-gazette-lock:${date}`;
}

/** Whether a generation run for `date` holds the lock right now; null without Redis. */
export async function isGenerationLocked(date: string, redis: Pick<Redis, "exists"> | null = getRedis()): Promise<boolean | null> {
  if (!redis) return null;
  return (await redis.exists(lockKey(date))) > 0;
}

/**
 * Cross-instance lock for generating one date. In-process promise sharing only
 * covers a single server instance; serverless platforms run many, so without
 * this two cold instances could both run the paid pipeline for the same day.
 */
export async function acquireGenerationLock(
  date: string,
  redis: LockClient | null = getRedis()
): Promise<LockResult> {
  if (!redis) return { status: "unavailable" };

  const key = lockKey(date);
  const token = randomUUID();
  try {
    const acquired = await redis.set(key, token, { nx: true, px: LOCK_TTL_MS });
    if (acquired !== "OK") return { status: "busy" };
  } catch (error) {
    logEvent("warn", "lock.redis_unavailable", { date, error: String(error) });
    return { status: "unavailable" };
  }

  return {
    status: "acquired",
    release: async () => {
      try {
        await redis.eval(RELEASE_SCRIPT, [key], [token]);
      } catch (error) {
        // The TTL frees the lock anyway.
        logEvent("warn", "lock.release_failed", { key, error: String(error) });
      }
    }
  };
}
