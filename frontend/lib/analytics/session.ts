import { createHash, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { getRedis } from "@/lib/redis";
import { logEvent } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SESSION_TTL_S = 20 * 60; // 20 min
const LEAVE_GRACE_S = 15;      // R3: fast close
const SEEN_EXPIRY_S = 3 * 60;  // R4: backup

const KEY_PREFIX = "sg:analytics:session:";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface SessionData {
    createdAt: number;
    lastActive: number;
    lastSeen: number;
    leftAt: number | null;
}

export type SessionCheckResult =
    | { ok: true; hash: string }
    | NextResponse;

export function isOkSession(result: SessionCheckResult): result is { ok: true; hash: string } {
    return "ok" in result && result.ok === true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function tokenHash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

function key(hash: string): string {
    return `${KEY_PREFIX}${hash}`;
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/** Creates a 256-bit token stored by its hash in Redis. Returns the raw token. */
export async function createSession(): Promise<string> {
    const redis = getRedis();
    if (!redis) throw new Error("Redis unavailable");

    const token = randomBytes(32).toString("base64url");
    const hash = tokenHash(token);
    const now = Date.now();
    const data: SessionData = {
        createdAt: now,
        lastActive: now,
        lastSeen: now,
        leftAt: null
    };
    await redis.set(key(hash), JSON.stringify(data), { ex: SESSION_TTL_S });
    logEvent("info", "analytics.session.created", { hash: hash.slice(0, 8) });
    return token;
}

/**
 * Checks a Bearer token from the Authorization header against Redis.
 * Applies rules R1–R5 and returns `{ ok: true, hash }` or a 401 NextResponse.
 */
export async function requireAnalyticsSession(req: Request): Promise<SessionCheckResult> {
    const redis = getRedis();
    if (!redis) {
        return NextResponse.json({ error: "Analytics unavailable" }, { status: 503 });
    }

    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
        return NextResponse.json({ error: "session_expired" }, { status: 401 });
    }

    const hash = tokenHash(token);
    let raw: string | null;
    try {
        raw = await redis.get<string | SessionData>(key(hash)) as string | null;
    } catch {
        return NextResponse.json({ error: "Analytics unavailable" }, { status: 503 });
    }

    // R1: key missing
    if (!raw) {
        return NextResponse.json({ error: "session_expired" }, { status: 401 });
    }

    let data: SessionData;
    try {
        data = (typeof raw === "string" ? JSON.parse(raw) : raw) as SessionData;
    } catch {
        await redis.del(key(hash));
        return NextResponse.json({ error: "session_expired" }, { status: 401 });
    }

    const now = Date.now();
    const nowS = Math.floor(now / 1000);
    const lastActiveS = Math.floor(data.lastActive / 1000);
    const lastSeenS = Math.floor(data.lastSeen / 1000);
    const leftAtS = data.leftAt !== null ? Math.floor(data.leftAt / 1000) : null;

    // R2: idle (no activity for 20 min)
    if (nowS - lastActiveS > SESSION_TTL_S) {
        await redis.del(key(hash));
        return NextResponse.json({ error: "session_idle" }, { status: 401 });
    }

    // R3: closed (fast path, leftAt ≤ 15 s ago — may be a refresh)
    if (leftAtS !== null && nowS - leftAtS <= LEAVE_GRACE_S) {
        // R5: allow the refresh — clear leftAt and extend
        data.leftAt = null;
        data.lastSeen = now;
        data.lastActive = now;
        await redis.set(key(hash), JSON.stringify(data), { ex: SESSION_TTL_S });
        return { ok: true, hash };
    }

    // R3 continued: leftAt set and beyond grace
    if (leftAtS !== null && nowS - leftAtS > LEAVE_GRACE_S) {
        await redis.del(key(hash));
        return NextResponse.json({ error: "session_closed" }, { status: 401 });
    }

    // R4: backup – no heartbeat for 3 min
    if (nowS - lastSeenS > SEEN_EXPIRY_S) {
        await redis.del(key(hash));
        return NextResponse.json({ error: "session_closed" }, { status: 401 });
    }

    return { ok: true, hash };
}

/** Refreshes the TTL and optionally the activity timestamp. */
export async function touchSession(hash: string, active: boolean): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    let raw: string | SessionData | null;
    try {
        raw = await redis.get<string | SessionData>(key(hash));
    } catch {
        return;
    }
    if (!raw) return;

    let data: SessionData;
    try {
        data = (typeof raw === "string" ? JSON.parse(raw) : raw) as SessionData;
    } catch {
        return;
    }

    const now = Date.now();
    data.lastSeen = now;
    if (active) {
        data.lastActive = now;
        data.leftAt = null;
    }
    await redis.set(key(hash), JSON.stringify(data), { ex: SESSION_TTL_S });
}

/** Records the page-close time. The raw token goes in the body for sendBeacon. */
export async function markLeave(token: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    const hash = tokenHash(token);
    let raw: string | SessionData | null;
    try {
        raw = await redis.get<string | SessionData>(key(hash));
    } catch {
        return;
    }
    if (!raw) return;

    let data: SessionData;
    try {
        data = (typeof raw === "string" ? JSON.parse(raw) : raw) as SessionData;
    } catch {
        return;
    }

    // Only set leftAt once; ignore if already set
    if (data.leftAt === null) {
        data.leftAt = Date.now();
        // Keep the key alive for the R3 grace window
        await redis.set(key(hash), JSON.stringify(data), { ex: Math.max(LEAVE_GRACE_S + 5, SESSION_TTL_S) });
    }
}

/** Immediately deletes the session (explicit logout). */
export async function revokeSession(token: string): Promise<void> {
    const redis = getRedis();
    if (!redis) return;

    const hash = tokenHash(token);
    await redis.del(key(hash));
    logEvent("info", "analytics.session.revoked", { hash: hash.slice(0, 8) });
}
