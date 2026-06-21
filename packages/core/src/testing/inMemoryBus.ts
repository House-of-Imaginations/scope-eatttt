import type { EventBus, EventSubscriber, PublishedAppEvent } from "../ports/bus";

export interface PublishedEventRecord {
  channel: string;
  event: PublishedAppEvent;
}

export class InMemoryBus implements EventBus {
  readonly published: PublishedEventRecord[] = [];

  private readonly subscribers = new Map<string, Set<EventSubscriber>>();

  async publish(channel: string, ev: PublishedAppEvent): Promise<void> {
    this.published.push({ channel, event: ev });

    for (const subscriber of this.subscribers.get(channel) ?? []) {
      await subscriber(ev);
    }
  }

  async subscribe(channel: string, cb: EventSubscriber): Promise<() => void> {
    const subscribers = this.subscribers.get(channel) ?? new Set<EventSubscriber>();
    subscribers.add(cb);
    this.subscribers.set(channel, subscribers);

    return () => {
      subscribers.delete(cb);
      if (subscribers.size === 0) {
        this.subscribers.delete(channel);
      }
    };
  }
}
