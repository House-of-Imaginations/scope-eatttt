import { describe, expect, it } from "vitest";
import { createRouterClient } from "@orpc/server";
import type { AppContainer } from "../src/lib/server/container";
import { createORPCRouter, type ORPCContext } from "../src/lib/server/orpc";
import { InMemoryBus, InlineQueue, MemoryCache, type AddMemberRecord, type AuthProvider, type AuthUser, type OutboxWrite, type SessionRepo, type SessionSummary, type StreakStore } from "@scope/core";
import { FakePlaces } from "@scope/core";
import type { Env } from "@scope/config";
import type { Decision, Restaurant } from "@scope/contract";
import type { RelayOutboxRow } from "../src/lib/server/relay";

const sessionId = "00000000-0000-4000-8000-000000000001";
const hostMemberId = "00000000-0000-4000-8000-000000000101";
const guestMemberId = "00000000-0000-4000-8000-000000000102";

describe("oRPC handlers", () => {
  it("creates and joins a lunch session through the in-process client", async () => {
    const repo = new MemorySessionRepo();
    const queue = new InlineQueue();
    const router = createORPCRouter({
      container: testContainer(repo, [], { queue }),
      ids: {
        sessionId: () => sessionId,
        memberId: sequence([hostMemberId, guestMemberId]),
        joinCode: () => "JOIN01",
      },
      now: () => "2026-06-20T01:02:03.000Z",
      streak: new MemoryStreak(),
    });
    const hostClient = createRouterClient(router, { context: context(hostUser) });
    const guestClient = createRouterClient(router, { context: context(guestUser) });

    const created = await hostClient.session.create({ lat: -37.8136, lng: 144.9631, cuisines: ["thai"], radiusM: 500 });
    const joined = await guestClient.session.join({ joinCode: created.joinCode, displayName: "Grace" });

    expect(created).toEqual({ sessionId, joinCode: "JOIN01" });
    expect(joined).toEqual({ sessionId, memberId: guestMemberId });
    expect(repo.members.map((member) => member.userId)).toEqual(["host-user", "guest-user"]);
    expect(queue.enqueued).toEqual([
      {
        name: "places.fetch",
        data: {
          sessionId,
          userId: "host-user",
          lat: -37.8136,
          lng: 144.9631,
          radiusM: 500,
          cuisines: ["thai"],
          limit: 5,
        },
        opts: { jobId: `places-fetch:${sessionId}:host-user:500` },
      },
      {
        name: "places.fetch",
        data: {
          sessionId,
          userId: "guest-user",
          lat: -37.8136,
          lng: 144.9631,
          radiusM: 500,
          cuisines: ["thai"],
          limit: 5,
        },
        opts: { jobId: `places-fetch:${sessionId}:guest-user:500` },
      },
    ]);
  });

  it("rejects swipe decisions from non-members", async () => {
    const repo = new MemorySessionRepo();
    repo.sessions.set(sessionId, sessionSummary());
    const router = createORPCRouter({ container: testContainer(repo), streak: new MemoryStreak() });
    const client = createRouterClient(router, { context: context(guestUser) });

    await expect(client.swipe.decide({ sessionId, restaurantId: "place-1", decision: "accept" })).rejects.toMatchObject({
      code: "NOT_MEMBER",
      status: 403,
    });
  });

  it("enqueues a places.fetch job when a reject reaches the broaden threshold", async () => {
    const repo = new MemorySessionRepo();
    const queue = new InlineQueue();
    repo.sessions.set(sessionId, sessionSummary());
    repo.members.push(memberInput({ userId: "guest-user", radiusM: 500 }));
    repo.restaurants.set("place-1", restaurant);
    const router = createORPCRouter({
      container: testContainer(repo, [], { queue }),
      streak: new MemoryStreak(4),
      now: () => "2026-06-20T01:02:03.000Z",
    });
    const client = createRouterClient(router, { context: context(guestUser) });

    await expect(client.swipe.decide({ sessionId, restaurantId: "place-1", decision: "reject", deckLeft: 3 })).resolves.toEqual({
      promoted: false,
    });

    expect(repo.members[0]?.radiusM).toBe(1000);
    expect(queue.enqueued).toEqual([
      {
        name: "places.fetch",
        data: {
          sessionId,
          userId: "guest-user",
          lat: -37.8136,
          lng: 144.9631,
          radiusM: 1000,
          cuisines: ["thai"],
          limit: 5,
        },
        opts: { jobId: `places-fetch:${sessionId}:guest-user:1000` },
      },
    ]);
  });

  it("queues manual deck broadening instead of fetching Places from the web handler", async () => {
    const repo = new MemorySessionRepo();
    const queue = new InlineQueue();
    repo.sessions.set(sessionId, sessionSummary());
    repo.members.push(memberInput({ userId: "guest-user", radiusM: 500 }));
    const router = createORPCRouter({
      container: testContainer(repo, [], { queue }),
      streak: new MemoryStreak(),
    });
    const client = createRouterClient(router, { context: context(guestUser) });

    await expect(client.swipe.broaden({ sessionId, userId: "guest-user", stepM: 500 })).resolves.toEqual({
      radiusM: 1000,
      restaurants: [],
    });

    expect(queue.enqueued[0]).toMatchObject({
      name: "places.fetch",
      data: { sessionId, userId: "guest-user", lat: -37.8136, lng: 144.9631, radiusM: 1000, cuisines: ["thai"], limit: 5 },
      opts: { jobId: `places-fetch:${sessionId}:guest-user:1000` },
    });
  });

  it("hydrates session state, deck, and poll results for members", async () => {
    const repo = new MemorySessionRepo();
    repo.sessions.set(sessionId, sessionSummary({ hostUserId: "host-user" }));
    repo.members.push(memberInput({ id: hostMemberId, userId: "host-user", displayName: "Ada", isHost: true }));
    repo.restaurants.set("place-1", restaurant);
    repo.candidates.push({ id: "00000000-0000-4000-8000-000000000301", sessionId, restaurantId: "place-1" });
    const router = createORPCRouter({ container: testContainer(repo), streak: new MemoryStreak() });
    const client = createRouterClient(router, { context: context(hostUser) });

    await expect(client.session.state({ sessionId })).resolves.toMatchObject({
      id: sessionId,
      joinCode: "JOIN01",
      hostUserId: "host-user",
      members: [{ userId: "host-user", displayName: "Ada" }],
      candidates: [{ restaurant }],
    });
    await expect(client.swipe.deck({ sessionId, limit: 10 })).resolves.toEqual([restaurant]);
    await expect(client.poll.results({ sessionId })).resolves.toMatchObject([{ restaurant }]);
  });

  it("requires membership before returning state or replay events", async () => {
    const repo = new MemorySessionRepo();
    repo.sessions.set(sessionId, sessionSummary());
    const router = createORPCRouter({
      container: testContainer(repo, [
        {
          id: "00000000-0000-4000-8000-000000000202",
          aggregate: "session",
          aggregateId: sessionId,
          type: "poll.opened",
          payload: { deadlineAt: "2026-06-20T01:07:03.000Z" },
          occurredAt: "2026-06-20T01:02:03.000Z",
          dispatchedAt: null,
        },
      ]),
      streak: new MemoryStreak(),
    });
    const client = createRouterClient(router, { context: context(guestUser) });

    await expect(client.session.state({ sessionId })).rejects.toMatchObject({ code: "NOT_MEMBER", status: 403 });
    await expect(client.session.eventsSince({ sessionId })).rejects.toMatchObject({ code: "NOT_MEMBER", status: 403 });
  });

  it("returns outbox replay events through eventsSince", async () => {
    const repo = new MemorySessionRepo();
    const eventId = "00000000-0000-4000-8000-000000000201";
    repo.sessions.set(sessionId, sessionSummary());
    repo.members.push(memberInput({ userId: "host-user", isHost: true }));
    const router = createORPCRouter({
      container: testContainer(repo, [
        {
          id: eventId,
          aggregate: "session",
          aggregateId: sessionId,
          type: "poll.opened",
          payload: { deadlineAt: "2026-06-20T01:07:03.000Z" },
          occurredAt: "2026-06-20T01:02:03.000Z",
          dispatchedAt: null,
        },
      ]),
      streak: new MemoryStreak(),
    });
    const client = createRouterClient(router, { context: context(hostUser) });

    await expect(client.session.eventsSince({ sessionId })).resolves.toEqual([
      {
        id: eventId,
        sessionId,
        type: "poll.opened",
        occurredAt: "2026-06-20T01:02:03.000Z",
        deadlineAt: "2026-06-20T01:07:03.000Z",
      },
    ]);
  });
});

