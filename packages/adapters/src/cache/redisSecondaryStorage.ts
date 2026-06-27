import Redis from "ioredis";

export interface RedisLikeSecondaryStorageClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: "EX", ttlSeconds?: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<unknown>;
}

export class RedisSecondaryStorage {
  constructor(private readonly client: RedisLikeSecondaryStorageClient) {}

  static fromUrl(url: string): RedisSecondaryStorage {
    return new RedisSecondaryStorage(new Redis(url) as unknown as RedisLikeSecondaryStorageClient);
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds === undefined) {
      await this.client.set(key, value);
      return;
    }
    await this.client.set(key, value, "EX", ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async increment(key: string, ttlSeconds: number): Promise<number> {
    const next = await this.client.incr(key);
    if (next === 1) {
      await this.client.expire(key, ttlSeconds);
    }
    return next;
  }
}
