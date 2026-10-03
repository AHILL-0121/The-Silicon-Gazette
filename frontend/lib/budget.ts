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

function budgetKey(day: string): string {
  return `silicon-gazette-budget:${day}`;
}

/**
 * Runs claimed so far today (UTC), read without claiming one. `used` is null
 * when Redis isn't configured: the per-instance fallback count isn't shared.
 */
export async function getGenerationBudgetUsage(): Promise<{ used: number | null; limit: number }> {
  const limit = dailyGenerationLimit();
  const redis = getRedis();
  if (!redis) return { used: null, limit };
  const used = await redis.get<number>(budgetKey(toEditionDate()));
  return { used: Number(used ?? 0), limit };
}

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
  const key = budgetKey(day);

  let used: number;
  let allowed: boolean;
  const redis = getRedis();
  try {
    if (!redis) throw new Error("Redis not configured");
    used = await redis.incr(key);
    if (used === 1) await redis.expire(key, 2 * 24 * 60 * 60);
    allowed = used <= limit;
    // A refused claim runs nothing, so it gives its slot back. Otherwise the
    // count keeps climbing past the limit and raising the limit mid-day
    // (GENERATION_DAILY_LIMIT) would not let another run through.
    if (!allowed) used = await redis.decr(key);
  } catch (error) {
    if (redis) {
      logEvent("warn", "budget.redis_unavailable", { error: error instanceof Error ? error.message : String(error) });
    }
    used = localCounts.get(key) ?? 0;
    allowed = used < limit;
    if (allowed) {
      used += 1;
      localCounts.set(key, used);
    }
  }

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
