import { sendAlert } from "./alerts";
import { toEditionDate } from "./date";
import { logEvent } from "./logger";
import { getRedis } from "./redis";

/**
 * Spending cap: at most this many full pipeline runs (search + LLM calls) per
 * UTC day, across every caller: page views, cron jobs and manual backfills.
 * One run is expected per day; the default leaves room for the backup cron and
 * a few retries after failures.
 */
export function dailyGenerationLimit(): number {
  const value = Number(process.env.GENERATION_DAILY_LIMIT ?? 6);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 6;
}

const localCounts = new Map<string, number>();

export interface BudgetResult {
  allowed: boolean;
  used: number;
  limit: number;
}

/**
 * Records one pipeline run against today's budget and says whether it may go
 * ahead. Uses Redis so the cap holds across serverless instances; without
 * Redis (or if Redis errors) it falls back to a per-instance counter rather
 * than blocking the day's paper.
 */
export async function claimGenerationRun(date: string): Promise<BudgetResult> {
  const limit = dailyGenerationLimit();
  const day = toEditionDate();
  const key = `silicon-gazette-budget:${day}`;

  let used: number;
  const redis = getRedis();
  try {
    if (!redis) throw new Error("Redis not configured");
    used = await redis.incr(key);
    if (used === 1) await redis.expire(key, 2 * 24 * 60 * 60);
  } catch (error) {
    if (redis) {
      logEvent("warn", "budget.redis_unavailable", { error: error instanceof Error ? error.message : String(error) });
    }
    used = (localCounts.get(key) ?? 0) + 1;
    localCounts.set(key, used);
  }

  const allowed = used <= limit;
  logEvent(allowed ? "info" : "error", "budget.claim", { date, day, used, limit, allowed });
  if (!allowed) {
    await sendAlert(`budget-exhausted:${day}`, "Daily generation budget exhausted; generation is paused until tomorrow (UTC).", {
      edition: date,
      runsToday: used,
      limit
    });
  }
  return { allowed, used, limit };
}
