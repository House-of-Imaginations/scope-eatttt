import { describe, expect, it, vi } from "vitest";
import { RedisBus } from "./bus/redis";
import { RedisCache } from "./cache/redis";
import { BullQueue } from "./queue/bullmq";

class FakeRedisClient {
  values = new Map<string, string>();
  handlers = new Map<string, (message: string) => void>();
  published: Array<{ channel: string; message: string }> = [];
  messageListener: ((channel: string, message: string) => void) | undefined;

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, mode: "EX", ttlSeconds: number) {
    this.values.set(key, JSON.stringify({ value, mode, ttlSeconds }));
  }

  async publish(channel: string, message: string) {
    this.published.push({ channel, message });
    this.handlers.get(channel)?.(message);
  }

  async subscribe(channel: string) {
    this.handlers.set(channel, (message) => this.messageListener?.(channel, message));
  }

  async unsubscribe(channel: string) {
    this.handlers.delete(channel);
  }

  on(event: "message", cb: (channel: string, message: string) => void) {
    if (event === "message") {
      this.messageListener = cb;
    }
  }
}

describe("RedisCache", () => {
  it("serializes values with setex semantics", async () => {
    const client = new FakeRedisClient();
    const cache = new RedisCache(client);

    await cache.set("k", { ok: true }, 30);
    await client.get("k").then((stored) => client.values.set("k", JSON.parse(stored!).value));

    await expect(cache.get("k")).resolves.toEqual({ ok: true });
  });
});

describe("RedisBus", () => {
  it("publishes JSON events to subscribed callbacks", async () => {
    const pub = new FakeRedisClient();
    const sub = new FakeRedisClient();
    const bus = new RedisBus({ publisher: pub, subscriber: sub });
    const got: unknown[] = [];

    await bus.subscribe("session:s1", (event) => {
      got.push(event);
    });
    await bus.publish("session:s1", { id: "e1", type: "prompt.broaden" } as never);
    sub.handlers.get("session:s1")?.(pub.published[0]!.message);

    expect(got).toEqual([{ id: "e1", type: "prompt.broaden" }]);
  });
});

describe("BullQueue", () => {
  it("maps queue opts to BullMQ add options with deterministic job IDs", async () => {
    const queue = { add: vi.fn().mockResolvedValue(undefined) };
    const jobs = new BullQueue(queue);

    await jobs.enqueue("poll.close", { sessionId: "s1" }, { delayMs: 300000, jobId: "poll-close:s1" });

    expect(queue.add).toHaveBeenCalledWith("poll.close", { sessionId: "s1" }, { delay: 300000, jobId: "poll-close:s1" });
  });
});
