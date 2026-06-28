import type { AppEvent } from "@scope/contract";
import type { EventBus } from "@scope/core";
import Redis from "ioredis";

type Callback = (event: AppEvent & { id: string }) => void | Promise<void>;

export interface RedisLikeBusClient {
  publish(channel: string, message: string): Promise<unknown>;
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(event: "message", cb: (channel: string, message: string) => void): void;
}

export interface RedisBusOptions {
  publisher: RedisLikeBusClient;
  subscriber: RedisLikeBusClient;
}

export class RedisBus implements EventBus {
  private readonly callbacks = new Map<string, Set<Callback>>();

  constructor(private readonly clients: RedisBusOptions) {
    this.clients.subscriber.on("message", (channel, message) => {
      const event = JSON.parse(message) as AppEvent & { id: string };
      for (const cb of this.callbacks.get(channel) ?? []) {
        void cb(event);
      }
    });
  }

  static fromUrl(url: string): RedisBus {
    return new RedisBus({
      publisher: new Redis(url),
      subscriber: new Redis(url),
    });
  }

  async publish(channel: string, ev: AppEvent & { id: string }): Promise<void> {
    await this.clients.publisher.publish(channel, JSON.stringify(ev));
  }

  async subscribe(channel: string, cb: Callback): Promise<() => void> {
    const set = this.callbacks.get(channel) ?? new Set<Callback>();
    const wasEmpty = set.size === 0;
    set.add(cb);
    this.callbacks.set(channel, set);
    if (wasEmpty) {
      await this.clients.subscriber.subscribe(channel);
    }

    return async () => {
      set.delete(cb);
      if (set.size === 0) {
        this.callbacks.delete(channel);
        await this.clients.subscriber.unsubscribe(channel);
      }
    };
  }
}
