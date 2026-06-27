import { describe, expect, it, vi } from "vitest";
import type { AppEvent } from "@scope/contract";

const mock = vi.hoisted(() => {
  let handlers: {
    onOpen?: () => void;
    onEvent: (event: AppEvent) => void;
  } | null = null;
  let replayEvents: AppEvent[] = [];

  return {
    get handlers() {
      return handlers;
    },
    setReplayEvents(events: AppEvent[]) {
      replayEvents = events;
    },
    createSse: vi.fn((_sessionId: string, nextHandlers: NonNullable<typeof handlers>) => {
      handlers = nextHandlers;
      return {
        get lastEventId() {
          return null;
        },
        close: vi.fn(),
        emit: vi.fn(),
      };
    }),
    eventsSince: vi.fn(async () => replayEvents),
  };
});

vi.mock("./sse", () => ({
  createSse: mock.createSse,
}));

vi.mock("./orpc", () => ({
  api: {
    session: {
      eventsSince: mock.eventsSince,
    },
  },
}));

const { createSessionStore } = await import("./sessionStore.svelte");

const base = (id: string): Pick<AppEvent, "id" | "sessionId" | "occurredAt"> => ({
  id,
  sessionId: "11111111-1111-1111-1111-111111111111",
  occurredAt: "2026-06-21T00:00:00.000Z",
});

const memberJoined = (id: string, userId: string): AppEvent => ({
  ...base(id),
  type: "member.joined",
  member: {
    id: `member-${userId}`,
    userId,
    displayName: userId,
    isHost: false,
    joinedAt: "2026-06-21T00:00:00.000Z",
  },
});

describe("createSessionStore reconnect replay", () => {
  it("advances lastEventId for fresh replayed events", async () => {
    const store = createSessionStore("s1", "CODE");
    store.connect();

    mock.handlers?.onEvent(memberJoined("00000000-0000-0000-0000-000000000001", "u1"));
    expect(store.lastEventId).toBe("00000000-0000-0000-0000-000000000001");

    mock.setReplayEvents([memberJoined("00000000-0000-0000-0000-000000000002", "u2")]);
    mock.handlers?.onOpen?.();
    await Promise.resolve();

    expect(store.lastEventId).toBe("00000000-0000-0000-0000-000000000002");
  });
});
