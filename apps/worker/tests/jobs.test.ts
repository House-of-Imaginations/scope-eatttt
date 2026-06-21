import { describe, expect, it } from "vitest";
import type { Restaurant } from "@scope/contract";
import type {
  CandidateTally,
  NearbyQuery,
  OutboxWrite,
  PlacesFetchRepo,
  PlacesProvider,
  PollRepo,
  RestaurantCacheRecord,
  SessionSummary,
  Tally,
} from "@scope/core";
import { runPlacesFetchJob } from "../src/jobs/placesFetch";
import { runPollCloseJob } from "../src/jobs/pollClose";

describe("runPollCloseJob", () => {
  it("closes a polling session once and skips repeated runs after it is decided", async () => {
    const repo = new MemoryPollRepo();

    await expect(runPollCloseJob({ repo }, { sessionId: "session-1" })).resolves.toEqual({
      closed: true,
      winnerCandidateId: "candidate-b",
    });
    await expect(runPollCloseJob({ repo }, { sessionId: "session-1" })).resolves.toEqual({
      closed: false,
      reason: "already-decided",
    });

    expect(repo.sessions.get("session-1")?.status).toBe("decided");
    expect(repo.closed).toEqual([{ sessionId: "session-1", winnerCandidateId: "candidate-b" }]);
    expect(repo.outbox).toHaveLength(1);
    expect(repo.outbox[0]).toMatchObject({ type: "poll.closed", payload: { winnerCandidateId: "candidate-b" } });
  });
});

describe("runPlacesFetchJob", () => {
  it("fetches nearby restaurants, caches them, and emits a deck replenished event", async () => {
    const places = new RecordingPlaces();
    const repo = new MemoryPlacesFetchRepo();

    await expect(
      runPlacesFetchJob(
        { places, repo },
        {
          sessionId: "00000000-0000-4000-8000-000000000001",
          userId: "user-1",
          lat: -37.8136,
          lng: 144.9631,
          radiusM: 500,
          cuisines: ["thai"],
          limit: 10,
        },
      ),
    ).resolves.toEqual({ restaurants: places.restaurants });
    expect(places.queries).toEqual([
      {
        lat: -37.8136,
        lng: 144.9631,
        radiusM: 500,
        cuisines: ["thai"],
        limit: 10,
      },
    ]);
    expect(repo.cache).toEqual([
      {
        restaurant: places.restaurants[0],
        cachedAt: expect.any(String),
      },
    ]);
    expect(repo.outbox).toHaveLength(1);
    expect(repo.outbox[0]).toMatchObject({
      aggregate: "session",
      aggregateId: "00000000-0000-4000-8000-000000000001",
      type: "deck.replenished",
      payload: {
        userId: "user-1",
        restaurants: places.restaurants,
      },
    });
  });
});

class MemoryPollRepo implements PollRepo<MemoryPollRepo> {
  readonly sessions = new Map<string, SessionSummary>([
    ["session-1", { id: "session-1", joinCode: "JOIN01", status: "polling" }],
  ]);
  readonly closed: { sessionId: string; winnerCandidateId: string }[] = [];
  readonly outbox: OutboxWrite[] = [];

  async withTx<T>(fn: (tx: MemoryPollRepo) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async getSession(_tx: MemoryPollRepo, sessionId: string): Promise<SessionSummary | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async listCandidatesWithTally(): Promise<CandidateTally[]> {
    return [
      { id: "candidate-a", promotedAt: "2026-06-20T01:03:00.000Z", net: 1 },
      { id: "candidate-b", promotedAt: "2026-06-20T01:04:00.000Z", net: 2 },
    ];
  }

  async closePoll(_tx: MemoryPollRepo, sessionId: string, winnerCandidateId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (session?.status !== "polling") {
      return false;
    }
    if (session) {
      this.sessions.set(sessionId, { ...session, status: "decided" });
    }
    this.closed.push({ sessionId, winnerCandidateId });
    return true;
  }

  async insertOutbox(_tx: MemoryPollRepo, event: OutboxWrite): Promise<string> {
    this.outbox.push(event);
    return `event-${this.outbox.length}`;
  }

  async isHost(): Promise<boolean> {
    throw new Error("not used");
  }

  async startPoll(): Promise<void> {
    throw new Error("not used");
  }

  async upsertVote(): Promise<void> {
    throw new Error("not used");
  }

  async candidateBelongsToSession(): Promise<boolean> {
    throw new Error("not used");
  }

  async tally(): Promise<Tally> {
    throw new Error("not used");
  }
}

class RecordingPlaces implements PlacesProvider {
  readonly queries: NearbyQuery[] = [];
  readonly restaurants: Restaurant[] = [
    {
      id: "place-1",
      name: "Noodle House",
      address: "1 Main St",
      cuisineTags: ["thai"],
    },
  ];

  async searchNearby(query: NearbyQuery): Promise<Restaurant[]> {
    this.queries.push(query);
    return this.restaurants;
  }
}

class MemoryPlacesFetchRepo implements PlacesFetchRepo<MemoryPlacesFetchRepo> {
  readonly cache: RestaurantCacheRecord[] = [];
  readonly outbox: OutboxWrite[] = [];

  async withTx<T>(fn: (tx: MemoryPlacesFetchRepo) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async upsertRestaurants(_tx: MemoryPlacesFetchRepo, records: RestaurantCacheRecord[]): Promise<void> {
    this.cache.push(...records);
  }

  async insertOutbox(_tx: MemoryPlacesFetchRepo, event: OutboxWrite): Promise<string> {
    this.outbox.push(event);
    return `event-${this.outbox.length}`;
  }
}
