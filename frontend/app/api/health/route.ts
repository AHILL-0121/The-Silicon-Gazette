import { NextResponse } from "next/server";

import { toEditionDate } from "@/lib/date";
import { getEditionByDate, getLatestEditionDate } from "@/lib/db";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

/** Today's edition is expected by 01:00 UTC (crons run at 00:10 and 00:30). */
const EDITION_DUE_HOUR_UTC = 1;

type Check = { ok: boolean; ms?: number; detail?: string };

async function timed(run: () => Promise<string | undefined>): Promise<Check> {
  const start = Date.now();
  try {
    const detail = await run();
    return { ok: true, ms: Date.now() - start, ...(detail ? { detail } : {}) };
  } catch (error) {
    return { ok: false, ms: Date.now() - start, detail: error instanceof Error ? error.name : "error" };
  }
}

/**
 * Health check for uptime monitors (UptimeRobot, Better Stack, cron-job.org…).
 * 200 when the database answers and today's edition is printed (or not yet
 * due); 503 otherwise, so a monitor alerts on an outage *and* on a missed
 * edition. Reveals no configuration or error details.
 */
export async function GET() {
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
      : Promise.resolve<Check>({ ok: true, detail: "not configured" })
  ]);

  const edition: Check = {
    ok: todayPrinted || !due,
    detail: todayPrinted ? "printed" : due ? "missing" : "not due yet"
  };
  const healthy = database.ok && redis.ok && edition.ok;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      checkedAt: new Date().toISOString(),
      today,
      latestEdition: latestDate,
      checks: { database, redis, edition }
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