const hostUser: AuthUser = { id: "host-user", displayName: "Ada", isAnonymous: false };
const guestUser: AuthUser = { id: "guest-user", displayName: "Grace", isAnonymous: true };
const restaurant: Restaurant = { id: "place-1", name: "Noodle House", address: "1 Main St", cuisineTags: ["thai"] };

function context(user: AuthUser): ORPCContext {
  return { user };
}

function testContainer(
  repo: MemorySessionRepo,
  replayRows: RelayOutboxRow[] = [],
  overrides: { queue?: InlineQueue } = {},
): AppContainer {
  return {
    config: testEnv(),
    repo: repo as never,
    bus: new InMemoryBus(),
    queue: overrides.queue ?? new InlineQueue(),
    cache: new MemoryCache(),
    places: new FakePlaces(),
    auth: new TestAuthProvider(hostUser),
    relayStore: {
      listPending: async () => [],
      getPending: async () => null,
      markDispatched: async () => false,
      listSessionEventsAfter: async () => replayRows,
    },
    relayListener: {
      listen: async () => () => {},
    },
  };
}

function sessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: sessionId,
    joinCode: "JOIN01",
    hostUserId: "host-user",
    status: "swiping",
    lat: -37.8136,
    lng: 144.9631,
    radiusM: 500,
    cuisines: ["thai"],
    ...overrides,
  };
}

