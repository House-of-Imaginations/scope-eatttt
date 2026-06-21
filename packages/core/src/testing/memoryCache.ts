import type { Cache } from "../ports/cache";

export class MemoryCache implements Cache {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    if (!this.values.has(key)) {
      return null;
    }

    return this.values.get(key) as T;
  }

  async set<T>(key: string, value: T, _ttlSeconds: number): Promise<void> {
    this.values.set(key, value);
  }
}
