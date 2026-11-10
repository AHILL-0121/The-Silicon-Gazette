import { NextResponse } from "next/server";
import { z } from "zod";

import { AiRequestError, AiUnavailableError, aiConfigured, askAnalytics, describeAiFailure, weeklyNarrative } from "@/lib/analytics/ai";
import { isOkSession, requireAnalyticsSession } from "@/lib/analytics/session";
import { logServerError } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** One AI call per signed-in session every few seconds: protects the Gemini quota from double clicks. */
const lastCall = new Map<string, number>();
const COOLDOWN_MS = 4_000;

function tooSoon(key: string): boolean {
    const now = Date.now();
    if (now - (lastCall.get(key) ?? 0) < COOLDOWN_MS) return true;
    lastCall.set(key, now);
    return false;
}

function failure(error: unknown) {
    if (error instanceof AiUnavailableError) {
        return NextResponse.json({ error: "AI features need GEMINI_API_KEY to be set." }, { status: 503 });
    }
    // A question the box cannot answer is the user's to fix, not a server fault.
    if (!(error instanceof AiRequestError)) logServerError("analytics.ai_failed", error);
    return NextResponse.json({ error: describeAiFailure(error) }, { status: error instanceof AiRequestError ? 422 : 502 });
}

/** GET ?mode=status | narrative&from&to */
export async function GET(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;

    const { searchParams } = new URL(req.url);
    if (searchParams.get("mode") === "status") {
        return NextResponse.json({ configured: aiConfigured() });
    }

    const parsed = z.object({ from: day, to: day }).safeParse({ from: searchParams.get("from"), to: searchParams.get("to") });
    if (!parsed.success || parsed.data.from > parsed.data.to) {
        return NextResponse.json({ error: "from and to are required (YYYY-MM-DD)" }, { status: 400 });
    }
    if (tooSoon(`${check.hash}:narrative`)) return NextResponse.json({ error: "Please wait a few seconds." }, { status: 429 });

    try {
        return NextResponse.json(await weeklyNarrative(parsed.data.from, parsed.data.to), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return failure(error);
    }
}

/** POST { question } */
export async function POST(req: Request) {
    const check = await requireAnalyticsSession(req);
    if (!isOkSession(check)) return check;

    const body = z.object({ question: z.string().trim().min(3).max(300) }).safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: "A question of 3 to 300 characters is required." }, { status: 400 });
    if (tooSoon(`${check.hash}:ask`)) return NextResponse.json({ error: "Please wait a few seconds." }, { status: 429 });

    try {
        return NextResponse.json(await askAnalytics(body.data.question), { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
        return failure(error);
    }
}