function memberInput(overrides: Partial<AddMemberRecord> = {}): AddMemberRecord {
  return {
    id: guestMemberId,
    sessionId,
    userId: "guest-user",
    displayName: "Grace",
    isHost: false,
    joinedAt: "2026-06-20T01:02:03.000Z",
    radiusM: 500,
    ...overrides,
  };
}

function testEnv(): Env {
  return {
    DATABASE_URL: "postgres://app:app@localhost:6432/app",
    DATABASE_DIRECT_URL: "postgres://app:app@localhost:5432/app",
    REDIS_URL: "redis://localhost:6379",
    PLACES_PROVIDER: "fake",
    OCR_PROVIDER: "fake",
    BETTER_AUTH_SECRET: "test-secret-at-least-32-characters",
    BETTER_AUTH_URL: "http://localhost:5173",
    PROMOTE_THRESHOLD: 2,
    REJECT_STREAK: 5,
    RADIUS_BASE_M: 500,
    RADIUS_STEP_M: 500,
    RADIUS_CAP_M: 3000,
    POLL_TIMER_MS: 300000,
    PLACES_CACHE_TTL_S: 1800,
  };
}

function sequence(values: string[]): () => string {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value === undefined) {
      throw new Error("No test id left");
    }
    return value;
  };
}

class MemorySessionRepo implements SessionRepo<MemorySessionRepo> {
  readonly sessions = new Map<string, SessionSummary & { hostUserId?: string }>();
  readonly members: AddMemberRecord[] = [];
  readonly outbox: OutboxWrite[] = [];
  readonly restaurants = new Map<string, Restaurant>();
  readonly swipes: Array<{ sessionId: string; userId: string; restaurantId: string; decision: Decision }> = [];
  readonly candidates: Array<{ id: string; sessionId: string; restaurantId: string }> = [];

