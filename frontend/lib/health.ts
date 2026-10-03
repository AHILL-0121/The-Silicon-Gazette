import { toEditionDate } from "./date";
import { getEditionByDate, getLatestEditionDate } from "./db";
import { getRedis } from "./redis";

/** Today's edition is expected by 05:00 UTC (crons run at 02:50 and 04:00). */
export const EDITION_DUE_HOUR_UTC = 5;

export type HealthCheck = { ok: boolean; ms?: number; detail?: string };

export interface HealthReport {
  healthy: boolean;
  checkedAt: string;
  today: string;
  latestEdition: string | null;
  checks: { database: HealthCheck; redis: HealthCheck; edition: HealthCheck };
}

async function timed(run: () => Promise<string | undefined>): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const detail = await run();
    return { ok: true, ms: Date.now() - start, ...(detail ? { detail } : {}) };
  } catch (error) {
    return { ok: false, ms: Date.now() - start, detail: error instanceof Error ? error.name : "error" };
  }
}

/**
 * Healthy when the database answers, Redis answers (if configured) and today's
 * edition is printed or not yet due. Details carry no configuration or error
 * messages, only error names.
 */
export async function runHealthChecks(): Promise<HealthReport> {
  const today = toEditionDate();
  const due = new Date().getUTCHours() >= EDITION_DUE_HOUR_UTC;

  let latestDate: string | null = null;
  let todayPrinted = false;

  const [database, redis] = await Promise.all([
    timed(async () => {
      const [latest, todays] = await Promise.all([getLatestEditionDate(), getEditionByDate(today)]);
      latestDate = latest;
      todayPrinted = Boolean(todays);
      return undefined;
    }),
    getRedis()
      ? timed(async () => {
          await getRedis()!.ping();
          return undefined;
        })
      : Promise.resolve<HealthCheck>({ ok: true, detail: "not configured" })
  ]);

  const edition: HealthCheck = {
    ok: todayPrinted || !due,
    detail: todayPrinted ? "printed" : due ? "missing" : "not due yet"
  };

  return {
    healthy: database.ok && redis.ok && edition.ok,
    checkedAt: new Date().toISOString(),
    today,
    latestEdition: latestDate,
    checks: { database, redis, edition }
  };
}
