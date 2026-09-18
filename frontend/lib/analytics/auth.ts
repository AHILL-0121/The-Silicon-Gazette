import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { logEvent } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Timing-safe password check (D2)
// ---------------------------------------------------------------------------

/**
 * Compares two strings in constant time via their SHA-256 digests.
 * Always returns false when `ANALYTICS_PASSWORD` is not set.
 */
export function verifyPassword(input: string): boolean {
    const expected = process.env.ANALYTICS_PASSWORD;
    if (!expected) {
        if (process.env.NODE_ENV === "production") {
            logEvent("warn", "analytics.password_unset", {});
        }
        return false;
    }

    try {
        const a = createHash("sha256").update(input).digest();
        const b = createHash("sha256").update(expected).digest();
        // Pads shorter buffer so timingSafeEqual never throws on length mismatch.
        const aPadded = Buffer.alloc(32);
        const bPadded = Buffer.alloc(32);
        a.copy(aPadded);
        b.copy(bPadded);
        return timingSafeEqual(aPadded, bPadded);
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 daily salt for visitor hashes (D8)
// ---------------------------------------------------------------------------
export function dailySalt(dayUtc: string): Buffer {
    const secret = process.env.ANALYTICS_SALT_SECRET ?? "insecure-dev-salt";
    return createHmac("sha256", secret).update(dayUtc).digest();
}
