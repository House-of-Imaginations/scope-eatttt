import { describe, expect, it } from "vitest";
import { checkRateLimit } from "../src/lib/server/rateLimit";

// ponytail: hand-rolled in-memory fake — ioredis-mock not in deps, this is enough.
class FakeRedis {
	private counts = new Map<string, number>();
	private ttls = new Map<string, number>();
	expireCalls = 0;

	async incr(key: string): Promise<number> {
		const next = (this.counts.get(key) ?? 0) + 1;
		this.counts.set(key, next);
		return next;
	}

	async expire(key: string, seconds: number): Promise<void> {
		this.expireCalls++;
		this.ttls.set(key, seconds);
	}

	async ttl(key: string): Promise<number> {
		return this.ttls.get(key) ?? -1;
	}

	// test seam: simulate an orphaned key (counter set, no TTL) from a crash
	// between incr and expire.
	seedOrphan(key: string, count: number): void {
		this.counts.set(`rl:${key}`, count);
	}
}

describe("checkRateLimit", () => {
	it("allows requests under the limit", async () => {
		const redis = new FakeRedis();
		const r1 = await checkRateLimit(redis, "ip:1.2.3.4", 2, 60);
		const r2 = await checkRateLimit(redis, "ip:1.2.3.4", 2, 60);
		expect(r1).toEqual({ ok: true, retryAfter: 0 });
		expect(r2).toEqual({ ok: true, retryAfter: 0 });
	});

	it("blocks the request that exceeds the limit", async () => {
		const redis = new FakeRedis();
		await checkRateLimit(redis, "ip:1.2.3.4", 2, 60);
		await checkRateLimit(redis, "ip:1.2.3.4", 2, 60);
		const r3 = await checkRateLimit(redis, "ip:1.2.3.4", 2, 60);
		expect(r3.ok).toBe(false);
		expect(r3.retryAfter).toBeGreaterThan(0);
	});

	it("tracks distinct keys independently", async () => {
		const redis = new FakeRedis();
		await checkRateLimit(redis, "ip:1.1.1.1", 1, 60);
		const blocked = await checkRateLimit(redis, "ip:1.1.1.1", 1, 60);
		const allowed = await checkRateLimit(redis, "ip:2.2.2.2", 1, 60);
		expect(blocked.ok).toBe(false);
		expect(allowed.ok).toBe(true);
	});

	it("self-heals an orphaned key (counter without TTL) instead of blocking forever", async () => {
		const redis = new FakeRedis();
		// crash left a counter past the limit with no expiry set.
		redis.seedOrphan("ip:9.9.9.9", 5);
		const r = await checkRateLimit(redis, "ip:9.9.9.9", 2, 60);
		expect(r.ok).toBe(false);
		// re-asserted EXPIRE, so retryAfter is the window, not a stuck -1.
		expect(r.retryAfter).toBe(60);
		expect(redis.expireCalls).toBe(1);
	});
});
