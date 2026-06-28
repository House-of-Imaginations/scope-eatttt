import Redis from "ioredis";
import type { Cache } from "@scope/core";

export interface RedisLikeCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
}

export interface RedisRateLimitClient {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
}

export class RedisCache implements Cache {
  constructor(private readonly client: RedisLikeCacheClient) {}

  /** Typed access to the ioredis client for rate-limit operations. */
  get rateLimitClient(): RedisRateLimitClient {
    return this.client as unknown as RedisRateLimitClient;
  }

  static fromUrl(url: string): RedisCache {
    return new RedisCache(new Redis(url));
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return value === null ? null : (JSON.parse(value) as T);
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), "EX", ttlSeconds);
  }
}
