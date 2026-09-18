import { createHash } from "node:crypto";

import { dailySalt } from "./auth";

// ---------------------------------------------------------------------------
// Visitor hash (D8 — IP never stored)
// ---------------------------------------------------------------------------

/**
 * First 16 bytes (32 hex chars) of SHA-256(daily_salt + ip + ua).
 * The IP is used only in memory and is never written anywhere.
 */
export function visitorHash(ip: string, userAgent: string, dayUtc: string): string {
    const salt = dailySalt(dayUtc);
    return createHash("sha256")
        .update(salt)
        .update(ip)
        .update(userAgent)
        .digest("hex")
        .slice(0, 32);
}

// ---------------------------------------------------------------------------
// Bot detection (D8)
// ---------------------------------------------------------------------------
const BOT_PATTERN =
    /bot|crawler|spider|scraper|crawl|headless|phantom|puppeteer|playwright|cypress|nightwatch|selenium|webdriver|curl|wget|python-requests|python-urllib|axios|httpx|java\/|go-http|okhttp|ruby|perl|php|scrapy|node-fetch|undici|linkcheck|linkfinder|uptime|pingdom|statuspage|site24x7|freshping|uptimerobot|datadog|newrelic|gtmetrix|pagespeed|lighthouse|chrome-lighthouse|google-inspectiontool|vercel-screenshot|screaming frog/i;

export function isBot(userAgent: string): boolean {
    return BOT_PATTERN.test(userAgent);
}

// ---------------------------------------------------------------------------
// Device classification (D2)
// ---------------------------------------------------------------------------
export function deviceFromUA(ua: string, viewportW?: number): "mobile" | "tablet" | "desktop" {
    const lower = ua.toLowerCase();
    const isMobileUA = /mobile|android|iphone|ipod|blackberry|windows phone|opera mini/i.test(lower);
    const isTabletUA = /ipad|tablet|(android(?!.*mobile))/i.test(lower);

    if (isTabletUA) return "tablet";
    if (isMobileUA) return "mobile";

    // Viewport-width fallback for ambiguous UAs
    if (viewportW !== undefined) {
        if (viewportW < 768) return "mobile";
        if (viewportW < 1024) return "tablet";
    }
    return "desktop";
}

// ---------------------------------------------------------------------------
// Referrer host (D8 — same-site stripped)
// ---------------------------------------------------------------------------
export function referrerHost(refHeader: string, siteHost: string): string | null {
    if (!refHeader) return null;
    try {
        const url = new URL(refHeader);
        const host = url.hostname.replace(/^www\./, "");
        const site = siteHost.replace(/^www\./, "");
        if (host === site || host === "localhost") return null;
        return host;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// UTM parameters
// ---------------------------------------------------------------------------
export function parseUtm(searchParams: URLSearchParams): {
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
} {
    return {
        utmSource: searchParams.get("utm_source"),
        utmMedium: searchParams.get("utm_medium"),
        utmCampaign: searchParams.get("utm_campaign")
    };
}

// ---------------------------------------------------------------------------
// Page type + edition_date + story_slug from pathname (D10)
// ---------------------------------------------------------------------------
export type PageType = "home" | "edition" | "story" | "archive" | "latest" | "404" | "other";

export interface PathInfo {
    pageType: PageType;
    editionDate: string | null;
    storySlug: string | null;
}

const EDITION_RE = /^\/gazette\/(\d{4}-\d{2}-\d{2})(?:\/?$)/;
const STORY_RE = /^\/gazette\/(\d{4}-\d{2}-\d{2})\/story\/(.+)$/;

export function pageTypeFromPath(path: string): PathInfo {
    if (path === "/" || path === "") return { pageType: "home", editionDate: null, storySlug: null };
    if (path === "/archive") return { pageType: "archive", editionDate: null, storySlug: null };
    if (path === "/latest") return { pageType: "latest", editionDate: null, storySlug: null };

    const storyMatch = STORY_RE.exec(path);
    if (storyMatch) {
        return { pageType: "story", editionDate: storyMatch[1], storySlug: storyMatch[2] };
    }

    const editionMatch = EDITION_RE.exec(path);
    if (editionMatch) {
        return { pageType: "edition", editionDate: editionMatch[1], storySlug: null };
    }

    return { pageType: "other", editionDate: null, storySlug: null };
}

// ---------------------------------------------------------------------------
// UTC date string for bucketing (D10)
// ---------------------------------------------------------------------------
export function utcDayString(date = new Date()): string {
    return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Viewport bucketing (nearest 100 px)
// ---------------------------------------------------------------------------
export function bucketViewport(w: number): number {
    return Math.round(w / 100) * 100;
}
