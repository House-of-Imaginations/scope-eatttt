// ponytail: fixed-window (INCR + EXPIRE). Upgrade to sliding-window only if abuse rides the boundary.
import type { RedisRateLimitClient } from "@scope/adapters";

export type { RedisRateLimitClient };

export async function checkRateLimit(
  redis: RedisRateLimitClient,
  key: string,
  limit: number,
  windowSec: number,
): Promise<{ ok: boolean; retryAfter: number }> {
  const k = `rl:${key}`;
  const count = await redis.incr(k);
  // ponytail: re-assert TTL whenever the key has none (count===1 OR a prior
  // crash between incr/expire orphaned it) so a key can never get stuck
  // counter-without-expiry and block an IP forever. ttl<0 means no expiry set.
  if (count === 1 || (await redis.ttl(k)) < 0) {
    await redis.expire(k, windowSec);
  }
  if (count > limit) {
    const ttl = await redis.ttl(k);
    return { ok: false, retryAfter: ttl > 0 ? ttl : windowSec };
  }
  return { ok: true, retryAfter: 0 };
}
