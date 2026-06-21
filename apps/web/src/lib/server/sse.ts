import type { EventBus, PublishedAppEvent } from "@scope/core";
import { outboxRowToEvent, type RelayOutboxRow } from "./relay";

export interface SessionEventReplayStore {
  listSessionEventsAfter(sessionId: string, afterEventId?: string): Promise<RelayOutboxRow[]>;
}

export interface CreateSessionEventStreamOptions {
  bus: EventBus;
  replayStore: SessionEventReplayStore;
  sessionId: string;
  afterEventId?: string | undefined;
  heartbeatMs?: number | undefined;
}

export async function createSessionEventStream({
  bus,
  replayStore,
  sessionId,
  afterEventId,
  heartbeatMs = 25_000,
}: CreateSessionEventStreamOptions): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let unsubscribe: (() => void | Promise<void>) | undefined;
  const heartbeat = heartbeatMs > 0 ? setInterval(() => writeText(": heartbeat\n\n"), heartbeatMs) : undefined;
  heartbeat?.unref?.();

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
    },
    async cancel() {
      await closeStream();
    },
  });

  const writeEvent = (event: PublishedAppEvent) => {
    writeText(formatSse(event));
  };

  function writeText(text: string) {
    if (!closed) {
      controller.enqueue(encoder.encode(text));
    }
  }

  async function closeStream(): Promise<void> {
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    await unsubscribe?.();
  }

  unsubscribe = await bus.subscribe(`session:${sessionId}`, writeEvent);

  for (const row of await replayStore.listSessionEventsAfter(sessionId, afterEventId)) {
    writeEvent(outboxRowToEvent(row));
  }

  return stream;
}

function formatSse(event: PublishedAppEvent): string {
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}
