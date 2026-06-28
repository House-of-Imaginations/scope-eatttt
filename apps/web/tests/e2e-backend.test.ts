import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRouterClient } from "@orpc/server";
import { DrizzleRelayStore, DrizzleSessionRepo } from "@scope/adapters";
import type { Env } from "@scope/config";
import type { AppEvent } from "@scope/contract";
import {
	type AuthProvider,
	type AuthUser,
	FakePlaces,
	InMemoryBus,
	InlineQueue,
	MemoryCache,
} from "@scope/core";
import { createDatabaseClients, restaurantCache, user } from "@scope/db";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, it } from "vitest";
import { runPollCloseJob } from "../../worker/src/jobs/pollClose";
import type { AppContainer } from "../src/lib/server/container";
import { type ORPCContext, createORPCRouter } from "../src/lib/server/orpc";
import { type OutboxNotifyListener, startRelay } from "../src/lib/server/relay";
import { createSessionEventStream } from "../src/lib/server/sse";

const sessionId = "00000000-0000-4000-8000-000000000001";
const hostMemberId = "00000000-0000-4000-8000-000000000101";
const guestMemberId = "00000000-0000-4000-8000-000000000102";

const describeE2E = process.env.RUN_E2E === "1" ? describe : describe.skip;

describeE2E("backend happy path", () => {
	it("runs create/join/swipe/poll/vote/winner over oRPC, relay, SSE, and worker job", async () => {
		const postgres = await new PostgreSqlContainer("postgres:16-alpine")
			.withDatabase("scope_eatttt")
			.withUsername("scope")
			.withPassword("scope")
			.start();
		const clients = createDatabaseClients({
			DATABASE_URL: postgres.getConnectionUri(),
			DATABASE_DIRECT_URL: postgres.getConnectionUri(),
		});
		const repo = new DrizzleSessionRepo(clients.db);
		const relayStore = new DrizzleRelayStore(clients.db);
		const bus = new InMemoryBus();
		let relayStop: (() => Promise<void>) | undefined;

		try {
			await applyMigrations(clients.pooledSql);
			await seedUsers(clients.db);
			await seedRestaurants(clients.db);
			relayStop = await startRelay({
				store: relayStore,
				bus,
				listener: new NoopListener(),
				pollMs: 10,
			});
			const container = testContainer(repo, relayStore, bus);
			const router = createORPCRouter({
				container,
				ids: {
					sessionId: () => sessionId,
					memberId: sequence([hostMemberId, guestMemberId]),
					joinCode: () => "JOIN01",
				},
				now: () => "2026-06-20T01:02:03.000Z",
			});
			const hostClient = createRouterClient(router, {
				context: context(hostUser),
			});
			const guestClient = createRouterClient(router, {
				context: context(guestUser),
			});

			const created = await hostClient.session.create({
				lat: -37.8136,
				lng: 144.9631,
				cuisines: ["thai"],
				radiusM: 500,
			});
			const stream = await createSessionEventStream({
				bus,
				replayStore: relayStore,
				sessionId: created.sessionId,
				heartbeatMs: 0,
			});
			const reader = stream.getReader();

			await guestClient.session.join({
				joinCode: created.joinCode,
				displayName: "Grace",
			});
			await hostClient.swipe.decide({
				sessionId: created.sessionId,
				restaurantId: "place-1",
				decision: "accept",
			});
			const promoted = await guestClient.swipe.decide({
				sessionId: created.sessionId,
				restaurantId: "place-1",
				decision: "accept",
			});
			expect(promoted.promoted).toBe(true);
			const candidateId = promoted.candidate?.id;
			expect(candidateId).toBeDefined();
			expect(await readEvent(reader, "restaurant.promoted")).toMatchObject({
				type: "restaurant.promoted",
				sessionId,
				candidateId,
			});

			await hostClient.poll.start({
				sessionId: created.sessionId,
				timerMs: 300000,
			});
			expect(await readEvent(reader, "poll.opened")).toMatchObject({
				type: "poll.opened",
				sessionId,
			});

			await guestClient.poll.vote({
				sessionId: created.sessionId,
				candidateId: candidateId!,
				value: 1,
			});
			expect(await readEvent(reader, "vote.cast")).toMatchObject({
				type: "vote.cast",
				sessionId,
				candidateId,
			});

			await runPollCloseJob({ repo }, { sessionId: created.sessionId });
			expect(await readEvent(reader, "poll.closed")).toMatchObject({
				type: "poll.closed",
				sessionId,
				winnerCandidateId: candidateId,
			});

			await reader.cancel();
		} finally {
			await relayStop?.();
			await clients.pooledSql.end({ timeout: 5 });
			await clients.directSql.end({ timeout: 5 });
			await postgres.stop();
		}
	}, 120_000);
});

