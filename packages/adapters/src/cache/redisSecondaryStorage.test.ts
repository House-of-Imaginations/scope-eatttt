import { describe, expect, it } from "vitest";
import { RedisSecondaryStorage } from "./redisSecondaryStorage";

class FakeRedis {
  values = new Map<string, string>();
  expires: Array<{ key: string; seconds: number }> = [];
  deleted: string[] = [];

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, mode?: "EX", ttlSeconds?: number): Promise<void> {
    this.values.set(key, value);
    if (mode === "EX" && ttlSeconds !== undefined) {
      this.expires.push({ key, seconds: ttlSeconds });
    }
  }

  async del(key: string): Promise<void> {
    this.deleted.push(key);
    this.values.delete(key);
  }

  async incr(key: string): Promise<number> {
    const next = Number(this.values.get(key) ?? "0") + 1;
    this.values.set(key, String(next));
    return next;
  }

  async expire(key: string, seconds: number): Promise<void> {
    this.expires.push({ key, seconds });
  }
}

describe("RedisSecondaryStorage", () => {
  it("stores strings with optional ttl and deletes keys", async () => {
    const client = new FakeRedis();
    const storage = new RedisSecondaryStorage(client);

    await storage.set("k", "v", 60);
    await expect(storage.get("k")).resolves.toBe("v");
    await storage.delete("k");

    expect(client.expires).toEqual([{ key: "k", seconds: 60 }]);
    expect(client.deleted).toEqual(["k"]);
  });

  it("starts a fixed-window ttl when a rate-limit counter is created", async () => {
    const client = new FakeRedis();
    const storage = new RedisSecondaryStorage(client);

    await expect(storage.increment("rl", 30)).resolves.toBe(1);
    await expect(storage.increment("rl", 30)).resolves.toBe(2);

    expect(client.expires).toEqual([{ key: "rl", seconds: 30 }]);
  });
});
