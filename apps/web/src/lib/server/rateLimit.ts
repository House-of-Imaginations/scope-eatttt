// ponytail: fixed-window (INCR + EXPIRE). Upgrade to sliding-window only if abuse rides the boundary.
import type { RedisRateLimitClient } from "@scope/adapters";

export type { RedisRateLimitClient };

export async function checkRateLimit(
  redis: RedisRateLimitClient,
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ ok: boolean; retryAfter: number }> {
  const count = await redis.incr(`rl:${key}`);
  if (count === 1) await redis.expire(`rl:${key}`, windowSec);
  if (count > limit) {
    const ttl = await redis.ttl(`rl:${key}`);
    return { ok: false, retryAfter: ttl > 0 ? ttl : windowSec };
  }
  return { ok: true, retryAfter: 0 };
}
