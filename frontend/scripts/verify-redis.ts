/**
 * Checks the Upstash Redis setup end to end: connectivity, the generation
 * rate limiter, the cross-instance generation lock, the daily spending budget
 * and alert de-duplication. Uses only `verify-*` keys (deleted afterwards);
 * the one run added to today's budget counter is subtracted again.
 *
 *   npx tsx scripts/verify-redis.ts
 */
import { createServer } from "node:http";

import { config } from "dotenv";

config({ path: ".env.local" });

type Result = { check: string; ok: boolean; detail: string };
const results: Result[] = [];
const record = (check: string, ok: boolean, detail: string) => results.push({ check, ok, detail });

async function main() {
  const { getRedis } = await import("../lib/redis");
  const redis = getRedis();
  if (!redis) {
    console.log("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set.");
    process.exit(1);
  }
  const stamp = Date.now();
  const cleanup: string[] = [];

  // 1. Connectivity, latency, read/write with expiry.
  let started = Date.now();
  const pong = await redis.ping();
  record("ping", pong === "PONG", `${pong} in ${Date.now() - started} ms`);

  const probeKey = `verify-probe:${stamp}`;
  cleanup.push(probeKey);
  started = Date.now();
  await redis.set(probeKey, "ok", { ex: 60 });
  const value = await redis.get<string>(probeKey);
  const ttl = await redis.ttl(probeKey);
  record("write/read/expiry", value === "ok" && ttl > 0 && ttl <= 60, `value=${value}, ttl=${ttl}s, ${Date.now() - started} ms`);

  // 2. Rate limiter: 3 anonymous generation requests per day per caller.
  const { checkGenerateRateLimit } = await import("../lib/rate-limit");
  const caller = `verify-caller-${stamp}`;
  const attempts = [];
  for (let i = 0; i < 4; i += 1) attempts.push(await checkGenerateRateLimit(caller));
  record(
    "rate limiter (3/day)",
    attempts.slice(0, 3).every((a) => a.success) && !attempts[3].success,
    attempts.map((a, i) => `#${i + 1} ${a.success ? "allowed" : "blocked"} (remaining ${a.remaining})`).join(", ")
  );
  const limiterKeys = await redis.keys(`silicon-gazette-generate:*${caller}*`);
  cleanup.push(...limiterKeys);

  // 3. Generation lock: exclusive, released only by its holder.
  const { acquireGenerationLock } = await import("../lib/generation-lock");
  const lockDate = `verify-${stamp}`;
  cleanup.push(`silicon-gazette-lock:${lockDate}`);
  const first = await acquireGenerationLock(lockDate);
  const second = await acquireGenerationLock(lockDate);
  const lockTtl = await redis.pttl(`silicon-gazette-lock:${lockDate}`);
  if (first.status === "acquired") await first.release();
  const third = await acquireGenerationLock(lockDate);
  if (third.status === "acquired") await third.release();
  record(
    "generation lock",
    first.status === "acquired" && second.status === "busy" && third.status === "acquired",
    `first=${first.status}, concurrent=${second.status}, after release=${third.status}, ttl=${Math.round(lockTtl / 1000)}s`
  );

  // Local webhook receiver so alerts are observed without posting anywhere real.
  const received: string[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push(body);
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  process.env.ALERT_WEBHOOK_URL = `http://127.0.0.1:${port}/hook`;

  // 4. Daily budget: counts in Redis across instances; restored afterwards.
  const { toEditionDate } = await import("../lib/date");
  const { claimGenerationRun, dailyGenerationLimit } = await import("../lib/budget");
  const budgetKey = `silicon-gazette-budget:${toEditionDate()}`;
  const before = Number((await redis.get(budgetKey)) ?? 0);
  const claim = await claimGenerationRun(`verify-${stamp}`);
  const during = Number((await redis.get(budgetKey)) ?? 0);
  const budgetTtl = await redis.ttl(budgetKey);
  if (before === 0) await redis.del(budgetKey);
  else await redis.decr(budgetKey);
  const after = Number((await redis.get(budgetKey)) ?? 0);
  record(
    "daily budget counter",
    during === before + 1 && after === before && claim.used === during,
    `today ${before} -> ${during} (limit ${dailyGenerationLimit()}, allowed=${claim.allowed}, ttl≈${Math.round(budgetTtl / 3600)}h) -> restored to ${after}`
  );

  // 5. Alerts: delivered once, repeats suppressed across instances via Redis.
  const { sendAlert } = await import("../lib/alerts");
  const alertKey = `verify-alert-${stamp}`;
  cleanup.push(`silicon-gazette-alert:${alertKey}`);
  await sendAlert(alertKey, "Redis verification test alert", { note: "local receiver only" });
  await sendAlert(alertKey, "Redis verification test alert (repeat)", {});
  const payload = received[0] ? JSON.parse(received[0]) : null;
  record(
    "alert delivery + de-dup",
    received.length === 1 && typeof payload?.text === "string" && payload.text === payload.content,
    `${received.length} delivered for 2 sends; text starts "${String(payload?.text ?? "").slice(0, 60)}"`
  );
  server.close();

  // 6. Health endpoint's Redis probe uses the same client.
  started = Date.now();
  await redis.ping();
  record("health probe latency", true, `${Date.now() - started} ms`);

  // Clean up every verify-* key.
  const removed = cleanup.length ? await redis.del(...cleanup) : 0;
  const leftovers = (await redis.keys("*verify-*")).length;
  record("cleanup", leftovers === 0, `deleted ${removed} test keys, ${leftovers} verify-* keys left`);

  const width = Math.max(...results.map((r) => r.check.length));
  for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.check.padEnd(width)}  ${r.detail}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((error) => {
  console.error("FAILED", error);
  process.exit(1);
});
