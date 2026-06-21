import { describe, expect, it } from "vitest";
import type { AppEvent } from "@scope/contract";
import { FakePlaces, InMemoryBus, InlineQueue, MemoryCache } from "../index";

const event: AppEvent & { id: string } = {
  id: "00000000-0000-4000-8000-000000000001",
  type: "prompt.broaden",
  sessionId: "00000000-0000-4000-8000-000000000002",
  occurredAt: "2026-06-20T01:00:00.000Z",
  userId: "user-1",
  nextRadiusM: 1000,
};

describe("FakePlaces", () => {
  it("returns deterministic restaurants sized to the requested limit", async () => {
    const places = new FakePlaces();

    const restaurants = await places.searchNearby({
      lat: -37.8136,
      lng: 144.9631,
      radiusM: 500,
      cuisines: ["thai", "japanese"],
      limit: 3,
    });

    expect(restaurants).toHaveLength(3);
    expect(restaurants).toEqual([
      {
        id: "fake-place-1",
        name: "Fake Thai Restaurant 1",
        address: "1 Fake Street",
        cuisineTags: ["thai", "japanese"],
        rating: 4,
        priceLevel: 1,
        distanceM: 125,
      },
      {
        id: "fake-place-2",
        name: "Fake Japanese Restaurant 2",
        address: "2 Fake Street",
        cuisineTags: ["thai", "japanese"],
        rating: 4.1,
        priceLevel: 2,
        distanceM: 250,
      },
      {
        id: "fake-place-3",
        name: "Fake Thai Restaurant 3",
        address: "3 Fake Street",
        cuisineTags: ["thai", "japanese"],
        rating: 4.2,
        priceLevel: 3,
        distanceM: 375,
      },
    ]);
  });
});

describe("InMemoryBus", () => {
  it("publishes synchronously to subscribers, records events, and supports unsubscribe", async () => {
    const bus = new InMemoryBus();
    const received: string[] = [];

    const unsubscribe = await bus.subscribe("sessions:1", (published) => {
      received.push(published.id);
    });

    await bus.publish("sessions:1", event);
    unsubscribe();
    await bus.publish("sessions:1", { ...event, id: "00000000-0000-4000-8000-000000000003" });

    expect(received).toEqual(["00000000-0000-4000-8000-000000000001"]);
    expect(bus.published).toEqual([
      { channel: "sessions:1", event },
      { channel: "sessions:1", event: { ...event, id: "00000000-0000-4000-8000-000000000003" } },
    ]);
  });
});

describe("InlineQueue", () => {
  it("runs a matching handler immediately when a job is enqueued", async () => {
    const queue = new InlineQueue();
    const handled: unknown[] = [];

    queue.handle("poll.close", async (data) => {
      handled.push(data);
    });

    await queue.enqueue("poll.close", { sessionId: "session-1" }, { delayMs: 300_000, jobId: "job-1" });

    expect(handled).toEqual([{ sessionId: "session-1" }]);
    expect(queue.enqueued).toEqual([
      {
        name: "poll.close",
        data: { sessionId: "session-1" },
        opts: { delayMs: 300_000, jobId: "job-1" },
      },
    ]);
  });
});

describe("MemoryCache", () => {
  it("stores and returns values from memory", async () => {
    const cache = new MemoryCache();

    await cache.set("places:nearby", { ids: ["fake-place-1"] }, 60);

    await expect(cache.get<{ ids: string[] }>("places:nearby")).resolves.toEqual({ ids: ["fake-place-1"] });
    await expect(cache.get("places:missing")).resolves.toBeNull();
  });
});