  async withTx<T>(fn: (tx: MemorySessionRepo) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async createSession(
    _tx: MemorySessionRepo,
    input: { id: string; joinCode: string; hostUserId: string; lat: number; lng: number; radiusM: number; cuisines: string[] },
  ): Promise<void> {
    this.sessions.set(input.id, {
      id: input.id,
      joinCode: input.joinCode,
      status: "lobby",
      lat: input.lat,
      lng: input.lng,
      radiusM: input.radiusM,
      cuisines: input.cuisines,
      hostUserId: input.hostUserId,
    });
  }

  async addMember(_tx: MemorySessionRepo, input: AddMemberRecord): Promise<void> {
    if (!this.members.some((member) => member.sessionId === input.sessionId && member.userId === input.userId)) {
      this.members.push(input);
    }
  }

  async getSession(_tx: MemorySessionRepo, sessionId: string): Promise<SessionSummary | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async getSessionByJoinCode(_tx: MemorySessionRepo, joinCode: string): Promise<SessionSummary | null> {
    return [...this.sessions.values()].find((session) => session.joinCode === joinCode) ?? null;
  }

  async listMembers(_tx: MemorySessionRepo, sessionId: string): Promise<AddMemberRecord[]> {
    return this.members.filter((member) => member.sessionId === sessionId);
  }

  async insertOutbox(_tx: MemorySessionRepo, event: OutboxWrite): Promise<string> {
    this.outbox.push(event);
    return crypto.randomUUID();
  }

  async getRestaurant(_tx: MemorySessionRepo, restaurantId: string): Promise<Restaurant | null> {
    return this.restaurants.get(restaurantId) ?? null;
  }

  async listDeckRestaurants(_tx: MemorySessionRepo, _sessionId: string, userId: string, limit: number): Promise<Restaurant[]> {
    const swiped = new Set(this.swipes.filter((swipe) => swipe.userId === userId).map((swipe) => swipe.restaurantId));
    return [...this.restaurants.values()].filter((candidate) => !swiped.has(candidate.id)).slice(0, limit);
  }

  async recordSwipe(
    _tx: MemorySessionRepo,
    input: { sessionId: string; userId: string; restaurantId: string; decision: Decision },
  ): Promise<{ created: boolean }> {
    if (this.swipes.some((swipe) => swipe.sessionId === input.sessionId && swipe.userId === input.userId && swipe.restaurantId === input.restaurantId)) {
      return { created: false };
    }
    this.swipes.push(input);
    return { created: true };
  }

  async countAccepts(_tx: MemorySessionRepo, sessionId: string, restaurantId: string): Promise<number> {
    return this.swipes.filter((swipe) => swipe.sessionId === sessionId && swipe.restaurantId === restaurantId && swipe.decision === "accept").length;
  }

  async isCandidate(_tx: MemorySessionRepo, sessionId: string, restaurantId: string): Promise<boolean> {
    return this.candidates.some((candidate) => candidate.sessionId === sessionId && candidate.restaurantId === restaurantId);
  }

  async addCandidate(_tx: MemorySessionRepo, input: { sessionId: string; restaurantId: string }): Promise<{ candidateId: string }> {
    const candidateId = "00000000-0000-4000-8000-000000000301";
    this.candidates.push({ id: candidateId, ...input });
    return { candidateId };
  }

  async updateMemberRadius(_tx: MemorySessionRepo, sessionId: string, userId: string, radiusM: number): Promise<void> {
    const member = this.members.find((candidate) => candidate.sessionId === sessionId && candidate.userId === userId);
    if (member) {
      member.radiusM = radiusM;
    }
  }

  async listCandidateResults(): Promise<Array<{ id: string; restaurant: Restaurant; promotedAt: string; upvotes: number; downvotes: number; netScore: number }>> {
    return this.candidates.map((candidate) => ({
      id: candidate.id,
      restaurant: this.restaurants.get(candidate.restaurantId) ?? restaurant,
      promotedAt: "2026-06-20T01:02:03.000Z",
      upvotes: 0,
      downvotes: 0,
      netScore: 0,
    }));
  }
}

class MemoryStreak implements StreakStore {
  constructor(private value = 0) {}

  async incr(): Promise<number> {
    this.value += 1;
    return this.value;
  }

  async reset(): Promise<void> {
    this.value = 0;
  }

  async get(): Promise<number> {
    return this.value;
  }
}

class TestAuthProvider implements AuthProvider {
  constructor(private readonly user: AuthUser) {}

  async getUser(): Promise<AuthUser | null> {
    return this.user;
  }

  async requireUser(): Promise<AuthUser> {
    return this.user;
  }
}
