import { NextResponse } from "next/server";

import { runHealthChecks } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * Health check for uptime monitors (UptimeRobot, Better Stack, cron-job.org…).
 * 200 when the database answers and today's edition is printed (or not yet
 * due); 503 otherwise, so a monitor alerts on an outage *and* on a missed
 * edition. Reveals no configuration or error details.
 */
export async function GET() {
  const { healthy, checkedAt, today, latestEdition, checks } = await runHealthChecks();

  return NextResponse.json(
    { status: healthy ? "ok" : "degraded", checkedAt, today, latestEdition, checks },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
