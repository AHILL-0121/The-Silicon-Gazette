import { Redis } from "@upstash/redis";

let redisClient: Redis | null = null;

/** Shared Upstash client, or null when Redis isn't configured. */
export function getRedis(): Redis | null {
  if (redisClient) return redisClient;

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }

  redisClient = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
  });
  return redisClient;
}
