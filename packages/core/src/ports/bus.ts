import type { AppEvent } from "@scope/contract";

export type PublishedAppEvent = AppEvent & { id: string };
export type EventSubscriber = (ev: PublishedAppEvent) => void | Promise<void>;

export interface EventBus {
  publish(channel: string, ev: PublishedAppEvent): Promise<void>;
  subscribe(channel: string, cb: EventSubscriber): Promise<() => void>;
}
