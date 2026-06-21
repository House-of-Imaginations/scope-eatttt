import { describe, expect, it } from "vitest";
import { InMemoryBus } from "@scope/core";
import { createOutboxNotifyListener, startRelay, type OutboxNotifyListener, type RelayOutboxRow, type RelayStore } from "../src/lib/server/relay";

const sessionId = "00000000-0000-4000-8000-000000000001";
const eventId = "00000000-0000-4000-8000-000000000201";

describe("startRelay", () => {
  it("drains pending rows on startup, publishes session events, and marks them dispatched", async () => {
    const store = new MemoryRelayStore([
      outboxRow({
        type: "poll.opened",
        payload: { deadlineAt: "2026-06-20T01:07:03.000Z" },
      }),
    ]);
    const bus = new InMemoryBus();
    const listener = new ManualListener();

    const stop = await startRelay({ store, bus, listener });

    expect(bus.published).toEqual([
      {
        channel: `session:${sessionId}`,
        event: {
          id: eventId,
          sessionId,
          type: "poll.opened",
          occurredAt: "2026-06-20T01:02:03.000Z",
          deadlineAt: "2026-06-20T01:07:03.000Z",
        },
      },
    ]);
    expect(store.row(eventId)?.dispatchedAt).toBe("2026-06-20T01:02:04.000Z");

    await stop();
    expect(listener.stopped).toBe(true);
  });

  it("dispatches a notified pending row once", async () => {
    const store = new MemoryRelayStore();
    const bus = new InMemoryBus();
    const listener = new ManualListener();
    await startRelay({ store, bus, listener });

    store.rows.push(
      outboxRow({
        type: "member.joined",
        payload: {
          member: {
            id: "00000000-0000-4000-8000-000000000101",
            userId: "user-1",
            displayName: "Ada",
            isHost: true,
            joinedAt: "2026-06-20T01:02:03.000Z",
          },
        },
      }),
    );
    await listener.notify(eventId);
    await listener.notify(eventId);

    expect(bus.published).toHaveLength(1);
    expect(bus.published[0]?.event.type).toBe("member.joined");
  });
});

describe("createOutboxNotifyListener", () => {
  it("uses the direct outbox listener and closes it on stop", async () => {
    const listened: string[] = [];
    let callback: ((eventId: string) => void | Promise<void>) | undefined;
    let closed = false;
    const listener = createOutboxNotifyListener("postgres://direct", async (url, cb) => {
      listened.push(url);
      callback = cb;
      return {
        end: async () => {
          closed = true;
        },
      };
    });
    const received: string[] = [];

    const stop = await listener.listen((eventId) => {
      received.push(eventId);
    });
    await callback?.(eventId);
    await stop();

    expect(listened).toEqual(["postgres://direct"]);
    expect(received).toEqual([eventId]);
    expect(closed).toBe(true);
  });
});

function outboxRow(overrides: Partial<RelayOutboxRow>): RelayOutboxRow {
  return {
    id: eventId,
    aggregate: "session",
    aggregateId: sessionId,
    type: "poll.opened",
    payload: {},
    occurredAt: "2026-06-20T01:02:03.000Z",
    dispatchedAt: null,
    ...overrides,
  };
}

class MemoryRelayStore implements RelayStore {
  constructor(readonly rows: RelayOutboxRow[] = []) {}

  async listPending(): Promise<RelayOutboxRow[]> {
    return this.rows.filter((row) => row.dispatchedAt === null);
  }

  async getPending(id: string): Promise<RelayOutboxRow | null> {
    return this.rows.find((row) => row.id === id && row.dispatchedAt === null) ?? null;
  }

  async markDispatched(id: string): Promise<boolean> {
    const row = this.row(id);
    if (!row || row.dispatchedAt !== null) {
      return false;
    }
    row.dispatchedAt = "2026-06-20T01:02:04.000Z";
    return true;
  }

  row(id: string): RelayOutboxRow | undefined {
    return this.rows.find((row) => row.id === id);
  }
}

class ManualListener implements OutboxNotifyListener {
  private callback: ((eventId: string) => Promise<void>) | undefined;
  stopped = false;

  async listen(onEventId: (eventId: string) => void | Promise<void>): Promise<() => void> {
    this.callback = async (eventId) => {
      await onEventId(eventId);
    };
    return () => {
      this.stopped = true;
    };
  }

  async notify(eventId: string): Promise<void> {
    await this.callback?.(eventId);
  }
}
