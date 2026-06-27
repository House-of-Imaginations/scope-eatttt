import { describe, expect, it } from "vitest";
import { InMemoryBus } from "@scope/core";
import { createSessionEventStream, type SessionEventReplayStore } from "../src/lib/server/sse";
import type { RelayOutboxRow } from "../src/lib/server/relay";

const sessionId = "00000000-0000-4000-8000-000000000001";
const firstEventId = "00000000-0000-4000-8000-000000000201";
const secondEventId = "00000000-0000-4000-8000-000000000202";

describe("createSessionEventStream", () => {
  it("writes live bus events as SSE frames", async () => {
    const bus = new InMemoryBus();
    const stream = await createSessionEventStream({
      bus,
      replayStore: new MemoryReplayStore(),
      sessionId,
      heartbeatMs: 0,
    });
    const reader = stream.getReader();

    await bus.publish(`session:${sessionId}`, {
      id: firstEventId,
      sessionId,
      type: "poll.opened",
      occurredAt: "2026-06-20T01:02:03.000Z",
      deadlineAt: "2026-06-20T01:07:03.000Z",
    });

    expect(await readText(reader)).toBe(
      `id: ${firstEventId}\ndata: {"id":"${firstEventId}","sessionId":"${sessionId}","type":"poll.opened","occurredAt":"2026-06-20T01:02:03.000Z","deadlineAt":"2026-06-20T01:07:03.000Z"}\n\n`,
    );
    await reader.cancel();
  });

  it("replays rows after the last event id before live events", async () => {
    const bus = new InMemoryBus();
    const stream = await createSessionEventStream({
      bus,
      replayStore: new MemoryReplayStore([
        row(firstEventId, { type: "poll.opened", payload: { deadlineAt: "2026-06-20T01:07:03.000Z" } }),
        row(secondEventId, { type: "poll.closed", payload: { winnerCandidateId: "00000000-0000-4000-8000-000000000301" } }),
      ]),
      sessionId,
      afterEventId: firstEventId,
      heartbeatMs: 0,
    });
    const reader = stream.getReader();

    expect(await readText(reader)).toContain(`id: ${secondEventId}`);
    await bus.publish(`session:${sessionId}`, {
      id: "00000000-0000-4000-8000-000000000203",
      sessionId,
      type: "prompt.broaden",
      occurredAt: "2026-06-20T01:09:03.000Z",
      userId: "user-1",
      nextRadiusM: 1000,
    });
    expect(await readText(reader)).toContain("prompt.broaden");
    await reader.cancel();
  });

  it("replays multiple pages before live events", async () => {
    const bus = new InMemoryBus();
    const rows = [
      row(firstEventId, { type: "poll.opened", payload: { deadlineAt: "2026-06-20T01:07:03.000Z" } }),
      row(secondEventId, { type: "prompt.broaden", payload: { userId: "user-1", nextRadiusM: 1000 } }),
      row("00000000-0000-4000-8000-000000000203", { type: "poll.closed", payload: { winnerCandidateId: "00000000-0000-4000-8000-000000000301" } }),
    ];
    const stream = await createSessionEventStream({
      bus,
      replayStore: new MemoryReplayStore(rows, 2),
      sessionId,
      heartbeatMs: 0,
      replayPageSize: 2,
    });
    const reader = stream.getReader();

    expect(await readText(reader)).toContain(`id: ${firstEventId}`);
    expect(await readText(reader)).toContain(`id: ${secondEventId}`);
    expect(await readText(reader)).toContain("poll.closed");
    await bus.publish(`session:${sessionId}`, {
      id: "00000000-0000-4000-8000-000000000204",
      sessionId,
      type: "restaurant.promoted",
      occurredAt: "2026-06-20T01:09:03.000Z",
      candidateId: "00000000-0000-4000-8000-000000000301",
      restaurant: {
        id: "place-1",
        name: "Noodle House",
        address: "1 Main St",
        cuisineTags: ["thai"],
      },
      promotedAt: "2026-06-20T01:09:03.000Z",
    });
    expect(await readText(reader)).toContain("restaurant.promoted");
    await reader.cancel();
  });
});

async function readText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const chunk = await reader.read();
  if (!chunk.value) {
    throw new Error("Expected SSE chunk");
  }
  return new TextDecoder().decode(chunk.value);
}

function row(id: string, overrides: Partial<RelayOutboxRow>): RelayOutboxRow {
  return {
    id,
    aggregate: "session",
    aggregateId: sessionId,
    type: "poll.opened",
    payload: {},
    occurredAt: "2026-06-20T01:02:03.000Z",
    dispatchedAt: null,
    ...overrides,
  };
}

class MemoryReplayStore implements SessionEventReplayStore {
  constructor(
    private readonly rows: RelayOutboxRow[] = [],
    private readonly pageSize = Number.POSITIVE_INFINITY,
  ) {}

  async listSessionEventsAfter(sessionId: string, afterEventId?: string): Promise<RelayOutboxRow[]> {
    const sessionRows = this.rows.filter((row) => row.aggregateId === sessionId);
    if (!afterEventId) {
      return sessionRows.slice(0, this.pageSize);
    }
    const index = sessionRows.findIndex((row) => row.id === afterEventId);
    return (index === -1 ? sessionRows : sessionRows.slice(index + 1)).slice(0, this.pageSize);
  }
}
