import { neon } from "@neondatabase/serverless";
import { Ratelimit } from "@upstash/ratelimit";

import { getRedis } from "@/lib/redis";
import { logEvent } from "@/lib/logger";

import { pageTypeFromPath } from "./paths";

// ---------------------------------------------------------------------------
// Link previews (edge-safe: runs from the middleware)
//
// Chat apps and social sites fetch a page to build a preview card when its
// link is pasted. Bots don't run the tracker, so the middleware records these
// fetches as `link_preview` events. Counts are approximate: some platforms
// fetch more than once, and Mastodon servers each fetch their own copy.
// ---------------------------------------------------------------------------

/** One preview per platform, page and IP per minute; bursts of refetches count once. */
const DEDUPE_SECONDS = 60;

let limiter: Ratelimit | null = null;

function getLimiter(): Ratelimit | null {
    if (limiter) return limiter;
    const redis = getRedis();
    if (!redis) return null;
    limiter = new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(60, "1 m"),
        prefix: "sg:analytics:preview"
    });
    return limiter;
}

/**
 * Records one preview fetch, deduplicated and rate-limited per IP so a
 * spoofed user agent can't flood the table. Never throws.
 */
export async function recordLinkPreview(platform: string, path: string, ip: string): Promise<void> {
    try {
        if (!process.env.DATABASE_URL) return;

        const redis = getRedis();
        const rate = getLimiter();
        if (redis && rate) {
            const { success } = await rate.limit(ip);
            if (!success) return;
            const fresh = await redis.set(`sg:analytics:preview:seen:${platform}:${path}:${ip}`, 1, {
                nx: true,
                ex: DEDUPE_SECONDS
            });
            if (fresh === null) return;
        }

        const info = pageTypeFromPath(path);
        const sql = neon(process.env.DATABASE_URL);
        await sql`
      INSERT INTO events (name, path, page_type, edition_date, story_slug, visitor_hash, session_id, device, props)
      VALUES ('link_preview', ${path}, ${info.pageType}, ${info.editionDate}, ${info.storySlug},
              'preview', ${`preview:${platform}`}, 'bot', ${JSON.stringify({ platform })}::jsonb)`;
    } catch (error) {
        logEvent("warn", "analytics.preview_failed", { error: error instanceof Error ? error.message : String(error) });
    }
}
