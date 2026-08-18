import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

let limiter: Ratelimit | null = null;

function getLimiter(): Ratelimit | null {
  if (limiter) return limiter;

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  });

  limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(3, "1 d"),
    prefix: "silicon-gazette-generate"
  });

  return limiter;
}

export async function checkGenerateRateLimit(identifier: string): Promise<{
  success: boolean;
  remaining: number;
  reset: number;
}> {
  const activeLimiter = getLimiter();
  if (!activeLimiter) {
    return {
      success: true,
      remaining: 3,
      reset: Date.now() + 86400000
    };
  }

  try {
    return await activeLimiter.limit(identifier);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[rate-limit] Upstash check failed, allowing request: ${message}`);
    return {
      success: true,
      remaining: 3,
      reset: Date.now() + 86400000
    };
  }
}