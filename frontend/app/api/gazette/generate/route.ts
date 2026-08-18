import { NextResponse } from "next/server";

import { isValidEditionDate, toEditionDate } from "@/lib/date";
import { GenerationFailedError, getEditionForDate } from "@/lib/edition-service";
import { logServerError } from "@/lib/logger";
import { checkGenerateRateLimit } from "@/lib/rate-limit";

function getIpIdentifier(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "local"
  );
}

async function runGeneration(date: string) {
  if (!isValidEditionDate(date)) {
    return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD." }, { status: 400 });
  }

  try {
    const result = await getEditionForDate(date, { allowGenerate: true });
    if (!result.edition) {
      return NextResponse.json({ error: "Edition generation returned no data." }, { status: 503 });
    }

    return NextResponse.json({
      edition: result.edition,
      cached: result.cached,
      latency_ms: result.edition.latency_ms
    });
  } catch (error) {
    if (error instanceof GenerationFailedError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }

    logServerError("api:generate-edition", error);
    return NextResponse.json({ error: "Generation failed after retry. Press breakdown." }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const ip = getIpIdentifier(req);
  const rate = await checkGenerateRateLimit(ip);
  if (!rate.success) {
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

  let payload: { date?: string } = {};
  try {
    payload = (await req.json()) as { date?: string };
  } catch {
    payload = {};
  }

  const date = payload.date ?? toEditionDate();
  return runGeneration(date);
}

export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get("date") ?? toEditionDate();
  return runGeneration(date);
}