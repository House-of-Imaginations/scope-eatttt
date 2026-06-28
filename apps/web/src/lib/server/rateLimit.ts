// ponytail: fixed-window (INCR + EXPIRE). Upgrade to sliding-window only if abuse rides the boundary.

export interface RateLimitRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
}

export async function checkRateLimit(
  redis: RateLimitRedis,
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