const hostUser: AuthUser = {
	id: "host-user",
	displayName: "Ada",
	isAnonymous: false,
};
const guestUser: AuthUser = {
	id: "guest-user",
	displayName: "Grace",
	isAnonymous: false,
};

function context(user: AuthUser): ORPCContext {
	return { user };
}

function testContainer(
	repo: DrizzleSessionRepo,
	relayStore: DrizzleRelayStore,
	bus: InMemoryBus,
): AppContainer {
	return {
		config: testEnv(),
		repo,
		bus,
		queue: new InlineQueue(),
		cache: new MemoryCache(),
		places: new FakePlaces(),
		auth: new TestAuthProvider(hostUser),
		relayStore,
		relayListener: new NoopListener(),
	};
}

function testEnv(): Env {
	return {
		DATABASE_URL: "postgres://scope:scope@localhost:5432/scope_eatttt",
		DATABASE_DIRECT_URL: "postgres://scope:scope@localhost:5432/scope_eatttt",
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

async function readEvent(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	type: AppEvent["type"],
): Promise<AppEvent> {
	const deadline = Date.now() + 3000;
	while (Date.now() < deadline) {
		const chunk = await Promise.race([
			reader.read(),
			wait(300).then(() => undefined),
		]);
		if (!chunk?.value) {
			continue;
		}
		for (const frame of new TextDecoder().decode(chunk.value).split("\n\n")) {
			const dataLine = frame
				.split("\n")
				.find((line) => line.startsWith("data: "));
			if (!dataLine) {
				continue;
			}
			const event = JSON.parse(dataLine.slice("data: ".length)) as AppEvent;
			if (event.type === type) {
				return event;
			}
		}
	}
	throw new Error(`Timed out waiting for ${type}`);
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function seedUsers(
	db: ReturnType<typeof createDatabaseClients>["db"],
): Promise<void> {
	await db
		.insert(user)
		.values([
			userRow("host-user", "ada@example.com", "Ada"),
			userRow("guest-user", "grace@example.com", "Grace"),
		]);
}

async function seedRestaurants(
	db: ReturnType<typeof createDatabaseClients>["db"],
): Promise<void> {
	await db.insert(restaurantCache).values({
		id: "place-1",
		name: "Noodle House",
		address: "1 Main St",
		cuisineTags: ["thai"],
		cachedAt: new Date("2026-06-20T01:00:00.000Z"),
	});
}

function userRow(id: string, email: string, name: string) {
	const now = new Date("2026-06-20T01:00:00.000Z");
	return {
		id,
		email,
		name,
		displayName: name,
		emailVerified: true,
		isAnonymous: false,
		createdAt: now,
		updatedAt: now,
	};
}

async function applyMigrations(
	sqlClient: ReturnType<typeof createDatabaseClients>["pooledSql"],
): Promise<void> {
	await sqlClient`set client_min_messages to warning`;

	for (const file of [
		"0000_normal_gateway.sql",
		"0001_outbox_trigger.sql",
		"0002_member_scoped_activity.sql",
	]) {
		const migration = readFileSync(
			resolve(import.meta.dirname, "../../../packages/db/migrations", file),
			"utf8",
		);

		for (const statement of migration.split("--> statement-breakpoint")) {
			const trimmed = statement.trim();
			if (trimmed.length > 0) {
				await sqlClient.unsafe(trimmed);
			}
		}
	}
}

class NoopListener implements OutboxNotifyListener {
	async listen(): Promise<() => void> {
		return () => {};
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
