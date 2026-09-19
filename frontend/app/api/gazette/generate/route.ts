import { timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { trackGenerateRequest } from "@/lib/analytics/ingest";
import { compareEditionDate, isValidEditionDate, toEditionDate } from "@/lib/date";
import {
  EDITIONS_TAG,
  GenerationFailedError,
  editionTag,
  getEditionForDate
} from "@/lib/edition-service";
import { logServerError } from "@/lib/logger";
import { checkGenerateRateLimit } from "@/lib/rate-limit";

// The pipeline makes several LLM calls; stored editions took 79-94 s.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function getIpIdentifier(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local"
  );
}

/** True when the request carries `Authorization: Bearer <CRON_SECRET>`. */
function hasCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/** Filled in by runGeneration for the `generate_request` analytics event. */
interface GenerationOutcome {
  cached: boolean;
}

async function runGeneration(date: string, trusted: boolean, outcome: GenerationOutcome) {
  if (!isValidEditionDate(date)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
  }

  const today = toEditionDate();
  // Anonymous callers may only print today's paper. Trusted callers (cron,
  // maintainers) may backfill past dates, but nobody can print the future.
  if (compareEditionDate(date, today) > 0 || (!trusted && date !== today)) {
    return NextResponse.json(
      { error: trusted ? "Future editions cannot be generated." : `Only today's edition (${today}) can be generated.` },
      { status: 403 }
    );
  }

  try {
    const result = await getEditionForDate(date, { allowGenerate: true });
    if (!result.edition) {
      return NextResponse.json({ error: "Edition generation returned no data." }, { status: 503 });
    }

    outcome.cached = result.cached;
    if (!result.cached) {
      // New edition: refresh cached archive listings, adjacent-date links and
      // any cached "no edition" read for a backfilled past date.
      revalidateTag(EDITIONS_TAG);
      revalidateTag(editionTag(date));
    }

    return NextResponse.json({
      edition: result.edition,
      cached: result.cached,
      latency_ms: result.edition.latency_ms
    });
  } catch (error) {
    if (!(error instanceof GenerationFailedError)) {
      logServerError("api:generate-edition", error);
    }
    return NextResponse.json({ error: "Generation failed after retry. Press breakdown." }, { status: 503 });
  }
}

async function rateLimitResponse(req: Request) {
  const rate = await checkGenerateRateLimit(getIpIdentifier(req));
  if (rate.success) return null;
  if (rate.unavailable) {
    return NextResponse.json(
      { error: "Generation is temporarily unavailable. Try again later." },
      { status: 503, headers: { "Retry-After": "60" } }
    );
  }
  return NextResponse.json(
    { error: "Rate limit exceeded. Try again later." },
    {
      status: 429,
      headers: {
        "X-RateLimit-Remaining": String(rate.remaining),
        "X-RateLimit-Reset": String(rate.reset)
      }
    }
  );
}

/** Runs a handler and records its outcome as one `generate_request` event. */
async function tracked(
  req: Request,
  trusted: boolean,
  handle: (outcome: GenerationOutcome) => Promise<NextResponse>
): Promise<NextResponse> {
  const outcome: GenerationOutcome = { cached: false };
  const response = await handle(outcome);
  trackGenerateRequest(req, { trusted, cached: outcome.cached, status: response.status });
  return response;
}

export async function POST(req: Request) {
  const trusted = hasCronSecret(req);
  return tracked(req, trusted, async (outcome) => {
    if (!trusted) {
      const limited = await rateLimitResponse(req);
      if (limited) return limited;
    }

    let payload: { date?: string } = {};
    try {
      payload = (await req.json()) as { date?: string };
    } catch {
      payload = {};
    }

    return runGeneration(payload.date ?? toEditionDate(), trusted, outcome);
  });
}

/** Vercel Cron entry point. Sends `Authorization: Bearer $CRON_SECRET` when that env var is set. */
export async function GET(req: Request) {
  const trusted = hasCronSecret(req);
  return tracked(req, trusted, async (outcome) => {
    if (process.env.CRON_SECRET && !trusted) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!trusted) {
      const limited = await rateLimitResponse(req);
      if (limited) return limited;
    }

    const date = new URL(req.url).searchParams.get("date") ?? toEditionDate();
    return runGeneration(date, trusted, outcome);
  });
}
