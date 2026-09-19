/**
 * Checks the private analytics feature without a browser:
 *
 *   - visitor-hash rotation, bot detection, path parsing, event validation
 *     (unknown names, batch size, search text never kept);
 *   - every /api/analytics/* route calls requireAnalyticsSession (except the
 *     login, leave-beacon and CRON_SECRET-protected rollup routes);
 *   - owner-session rules R1–R5 against the real Upstash Redis, by rewriting
 *     a throwaway session's timestamps (skipped when Redis isn't configured);
 *   - with --db: rollup idempotency and rollup = raw for one past UTC day.
 *     This writes that day's rollup rows (exactly what the nightly job does).
 *
 *   npx tsx scripts/verify-analytics.ts
 *   npx tsx scripts/verify-analytics.ts --db [YYYY-MM-DD]   # default: yesterday
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { config } from "dotenv";

config({ path: ".env.local" });
config();

type Result = { check: string; ok: boolean; detail: string };
const results: Result[] = [];
const record = (check: string, ok: boolean, detail = "") => results.push({ check, ok, detail });

// ---------------------------------------------------------------------------
// Pure checks
// ---------------------------------------------------------------------------
async function pureChecks() {
    const { visitorHash, isBot, pageTypeFromPath, referrerHost } = await import("../lib/analytics/visitor");
    const { analyticsEventSchema, trackBatchSchema } = await import("../lib/analytics/events");

    const a = visitorHash("203.0.113.7", "Mozilla/5.0", "2026-09-18");
    const b = visitorHash("203.0.113.7", "Mozilla/5.0", "2026-09-18");
    const c = visitorHash("203.0.113.7", "Mozilla/5.0", "2026-09-19");
    const d = visitorHash("203.0.113.8", "Mozilla/5.0", "2026-09-18");
    record("hash: stable within a day", a === b);
    record("hash: rotates daily", a !== c);
    record("hash: differs per IP", a !== d);
    record("hash: 32 hex chars, no IP inside", /^[0-9a-f]{32}$/.test(a) && !a.includes("203"));

    const bots = [
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "curl/8.5.0",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36",
        "python-requests/2.31.0",
        "UptimeRobot/2.0",
        "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"
    ];
    const humans = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:130.0) Gecko/20100101 Firefox/130.0"
    ];
    const missedBots = bots.filter((ua) => !isBot(ua));
    const flaggedHumans = humans.filter((ua) => isBot(ua));
    record("bots: all detected", missedBots.length === 0, missedBots.join(" | "));
    record("bots: browsers not flagged", flaggedHumans.length === 0, flaggedHumans.join(" | "));

    const story = pageTypeFromPath("/gazette/2026-09-14/story/some-slug");
    const edition = pageTypeFromPath("/gazette/2026-09-14");
    record(
        "paths: page type, date, slug",
        story.pageType === "story" && story.editionDate === "2026-09-14" && story.storySlug === "some-slug" &&
        edition.pageType === "edition" && pageTypeFromPath("/").pageType === "home" &&
        pageTypeFromPath("/archive").pageType === "archive"
    );
    record(
        "referrer: same-site stripped, external host kept",
        referrerHost("https://www.example.org/x", "example.org") === null &&
        referrerHost("https://news.ycombinator.com/item?id=1", "example.org") === "news.ycombinator.com"
    );

    record("events: unknown name rejected", !analyticsEventSchema.safeParse({ name: "hack", props: {} }).success);
    const search = analyticsEventSchema.safeParse({
        name: "palette_search",
        props: { results: 3, chose: false, query: "secret text" }
    });
    record(
        "events: search text is stripped from props",
        search.success && !("query" in (search.data.props as Record<string, unknown>))
    );
    const pageview = { name: "pageview", props: {} };
    record(
        "batch: 10 events accepted, 11 rejected",
        trackBatchSchema.safeParse({ events: Array(10).fill(pageview), path: "/", sessionId: "s" }).success &&
        !trackBatchSchema.safeParse({ events: Array(11).fill(pageview), path: "/", sessionId: "s" }).success
    );
}

// ---------------------------------------------------------------------------
// Route guard check
// ---------------------------------------------------------------------------
function routeFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) return routeFiles(full);
        return name === "route.ts" ? [full] : [];
    });
}

function routeGuardCheck() {
    const root = join(process.cwd(), "app", "api", "analytics");
    const exempt: Record<string, string> = {
        "login/route.ts": "issues the session",
        "session/leave/route.ts": "sendBeacon, token in body, always 204",
        "rollup/route.ts": "CRON_SECRET"
    };
    const unguarded: string[] = [];
    for (const file of routeFiles(root)) {
        const rel = relative(root, file).split(sep).join("/");
        const source = readFileSync(file, "utf8");
        if (rel in exempt) {
            if (rel === "rollup/route.ts" && !source.includes("hasCronSecret(req)")) unguarded.push(rel);
            continue;
        }
        const handlers = source.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? [];
        const guards = source.match(/await requireAnalyticsSession\(req\)/g) ?? [];
        if (handlers.length === 0 || guards.length < handlers.length) unguarded.push(rel);
    }
    record("routes: every data route calls requireAnalyticsSession", unguarded.length === 0, unguarded.join(", "));
}

// ---------------------------------------------------------------------------
// Session rules R1–R5 (real Redis)
// ---------------------------------------------------------------------------
async function sessionChecks() {
    const { getRedis } = await import("../lib/redis");
    const redis = getRedis();
    if (!redis) {
        record("session rules", true, "skipped: Upstash not configured");
        return;
    }
    const session = await import("../lib/analytics/session");
    const key = (token: string) => `sg:analytics:session:${createHash("sha256").update(token).digest("hex")}`;

    const check = async (token: string) => {
        const result = await session.requireAnalyticsSession(
            new Request("http://localhost/api/analytics/summary", { headers: { authorization: `Bearer ${token}` } })
        );
        if (session.isOkSession(result)) return "ok";
        const body = (await result.json()) as { error?: string };
        return `${result.status} ${body.error ?? ""}`.trim();
    };
    const patch = async (token: string, fields: Record<string, number | null>) => {
        const raw = await redis.get<string | Record<string, unknown>>(key(token));
        const data = typeof raw === "string" ? JSON.parse(raw) : raw;
        await redis.set(key(token), JSON.stringify({ ...data, ...fields }), { ex: 60 });
    };
    const now = Date.now();

    record("R1: unknown token → 401 session_expired", (await check("not-a-real-token")) === "401 session_expired");

    let token = await session.createSession();
    record("session: fresh token accepted", (await check(token)) === "ok");

    await patch(token, { lastActive: now - 21 * 60_000 });
    let outcome = await check(token);
    record("R2: 21 min idle → 401 session_idle", outcome === "401 session_idle", outcome);

    token = await session.createSession();
    await session.markLeave(token);
    outcome = await check(token);
    const leftAfter = await redis.get<string | Record<string, unknown>>(key(token));
    const leftAt = leftAfter ? (typeof leftAfter === "string" ? JSON.parse(leftAfter) : leftAfter).leftAt : "missing";
    record("R5: refresh within 15 s → still signed in, leftAt cleared", outcome === "ok" && leftAt === null, outcome);

    await session.markLeave(token);
    await patch(token, { leftAt: now - 20_000 });
    outcome = await check(token);
    record("R3: closed 20 s ago → 401 session_closed", outcome === "401 session_closed", outcome);

    token = await session.createSession();
    await patch(token, { lastSeen: now - 4 * 60_000 });
    outcome = await check(token);
    record("R4: no check-in for 4 min → 401 session_closed", outcome === "401 session_closed", outcome);

    token = await session.createSession();
    await session.touchSession(createHash("sha256").update(token).digest("hex"), true);
    const touched = (await check(token)) === "ok";
    await session.revokeSession(token);
    outcome = await check(token);
    record("session: heartbeat keeps it, logout revokes it", touched && outcome === "401 session_expired", outcome);
}

// ---------------------------------------------------------------------------
// Rollups (--db)
// ---------------------------------------------------------------------------
async function rollupChecks(day: string) {
    const { sql } = await import("drizzle-orm");
    const { db } = await import("../lib/db");
    const { rollupDay } = await import("../lib/analytics/rollup");
    const daily = await import("../lib/analytics/daily");

    const tables = [
        { name: "daily_page_stats", order: "path", raw: daily.rawPageDaily },
        { name: "daily_event_stats", order: "name, key", raw: daily.rawEventDaily },
        { name: "daily_dim_stats", order: "dim, value", raw: daily.rawDimDaily },
        { name: "daily_session_stats", order: "day", raw: daily.rawSessionDaily }
    ];
    const snapshot = async () => {
        const out: Record<string, string> = {};
        for (const table of tables) {
            const result = await db.execute(
                sql`SELECT * FROM ${sql.raw(table.name)} WHERE day = ${day}::date ORDER BY ${sql.raw(table.order)}`
            );
            out[table.name] = JSON.stringify(result.rows);
        }
        return out;
    };

    await rollupDay(day);
    const first = await snapshot();
    await rollupDay(day);
    const second = await snapshot();
    const changed = tables.filter((t) => first[t.name] !== second[t.name]).map((t) => t.name);
    record(`rollup ${day}: run twice → identical rows`, changed.length === 0, changed.join(", "));

    const mismatched: string[] = [];
    for (const table of tables) {
        const rolled = await db.execute(
            sql`SELECT * FROM ${sql.raw(table.name)} WHERE day = ${day}::date ORDER BY ${sql.raw(table.order)}`
        );
        const raw = await db.execute(sql`SELECT * FROM (${table.raw(day, day)}) r ORDER BY ${sql.raw(table.order)}`);
        if (JSON.stringify(rolled.rows) !== JSON.stringify(raw.rows)) mismatched.push(table.name);
    }
    record(`rollup ${day}: rollup rows = raw-event aggregates`, mismatched.length === 0, mismatched.join(", "));

    const counts = await db.execute(sql`
    SELECT (SELECT COUNT(*) FROM events WHERE ${daily.tsInDays(day, day)} AND name = 'pageview')::int AS raw_views,
           (SELECT COALESCE(SUM(views), 0) FROM daily_page_stats WHERE day = ${day}::date)::int AS page_views,
           (SELECT views FROM daily_session_stats WHERE day = ${day}::date) AS session_views`);
    const c = counts.rows[0] as Record<string, number>;
    record(
        `rollup ${day}: pageviews agree (raw ${c.raw_views})`,
        Number(c.raw_views) === Number(c.page_views) && Number(c.raw_views) === Number(c.session_views),
        JSON.stringify(c)
    );
}

async function main() {
    await pureChecks();
    routeGuardCheck();
    await sessionChecks();

    const dbIndex = process.argv.indexOf("--db");
    if (dbIndex !== -1) {
        const day = process.argv[dbIndex + 1] ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
        await rollupChecks(day);
    }

    for (const r of results) {
        console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check}${r.detail ? `  (${r.detail})` : ""}`);
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
