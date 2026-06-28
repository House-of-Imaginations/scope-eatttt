import { createRouterClient } from "@orpc/server";
import type { Env } from "@scope/config";
import type { Decision, Restaurant } from "@scope/contract";
import {
	type AddMemberRecord,
	type AuthProvider,
	type AuthUser,
	InMemoryBus,
	InlineQueue,
	MemoryCache,
	type OutboxWrite,
	type SessionRepo,
	type SessionSummary,
	type StreakStore,
} from "@scope/core";
import { FakePlaces } from "@scope/core";
import { describe, expect, it } from "vitest";
import type { AppContainer } from "../src/lib/server/container";
import { type ORPCContext, createORPCRouter } from "../src/lib/server/orpc";
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
		const hostClient = createRouterClient(router, {
			context: context(hostUser),
		});
		const guestClient = createRouterClient(router, {
			context: context(accountGuestUser),
		});

		const created = await hostClient.session.create({
			lat: -37.8136,
			lng: 144.9631,
			cuisines: ["thai"],
			radiusM: 500,
			title: "Friday lunch",
			pollDurationSec: 180,
			promoteThreshold: 3,
		});
		const joined = await guestClient.session.join({
			joinCode: created.joinCode,
			displayName: "Grace",
		});

		expect(created).toEqual({
			sessionId,
			joinCode: "JOIN01",
			memberId: hostMemberId,
		});
		expect(joined).toEqual({ sessionId, memberId: guestMemberId });
		expect(repo.members.map((member) => member.userId)).toEqual([
			"host-user",
			"guest-user",
		]);
		expect(repo.sessions.get(sessionId)).toMatchObject({
			title: "Friday lunch",
			pollDurationSec: 180,
			promoteThreshold: 3,
		});
		expect(repo.members[0]).toMatchObject({
			image: "https://example.test/ada.png",
		});
		expect(repo.members[1]).toMatchObject({
			image: "https://example.test/grace.png",
		});
		expect(queue.enqueued).toEqual([
			{
				name: "places.fetch",
				data: {
					sessionId,
					userId: hostMemberId,
					lat: -37.8136,
					lng: 144.9631,
					radiusM: 500,
					cuisines: ["thai"],
					limit: 5,
				},
				opts: { jobId: `places-fetch-${sessionId}-${hostMemberId}-500` },
			},
			{
				name: "places.fetch",
				data: {
					sessionId,
					userId: guestMemberId,
					lat: -37.8136,
					lng: 144.9631,
					radiusM: 500,
					cuisines: ["thai"],
					limit: 5,
				},
				opts: { jobId: `places-fetch-${sessionId}-${guestMemberId}-500` },
			},
		]);
	});

	it("uses session-specific promote threshold and poll duration", async () => {
		const repo = new MemorySessionRepo();
		const queue = new InlineQueue();
		const thirdMemberId = "00000000-0000-4000-8000-000000000103";
		repo.sessions.set(
			sessionId,
			sessionSummary({ promoteThreshold: 3, pollDurationSec: 180 }),
		);
		repo.members.push(
			memberInput({ id: hostMemberId, userId: "host-user", isHost: true }),
		);
		repo.members.push(
			memberInput({ id: guestMemberId, userId: "guest-user", isHost: false }),
		);
		repo.members.push(
			memberInput({ id: thirdMemberId, userId: "third-user", isHost: false }),
		);
		repo.restaurants.set("place-1", restaurant);
		const router = createORPCRouter({
			container: testContainer(repo, [], { queue }),
			now: () => "2026-06-20T01:02:03.000Z",
			streak: new MemoryStreak(),
		});

		await expect(
			createRouterClient(router, { context: context(hostUser) }).swipe.decide({
				sessionId,
				restaurantId: "place-1",
				decision: "accept",
			}),
		).resolves.toEqual({ promoted: false });
		await expect(
			createRouterClient(router, { context: context(guestUser) }).swipe.decide({
				sessionId,
				restaurantId: "place-1",
				decision: "accept",
			}),
		).resolves.toEqual({ promoted: false });
		await expect(
			createRouterClient(router, {
				context: context({
					id: "third-user",
					displayName: "Lin",
					isAnonymous: true,
				}),
			}).swipe.decide({
				sessionId,
				restaurantId: "place-1",
				decision: "accept",
			}),
		).resolves.toMatchObject({ promoted: true });

		await expect(
			createRouterClient(router, { context: context(hostUser) }).poll.start({
				sessionId,
			}),
		).resolves.toEqual({
			deadlineAt: "2026-06-20T01:05:03.000Z",
		});
		expect(queue.enqueued.at(-1)).toMatchObject({
			name: "poll.close",
			opts: { delayMs: 180000 },
		});
	});

	it("rejects swipe decisions from non-members", async () => {
		const repo = new MemorySessionRepo();
		repo.sessions.set(sessionId, sessionSummary());
		const router = createORPCRouter({
			container: testContainer(repo),
			streak: new MemoryStreak(),
		});
		const client = createRouterClient(router, { context: context(guestUser) });

		await expect(
			client.swipe.decide({
				sessionId,
				restaurantId: "place-1",
				decision: "accept",
			}),
		).rejects.toMatchObject({
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

		await expect(
			client.swipe.decide({
				sessionId,
				restaurantId: "place-1",
				decision: "reject",
				deckLeft: 3,
			}),
		).resolves.toEqual({
			promoted: false,
		});

		expect(repo.members[0]?.radiusM).toBe(1000);
		expect(queue.enqueued).toEqual([
			{
				name: "places.fetch",
				data: {
					sessionId,
					userId: guestMemberId,
					lat: -37.8136,
					lng: 144.9631,
					radiusM: 1000,
					cuisines: ["thai"],
					limit: 5,
				},
				opts: { jobId: `places-fetch-${sessionId}-${guestMemberId}-1000` },
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

		await expect(
			client.swipe.broaden({ sessionId, userId: "guest-user", stepM: 500 }),
		).resolves.toEqual({
			radiusM: 1000,
			restaurants: [],
		});

		expect(queue.enqueued[0]).toMatchObject({
			name: "places.fetch",
			data: {
				sessionId,
				userId: guestMemberId,
				lat: -37.8136,
				lng: 144.9631,
				radiusM: 1000,
				cuisines: ["thai"],
				limit: 5,
			},
			opts: { jobId: `places-fetch-${sessionId}-${guestMemberId}-1000` },
		});
	});

	it("treats same-auth joins as separate members for swiping", async () => {
		const repo = new MemorySessionRepo();
		repo.restaurants.set("place-1", restaurant);
		const aliceMemberId = "00000000-0000-4000-8000-000000000103";
		const router = createORPCRouter({
			container: testContainer(repo),
			ids: {
				sessionId: () => sessionId,
				memberId: sequence([hostMemberId, guestMemberId, aliceMemberId]),
				joinCode: () => "JOIN01",
			},
			now: () => "2026-06-20T01:02:03.000Z",
			streak: new MemoryStreak(),
		});
		const client = createRouterClient(router, { context: context(hostUser) });

		const created = await client.session.create({
			lat: -37.8136,
			lng: 144.9631,
			cuisines: ["thai"],
			radiusM: 500,
		});
		const simon = await client.session.join({
			joinCode: created.joinCode,
			displayName: "Simon",
		});
		const alice = await client.session.join({
			joinCode: created.joinCode,
			displayName: "Alice",
		});

		await expect(
			client.session.state({ sessionId, memberId: alice.memberId }),
		).resolves.toMatchObject({
			viewerIsHost: false,
			members: [
				{ displayName: "Ada" },
				{ displayName: "Simon" },
				{ displayName: "Alice" },
			],
		});

		await expect(
			client.swipe.decide({
				sessionId,
				memberId: simon.memberId,
				restaurantId: "place-1",
				decision: "accept",
			}),
		).resolves.toEqual({
			promoted: false,
		});
		await expect(
			client.swipe.decide({
				sessionId,
				memberId: alice.memberId,
				restaurantId: "place-1",
				decision: "accept",
			}),
		).resolves.toMatchObject({
			promoted: true,
			candidate: { restaurant },
		});
	});

	it("hydrates session state, deck, and poll results for members", async () => {
		const repo = new MemorySessionRepo();
		repo.sessions.set(sessionId, sessionSummary({ hostUserId: "host-user" }));
		repo.members.push(
			memberInput({
				id: hostMemberId,
				userId: "host-user",
				displayName: "Ada",
				isHost: true,
			}),
		);
		repo.restaurants.set("place-1", restaurant);
		repo.candidates.push({
			id: "00000000-0000-4000-8000-000000000301",
			sessionId,
			restaurantId: "place-1",
		});
		const router = createORPCRouter({
			container: testContainer(repo),
			streak: new MemoryStreak(),
		});
		const client = createRouterClient(router, { context: context(hostUser) });

		await expect(client.session.state({ sessionId })).resolves.toMatchObject({
			id: sessionId,
			joinCode: "JOIN01",
			hostUserId: "host-user",
			viewerIsHost: true,
			members: [{ userId: "host-user", displayName: "Ada" }],
			candidates: [{ restaurant }],
		});
		await expect(client.swipe.deck({ sessionId, limit: 10 })).resolves.toEqual([
			restaurant,
		]);
		await expect(client.poll.results({ sessionId })).resolves.toMatchObject([
			{ restaurant },
		]);
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

		await expect(client.session.state({ sessionId })).rejects.toMatchObject({
			code: "NOT_MEMBER",
			status: 403,
		});
		await expect(
			client.session.eventsSince({ sessionId }),
		).rejects.toMatchObject({ code: "NOT_MEMBER", status: 403 });
	});

	it("starts swiping for the host and exposes viewer host identity", async () => {
		const repo = new MemorySessionRepo();
		repo.sessions.set(
			sessionId,
			sessionSummary({ status: "lobby", hostUserId: "host-user" }),
		);
		repo.members.push(
			memberInput({
				id: hostMemberId,
				userId: "host-user",
				displayName: "Ada",
				isHost: true,
			}),
		);
		repo.members.push(
			memberInput({
				id: guestMemberId,
				userId: "guest-user",
				displayName: "Grace",
				isHost: false,
			}),
		);
		const router = createORPCRouter({
			container: testContainer(repo),
			streak: new MemoryStreak(),
		});
		const hostClient = createRouterClient(router, {
			context: context(hostUser),
		});
		const guestClient = createRouterClient(router, {
			context: context(guestUser),
		});

		await expect(
			hostClient.session.startSwiping({ sessionId }),
		).resolves.toEqual({ status: "swiping" });
		await expect(
			guestClient.session.startSwiping({ sessionId }),
		).rejects.toMatchObject({ code: "NOT_HOST", status: 403 });
		await expect(
			guestClient.session.state({ sessionId }),
		).resolves.toMatchObject({
			status: "swiping",
			viewerIsHost: false,
		});
		expect(repo.outbox).toEqual([
			expect.objectContaining({
				aggregate: "session",
				aggregateId: sessionId,
				type: "session.started",
				payload: {},
			}),
		]);
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

	it("returns dashboard history and session summary for members", async () => {
		const repo = new MemorySessionRepo();
		repo.sessions.set(
			sessionId,
			sessionSummary({
				title: "Friday lunch",
				status: "decided",
				winnerCandidateId: "00000000-0000-4000-8000-000000000301",
			}),
		);
		repo.members.push(
			memberInput({
				id: hostMemberId,
				userId: "host-user",
				displayName: "Ada",
				image: "https://example.test/ada.png",
				isHost: true,
			}),
		);
		repo.restaurants.set("place-1", restaurant);
		repo.candidates.push({
			id: "00000000-0000-4000-8000-000000000301",
			sessionId,
			restaurantId: "place-1",
		});
		const client = createRouterClient(
			createORPCRouter({
				container: testContainer(repo),
				streak: new MemoryStreak(),
			}),
			{ context: context(hostUser) },
		);

		await expect(client.dashboard.history({})).resolves.toEqual([
			expect.objectContaining({
				id: sessionId,
				title: "Friday lunch",
				joinCode: "JOIN01",
				status: "decided",
				winnerName: "Noodle House",
			}),
		]);
		await expect(
			client.dashboard.session({ sessionId }),
		).resolves.toMatchObject({
			id: sessionId,
			title: "Friday lunch",
			members: [{ image: "https://example.test/ada.png" }],
			candidates: [{ restaurant }],
			winnerName: "Noodle House",
		});
	});

	it("rejects dashboard history for anonymous users", async () => {
		const repo = new MemorySessionRepo();
		repo.sessions.set(sessionId, sessionSummary({ title: "Friday lunch" }));
		repo.members.push(
			memberInput({
				id: guestMemberId,
				userId: "guest-user",
				displayName: "Grace",
				isHost: false,
			}),
		);
		const client = createRouterClient(
			createORPCRouter({
				container: testContainer(repo),
				streak: new MemoryStreak(),
			}),
			{ context: context(guestUser) },
		);

		await expect(client.dashboard.history({})).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});
});

const hostUser: AuthUser = {
	id: "host-user",
	displayName: "Ada",
	image: "https://example.test/ada.png",
	isAnonymous: false,
};
const guestUser: AuthUser = {
	id: "guest-user",
	displayName: "Grace",
	isAnonymous: true,
};
const accountGuestUser: AuthUser = {
	id: "guest-user",
	displayName: "Grace",
	image: "https://example.test/grace.png",
	isAnonymous: false,
};
const restaurant: Restaurant = {
	id: "place-1",
	name: "Noodle House",
	address: "1 Main St",
	cuisineTags: ["thai"],
};

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

function sessionSummary(
	overrides: Partial<StoredSessionSummary> = {},
): StoredSessionSummary {
	return {
		id: sessionId,
		joinCode: "JOIN01",
		hostUserId: "host-user",
		status: "swiping",
		lat: -37.8136,
		lng: 144.9631,
		radiusM: 500,
		cuisines: ["thai"],
		createdAt: "2026-06-20T01:02:03.000Z",
		...overrides,
	};
}

function memberInput(
	overrides: Partial<AddMemberRecord> = {},
): AddMemberRecord {
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

type StoredSessionSummary = SessionSummary & {
	hostUserId?: string;
	createdAt?: string;
};

class MemorySessionRepo implements SessionRepo<MemorySessionRepo> {
	readonly sessions = new Map<string, StoredSessionSummary>();
	readonly members: AddMemberRecord[] = [];
	readonly outbox: OutboxWrite[] = [];
	readonly restaurants = new Map<string, Restaurant>();
	readonly swipes: Array<{
		sessionId: string;
		userId: string;
		memberId: string;
		restaurantId: string;
		decision: Decision;
	}> = [];
	readonly candidates: Array<{
		id: string;
		sessionId: string;
		restaurantId: string;
	}> = [];

	async withTx<T>(fn: (tx: MemorySessionRepo) => Promise<T>): Promise<T> {
		return fn(this);
	}

	async createSession(
		_tx: MemorySessionRepo,
		input: {
			id: string;
			joinCode: string;
			title?: string;
			hostUserId: string;
			lat: number;
			lng: number;
			radiusM: number;
			cuisines: string[];
			pollDurationSec: number;
			promoteThreshold: number;
			createdAt: string;
		},
	): Promise<void> {
		this.sessions.set(input.id, {
			...input,
			status: "lobby",
		});
	}

	async addMember(
		_tx: MemorySessionRepo,
		input: AddMemberRecord,
	): Promise<void> {
		this.members.push(input);
	}

	async getSession(
		_tx: MemorySessionRepo,
		sessionId: string,
	): Promise<SessionSummary | null> {
		return this.sessions.get(sessionId) ?? null;
	}

	async getSessionByJoinCode(
		_tx: MemorySessionRepo,
		joinCode: string,
	): Promise<SessionSummary | null> {
		return (
			[...this.sessions.values()].find(
				(session) => session.joinCode === joinCode,
			) ?? null
		);
	}

	async listSessionsForUser(_tx: MemorySessionRepo, userId: string) {
		const sessionIds = new Set(
			this.members
				.filter((member) => member.userId === userId)
				.map((member) => member.sessionId),
		);
		return [...this.sessions.values()]
			.filter((session) => sessionIds.has(session.id))
			.map((session) => ({
				id: session.id,
				title: session.title ?? null,
				joinCode: session.joinCode,
				status: session.status ?? "lobby",
				createdAt: session.createdAt ?? "2026-06-20T01:02:03.000Z",
				winnerName: this.winnerName(session),
			}));
	}

	async getSessionSummary(
		_tx: MemorySessionRepo,
		sessionId: string,
		userId: string,
	) {
		if (
			!this.members.some(
				(member) => member.sessionId === sessionId && member.userId === userId,
			)
		) {
			return null;
		}
		const session = this.sessions.get(sessionId);
		if (!session) {
			return null;
		}
		return {
			id: session.id,
			title: session.title ?? null,
			joinCode: session.joinCode,
			status: session.status ?? "lobby",
			winnerName: this.winnerName(session),
			candidates: await this.listCandidateResults(),
			members: await this.listMembers(this, sessionId),
		};
	}

	async listMembers(
		_tx: MemorySessionRepo,
		sessionId: string,
	): Promise<AddMemberRecord[]> {
		return this.members.filter((member) => member.sessionId === sessionId);
	}

	async isHost(
		_tx: MemorySessionRepo,
		sessionId: string,
		userId: string,
	): Promise<boolean> {
		return this.members.some(
			(member) =>
				member.sessionId === sessionId &&
				member.userId === userId &&
				member.isHost,
		);
	}

	async startPoll(
		_tx: MemorySessionRepo,
		sessionId: string,
		deadlineAt: string,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.status = "polling";
			session.pollDeadlineAt = deadlineAt;
		}
	}

	async startSwiping(_tx: MemorySessionRepo, sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (session?.status === "lobby") {
			session.status = "swiping";
		}
	}

	async insertOutbox(
		_tx: MemorySessionRepo,
		event: OutboxWrite,
	): Promise<string> {
		this.outbox.push(event);
		return crypto.randomUUID();
	}

	async getRestaurant(
		_tx: MemorySessionRepo,
		restaurantId: string,
	): Promise<Restaurant | null> {
		return this.restaurants.get(restaurantId) ?? null;
	}

	async listDeckRestaurants(
		_tx: MemorySessionRepo,
		_sessionId: string,
		memberId: string,
		limit: number,
	): Promise<Restaurant[]> {
		const swiped = new Set(
			this.swipes
				.filter((swipe) => swipe.memberId === memberId)
				.map((swipe) => swipe.restaurantId),
		);
		return [...this.restaurants.values()]
			.filter((candidate) => !swiped.has(candidate.id))
			.slice(0, limit);
	}

	async recordSwipe(
		_tx: MemorySessionRepo,
		input: {
			sessionId: string;
			userId: string;
			memberId: string;
			restaurantId: string;
			decision: Decision;
		},
	): Promise<{ created: boolean }> {
		if (
			this.swipes.some(
				(swipe) =>
					swipe.sessionId === input.sessionId &&
					swipe.memberId === input.memberId &&
					swipe.restaurantId === input.restaurantId,
			)
		) {
			return { created: false };
		}
		this.swipes.push(input);
		return { created: true };
	}

	async countAccepts(
		_tx: MemorySessionRepo,
		sessionId: string,
		restaurantId: string,
	): Promise<number> {
		return this.swipes.filter(
			(swipe) =>
				swipe.sessionId === sessionId &&
				swipe.restaurantId === restaurantId &&
				swipe.decision === "accept",
		).length;
	}

	async isCandidate(
		_tx: MemorySessionRepo,
		sessionId: string,
		restaurantId: string,
	): Promise<boolean> {
		return this.candidates.some(
			(candidate) =>
				candidate.sessionId === sessionId &&
				candidate.restaurantId === restaurantId,
		);
	}

	async addCandidate(
		_tx: MemorySessionRepo,
		input: { sessionId: string; restaurantId: string },
	): Promise<{ candidateId: string }> {
		const candidateId = "00000000-0000-4000-8000-000000000301";
		this.candidates.push({ id: candidateId, ...input });
		return { candidateId };
	}

	async updateMemberRadius(
		_tx: MemorySessionRepo,
		sessionId: string,
		memberId: string,
		radiusM: number,
	): Promise<void> {
		const member = this.members.find(
			(candidate) =>
				candidate.sessionId === sessionId && candidate.id === memberId,
		);
		if (member) {
			member.radiusM = radiusM;
		}
	}

	async listCandidateResults(): Promise<
		Array<{
			id: string;
			restaurant: Restaurant;
			promotedAt: string;
			upvotes: number;
			downvotes: number;
			netScore: number;
		}>
	> {
		return this.candidates.map((candidate) => ({
			id: candidate.id,
			restaurant: this.restaurants.get(candidate.restaurantId) ?? restaurant,
			promotedAt: "2026-06-20T01:02:03.000Z",
			upvotes: 0,
			downvotes: 0,
			netScore: 0,
		}));
	}

	private winnerName(session: SessionSummary): string | null {
		const winner = this.candidates.find(
			(candidate) => candidate.id === session.winnerCandidateId,
		);
		return winner
			? (this.restaurants.get(winner.restaurantId)?.name ?? null)
			: null;
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
