import { Ratelimit } from "@upstash/ratelimit";

import { NextResponse } from "next/server";

import { getRedis } from "@/lib/redis";
import { logEvent } from "@/lib/logger";

import { verifyPassword } from "@/lib/analytics/auth";
import { createSession } from "@/lib/analytics/session";

export const dynamic = "force-dynamic";

// Login rate limit: 5 per 15 min per IP, fails closed in production
let loginLimiter: Ratelimit | null = null;

function getLoginLimiter(): Ratelimit | null {
    if (loginLimiter) return loginLimiter;
    const redis = getRedis();
    if (!redis) return null;
    loginLimiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(5, "15 m"),
        prefix: "sg:analytics:login-fail"
    });
    return loginLimiter;
}

function getIp(req: Request): string {
    return (
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        req.headers.get("x-real-ip") ??
        "unknown"
    );
}

export async function POST(req: Request) {
    const redis = getRedis();

    // If Redis is not configured at all, analytics login is unavailable
    if (!redis) {
        return NextResponse.json(
            { error: "Analytics unavailable" },
            { status: 503, headers: { "Cache-Control": "no-store" } }
        );
    }

    let body: { password?: string } = {};
    try {
        body = (await req.json()) as { password?: string };
    } catch {
        return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }

    const ip = getIp(req);

    // Check rate limit before verifying password
    const limiter = getLoginLimiter();
    if (limiter) {
        let limitResult;
        try {
            limitResult = await limiter.limit(ip);
        } catch {
            // Rate limiter down in production → fail closed
            if (process.env.NODE_ENV === "production") {
                return NextResponse.json(
                    { error: "Analytics unavailable. Try again later." },
                    { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } }
                );
            }
        }
        if (limitResult && !limitResult.success) {
            // Add ~300 ms delay to slow down brute force
            await new Promise((resolve) => setTimeout(resolve, 300));
            return NextResponse.json(
                { error: "Too many login attempts. Try again in 15 minutes." },
                {
                    status: 429,
                    headers: {
                        "Retry-After": String(Math.ceil((limitResult.reset - Date.now()) / 1000)),
                        "Cache-Control": "no-store"
                    }
                }
            );
        }
    }

    // Timing-safe password check — ~300 ms delay on failure regardless
    const valid = verifyPassword(body.password ?? "");
    if (!valid) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        logEvent("warn", "analytics.login.failed", { ip });
        return NextResponse.json(
            { error: "Invalid password." },
            { status: 401, headers: { "Cache-Control": "no-store" } }
        );
    }

    // Create session
    let token: string;
    try {
        token = await createSession();
    } catch {
        return NextResponse.json(
            { error: "Analytics unavailable. Redis connection failed." },
            { status: 503, headers: { "Cache-Control": "no-store" } }
        );
    }

    logEvent("info", "analytics.login.success", { ip });
    return NextResponse.json(
        { token, idleMinutes: 20 },
        { status: 200, headers: { "Cache-Control": "no-store" } }
    );
}
