import { AppEventSchema, type AppEvent } from "@scope/contract";
import type { EventBus, PublishedAppEvent } from "@scope/core";
import { listenOutbox } from "@scope/db";

export interface RelayOutboxRow {
  id: string;
  aggregate: string;
  aggregateId: string;
  type: AppEvent["type"];
  payload: unknown;
  occurredAt: Date | string;
  dispatchedAt: Date | string | null;
}

export interface RelayStore {
  listPending(): Promise<RelayOutboxRow[]>;
  getPending(id: string): Promise<RelayOutboxRow | null>;
  markDispatched(id: string): Promise<boolean>;
}

export interface OutboxNotifyListener {
  listen(onEventId: (eventId: string) => void | Promise<void>): Promise<() => void | Promise<void>>;
}

export interface OutboxSqlClient {
  end(): Promise<void>;
}

export type ListenOutbox = (url: string, onEventId: (eventId: string) => void | Promise<void>) => Promise<OutboxSqlClient>;

export interface StartRelayOptions {
  store: RelayStore;
  bus: EventBus;
  listener: OutboxNotifyListener;
  pollMs?: number;
}

export async function startRelay({ store, bus, listener, pollMs }: StartRelayOptions): Promise<() => Promise<void>> {
  const dispatch = (eventId: string) => dispatchById(store, bus, eventId);
  const drain = () => drainPending(store, bus);

  const stopListen = await listener.listen(dispatch);
  await drain();

  const pollTimer = pollMs && pollMs > 0 ? setInterval(() => void drain(), pollMs) : undefined;
  pollTimer?.unref?.();

  return async () => {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
    await stopListen();
  };
}

export function createOutboxNotifyListener(url: string, listen: ListenOutbox = listenOutbox): OutboxNotifyListener {
  return {
    async listen(onEventId) {
      const sql = await listen(url, onEventId);
      return () => sql.end();
    },
  };
}

async function drainPending(store: RelayStore, bus: EventBus): Promise<void> {
  for (const row of await store.listPending()) {
    await dispatchRow(store, bus, row);
  }
}

async function dispatchById(store: RelayStore, bus: EventBus, eventId: string): Promise<void> {
  const row = await store.getPending(eventId);
  if (!row) {
    return;
  }
  await dispatchRow(store, bus, row);
}

async function dispatchRow(store: RelayStore, bus: EventBus, row: RelayOutboxRow): Promise<void> {
  const event = outboxRowToEvent(row);
  await bus.publish(`session:${row.aggregateId}`, event);
  await store.markDispatched(row.id);
}

export function outboxRowToEvent(row: RelayOutboxRow): PublishedAppEvent {
  const payload = isRecord(row.payload) ? row.payload : {};
  return AppEventSchema.parse({
    id: row.id,
    sessionId: row.aggregateId,
    type: row.type,
    occurredAt: toIso(row.occurredAt),
    ...payload,
  });
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
