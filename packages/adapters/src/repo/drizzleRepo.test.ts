import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AddMemberRecord, CreateSessionRecord, OutboxWrite } from "@scope/core";
import {
  createDatabaseClients,
  lunchSession,
  outboxEvent,
  type pollCandidate,
  restaurantCache,
  type sessionMember,
  type swipe,
  user,
  type vote,
} from "@scope/db";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DrizzleSessionRepo } from "./drizzleRepo";

const testTimestamp = "2026-06-20T01:02:03.000Z";
const testUserTimestamp = "2026-06-20T01:00:00.000Z";
const nextTimestamp = "2026-06-20T01:03:03.000Z";
const pollDeadline = "2026-06-20T01:07:03.000Z";
const testSessionUuid = "00000000-0000-4000-8000-000000000001";

describe("DrizzleSessionRepo", () => {
  it("keeps writes transactional and serves dashboard reads against migrated Postgres", async () => {
    const container = await new PostgreSqlContainer("postgres:16-alpine")
      .withDatabase("scope_eatttt")
      .withUsername("scope")
      .withPassword("scope")
      .start();
    const clients = createDatabaseClients({
      DATABASE_URL: container.getConnectionUri(),
      DATABASE_DIRECT_URL: container.getConnectionUri(),
    });

    try {
      await applyMigrations(clients.pooledSql);
      await clients.db.insert(user).values({
        id: "u1",
        name: "Ada",
        email: "ada@example.com",
        emailVerified: true,
        createdAt: new Date(testUserTimestamp),
        updatedAt: new Date(testUserTimestamp),
      });

      const repo = new DrizzleSessionRepo(clients.db);

      await expect(
        repo.withTx(async (tx) => {
          await repo.createSession(tx, sessionInput({ id: testSessionUuid }));
          await repo.insertOutbox(tx, outboxInput({ aggregateId: testSessionUuid }));
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");

      await expect(clients.db.select().from(lunchSession)).resolves.toHaveLength(0);
      await expect(clients.db.select().from(outboxEvent)).resolves.toHaveLength(0);

      await repo.withTx(async (tx) => {
        await repo.upsertRestaurants(tx, [
          {
            cachedAt: testTimestamp,
            restaurant: {
              id: "place-1",
              name: "Noodle House",
              address: "1 Main St",
              cuisineTags: ["thai"],
              lat: -37.8136,
              lng: 144.9631,
              rating: 4.5,
              priceLevel: 2,
              distanceM: 220,
            },
          },
        ]);
        await repo.insertOutbox(
          tx,
          outboxInput({
            aggregateId: testSessionUuid,
            type: "deck.replenished",
          }),
        );
      });

      await expect(clients.db.select().from(restaurantCache)).resolves.toHaveLength(1);
      await expect(clients.db.select().from(outboxEvent)).resolves.toHaveLength(1);

      await repo.withTx(async (tx) => {
        await repo.createSession(tx, sessionInput({ id: testSessionUuid, title: "Friday lunch" }));
        await repo.addMember(
          tx,
          memberInput({
            id: "00000000-0000-4000-8000-000000000101",
            sessionId: testSessionUuid,
          }),
        );
        const { candidateId } = await repo.addCandidate(tx, {
          sessionId: testSessionUuid,
          restaurantId: "place-1",
          promotedAt: testTimestamp,
        });
        await repo.startPoll(tx, testSessionUuid, pollDeadline);
        await repo.closePoll(tx, testSessionUuid, candidateId);
      });

      await repo.withTx(async (tx) => {
        await expect(repo.listSessionsForUser(tx, "u1")).resolves.toEqual([
          {
            id: testSessionUuid,
            title: "Friday lunch",
            joinCode: "ABCD",
            status: "decided",
            createdAt: testTimestamp,
            winnerName: "Noodle House",
          },
        ]);
        await expect(repo.getSessionSummary(tx, testSessionUuid, "stranger")).resolves.toBeNull();
        await expect(repo.getSessionSummary(tx, testSessionUuid, "u1")).resolves.toMatchObject({
          id: testSessionUuid,
          title: "Friday lunch",
          joinCode: "ABCD",
          status: "decided",
          winnerName: "Noodle House",
          members: [{ userId: "u1", displayName: "Ada" }],
          candidates: [{ restaurant: { id: "place-1", name: "Noodle House" } }],
        });
      });
    } finally {
      await clients.pooledSql.end({ timeout: 5 });
      await clients.directSql.end({ timeout: 5 });
      await container.stop();
    }
  }, 120_000);

  it("uses db.transaction and passes the same tx to domain and outbox writes", async () => {
    const db = makeFakeDb();
    const repo = new DrizzleSessionRepo(db);

    await repo.withTx(async (tx) => {
      await repo.createSession(tx, sessionInput());
      await repo.addMember(tx, memberInput());
      await repo.insertOutbox(tx, outboxInput());
    });

    expect(db.transactionCalls).toBe(1);
    expect(db.root.operations).toEqual([]);
    expect(operationTables(db.tx)).toEqual(["lunch_session", "session_member", "outbox_event"]);
  });

  it("upserts restaurant cache rows through the transaction", async () => {
    const db = makeFakeDb();
    const repo = new DrizzleSessionRepo(db);

    await repo.withTx(async (tx) => {
      await repo.upsertRestaurants(tx, [
        {
          cachedAt: testTimestamp,
          restaurant: {
            id: "place-1",
            name: "Noodle House",
            address: "1 Main St",
            cuisineTags: ["thai"],
          },
        },
      ]);
    });

    expect(operationLabels(db.tx)).toEqual(["insert:restaurant_cache"]);
    expect(db.tx.operations[0]?.conflict).toBe("update");
  });

  it("propagates rollback errors from the transaction", async () => {
    const db = makeFakeDb();
    const repo = new DrizzleSessionRepo(db);

    await expect(
      repo.withTx(async (tx) => {
        await repo.createSession(tx, sessionInput());
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(db.transactionCalls).toBe(1);
    expect(db.tx.operations).toHaveLength(1);
  });

  it("starts swiping by updating a lobby session", async () => {
    const db = makeFakeDb();
    const repo = new DrizzleSessionRepo(db);

    await repo.withTx((tx) => repo.startSwiping(tx, "s1"));

    expect(operationLabels(db.tx)).toEqual(["update:lunch_session"]);
    expect(db.tx.operations[0]?.set).toMatchObject({ status: "swiping" });
  });

  it("maps session and member rows from reads", async () => {
    const db = makeFakeDb({
      lunch_session: [
        {
          id: "s1",
          joinCode: "ABCD",
          hostUserId: "u1",
          status: "swiping",
          title: "Friday lunch",
          lat: -37.8136,
          lng: 144.9631,
          radiusM: 500,
          cuisines: ["thai"],
          pollDurationSec: 180,
          promoteThreshold: 3,
          pollDeadlineAt: new Date(pollDeadline),
          winnerCandidateId: "00000000-0000-4000-8000-000000000301",
        },
      ],
      session_member: [
        {
          id: "m1",
          sessionId: "s1",
          userId: "u1",
          displayName: "Ada",
          image: "https://example.test/ada.png",
          isHost: true,
          radiusM: 500,
          joinedAt: new Date(testTimestamp),
        },
      ],
    });
    const repo = new DrizzleSessionRepo(db);

    await repo.withTx(async (tx) => {
      await expect(repo.getSession(tx, "s1")).resolves.toEqual({
        id: "s1",
        joinCode: "ABCD",
        hostUserId: "u1",
        status: "swiping",
        title: "Friday lunch",
        lat: -37.8136,
        lng: 144.9631,
        radiusM: 500,
        cuisines: ["thai"],
        pollDurationSec: 180,
        promoteThreshold: 3,
        pollDeadlineAt: pollDeadline,
        winnerCandidateId: "00000000-0000-4000-8000-000000000301",
      });
      await expect(repo.getSessionByJoinCode(tx, "ABCD")).resolves.toEqual({
        id: "s1",
        joinCode: "ABCD",
        hostUserId: "u1",
        status: "swiping",
        title: "Friday lunch",
        lat: -37.8136,
        lng: 144.9631,
        radiusM: 500,
        cuisines: ["thai"],
        pollDurationSec: 180,
        promoteThreshold: 3,
        pollDeadlineAt: pollDeadline,
        winnerCandidateId: "00000000-0000-4000-8000-000000000301",
      });
      await expect(repo.listMembers(tx, "s1")).resolves.toEqual([
        {
          id: "m1",
          sessionId: "s1",
          userId: "u1",
          displayName: "Ada",
          image: "https://example.test/ada.png",
          isHost: true,
          radiusM: 500,
          joinedAt: testTimestamp,
        },
      ]);
    });

    expect(operationLabels(db.tx)).toEqual([
      "select:lunch_session",
      "select:lunch_session",
      "select:session_member",
    ]);
  });

  it("lists dashboard history and member-gates session summaries", async () => {
    const summaryId = "00000000-0000-4000-8000-000000000001";
    const db = makeFakeDb({
      lunch_session: [
        {
          id: summaryId,
          title: "Friday lunch",
          joinCode: "ABCD",
          status: "decided",
          createdAt: new Date(testTimestamp),
          winnerCandidateId: "c1",
          winnerName: "Noodle House",
        },
        {
          id: summaryId,
          title: "Friday lunch",
          joinCode: "ABCD",
          status: "decided",
          createdAt: new Date(testTimestamp),
          winnerCandidateId: "c1",
          winnerName: "Noodle House",
        },
      ],
      session_member: [
        {
          id: "m1",
          sessionId: summaryId,
          userId: "u1",
          displayName: "Ada",
          image: null,
          isHost: true,
          joinedAt: new Date(testTimestamp),
        },
      ],
      poll_candidate: [
        {
          id: "c1",
          candidateId: "c1",
          promotedAt: new Date(testTimestamp),
          net: 1,
          up: 1,
          down: 0,
          name: "Noodle House",
          address: "1 Main St",
          cuisineTags: ["thai"],
          lat: null,
          lng: null,
          rating: null,
          priceLevel: null,
          distanceM: null,
        },
      ],
    });
    const repo = new DrizzleSessionRepo(db);

    await repo.withTx(async (tx) => {
      await expect(repo.listSessionsForUser(tx, "u1")).resolves.toEqual([
        {
          id: summaryId,
          title: "Friday lunch",
          joinCode: "ABCD",
          status: "decided",
          createdAt: testTimestamp,
          winnerName: "Noodle House",
        },
      ]);
      await expect(repo.getSessionSummary(tx, summaryId, "u1")).resolves.toMatchObject({
        id: summaryId,
        title: "Friday lunch",
        joinCode: "ABCD",
        status: "decided",
        winnerName: "Noodle House",
        members: [{ displayName: "Ada" }],
        candidates: [{ restaurant: { name: "Noodle House" } }],
      });
    });
  });

  it("covers swipe repository writes and queries", async () => {
    const db = makeFakeDb({
      swipe: [{ count: 2 }],
      restaurant_cache: [
        {
          id: "r1",
          name: "Noodle House",
          address: "1 Main St",
          cuisineTags: ["thai"],
          lat: -37.8136,
          lng: 144.9631,
          rating: 4.5,
          priceLevel: 2,
          distanceM: 220,
        },
      ],
      poll_candidate: [{ id: "c1" }],
    });
    const repo = new DrizzleSessionRepo(db);

    await repo.withTx(async (tx) => {
      await expect(
        repo.recordSwipe(tx, {
          sessionId: "s1",
          userId: "u1",
          memberId: "m1",
          restaurantId: "r1",
          decision: "accept",
          swipedAt: testTimestamp,
        }),
      ).resolves.toEqual({ created: true });
      await expect(repo.countAccepts(tx, "s1", "r1")).resolves.toBe(2);
      await expect(repo.isCandidate(tx, "s1", "r1")).resolves.toBe(true);
      await expect(
        repo.addCandidate(tx, {
          sessionId: "s1",
          restaurantId: "r1",
          promotedAt: testTimestamp,
        }),
      ).resolves.toEqual({
        candidateId: "c1",
      });
      await repo.updateMemberRadius(tx, "s1", "u1", 1000);
      await expect(repo.getRestaurant(tx, "r1")).resolves.toEqual({
        id: "r1",
        name: "Noodle House",
        address: "1 Main St",
        cuisineTags: ["thai"],
        lat: -37.8136,
        lng: 144.9631,
        rating: 4.5,
        priceLevel: 2,
        distanceM: 220,
      });
      await expect(repo.listDeckRestaurants(tx, "s1", "u1", 10)).resolves.toEqual([
        {
          id: "r1",
          name: "Noodle House",
          address: "1 Main St",
          cuisineTags: ["thai"],
          lat: -37.8136,
          lng: 144.9631,
          rating: 4.5,
          priceLevel: 2,
          distanceM: 220,
        },
      ]);
    });

    expect(operationLabels(db.tx)).toEqual([
      "insert:swipe",
      "select:swipe",
      "select:poll_candidate",
      "insert:poll_candidate",
      "update:session_member",
      "select:restaurant_cache",
      "select:restaurant_cache",
    ]);
  });

  it("covers poll repository writes and tally queries", async () => {
    const db = makeFakeDb({
      session_member: [{ isHost: true }],
      vote: [{ up: 2, down: 1, net: 1 }],
      poll_candidate: [
        {
          id: "c1",
          candidateId: "c1",
          promotedAt: new Date(testTimestamp),
          net: 1,
          up: 2,
          down: 1,
          name: "Noodle House",
          address: "1 Main St",
          cuisineTags: ["thai"],
          lat: -37.8136,
          lng: 144.9631,
          rating: 4.5,
          priceLevel: 2,
          distanceM: 220,
        },
        {
          id: "c2",
          candidateId: "c2",
          promotedAt: new Date(nextTimestamp),
          net: 0,
          up: 0,
          down: 0,
          name: "Ramen Bar",
          address: "2 Main St",
          cuisineTags: ["japanese"],
          lat: null,
          lng: null,
          rating: null,
          priceLevel: null,
          distanceM: null,
        },
      ],
    });
    const repo = new DrizzleSessionRepo(db);

    await repo.withTx(async (tx) => {
      await expect(repo.isHost(tx, "s1", "u1")).resolves.toBe(true);
      await repo.startPoll(tx, "s1", pollDeadline);
      await repo.upsertVote(tx, {
        sessionId: "s1",
        candidateId: "c1",
        userId: "u1",
        memberId: "m1",
        value: 1,
      });
      await expect(repo.candidateBelongsToSession(tx, "s1", "c1")).resolves.toBe(true);
      await expect(repo.tally(tx, "c1")).resolves.toEqual({
        up: 2,
        down: 1,
        net: 1,
      });
      await expect(repo.listCandidatesWithTally(tx, "s1")).resolves.toEqual([
        { id: "c1", promotedAt: testTimestamp, net: 1 },
        { id: "c2", promotedAt: nextTimestamp, net: 0 },
      ]);
      await expect(repo.listCandidateResults(tx, "s1")).resolves.toEqual([
        {
          id: "c1",
          restaurant: {
            id: "c1",
            name: "Noodle House",
            address: "1 Main St",
            cuisineTags: ["thai"],
            lat: -37.8136,
            lng: 144.9631,
            rating: 4.5,
            priceLevel: 2,
            distanceM: 220,
          },
          promotedAt: testTimestamp,
          upvotes: 2,
          downvotes: 1,
          netScore: 1,
        },
        {
          id: "c2",
          restaurant: {
            id: "c2",
            name: "Ramen Bar",
            address: "2 Main St",
            cuisineTags: ["japanese"],
          },
          promotedAt: nextTimestamp,
          upvotes: 0,
          downvotes: 0,
          netScore: 0,
        },
      ]);
      await repo.closePoll(tx, "s1", "c1");
    });

    expect(operationLabels(db.tx)).toEqual([
      "select:session_member",
      "update:lunch_session",
      "insert:vote",
      "select:poll_candidate",
      "select:vote",
      "select:poll_candidate",
      "select:poll_candidate",
      "update:lunch_session",
    ]);
  });

  it("reassigns anonymous user app rows when an account is linked", async () => {
    const db = makeFakeDb();
    const repo = new DrizzleSessionRepo(db);

    await repo.reassignUserRows("anon-user", "real-user");

    expect(operationLabels(db.tx)).toEqual([
      "update:lunch_session",
      "update:session_member",
      "update:swipe",
      "update:vote",
    ]);
    expect(db.tx.operations.map((operation) => operation.set)).toEqual([
      { hostUserId: "real-user" },
      { userId: "real-user" },
      { userId: "real-user" },
      { userId: "real-user" },
    ]);
  });

  it("checks whether a user is anonymous", async () => {
    const db = makeFakeDb({ user: [{ isAnonymous: true }] });
    const repo = new DrizzleSessionRepo(db);

    await expect(repo.isAnonymousUser("anon-user")).resolves.toBe(true);
    expect(operationLabels(db.root)).toEqual(["select:user"]);
  });
});

function sessionInput(overrides: Partial<CreateSessionRecord> = {}): CreateSessionRecord {
  return {
    id: "s1",
    joinCode: "ABCD",
    hostUserId: "u1",
    lat: 1,
    lng: 2,
    radiusM: 500,
    cuisines: ["sushi"],
    pollDurationSec: 300,
    promoteThreshold: 2,
    createdAt: testTimestamp,
    ...overrides,
  };
}

function memberInput(overrides: Partial<AddMemberRecord> = {}): AddMemberRecord {
  return {
    id: "m1",
    sessionId: "s1",
    userId: "u1",
    displayName: "Ada",
    isHost: true,
    radiusM: 500,
    joinedAt: testTimestamp,
    ...overrides,
  };
}

function outboxInput(overrides: Partial<OutboxWrite> = {}): OutboxWrite {
  return {
    aggregate: "session",
    aggregateId: "s1",
    type: "member.joined",
    payload: { sessionId: "s1", userId: "u1" },
    ...overrides,
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
    "0003_mute_slapstick.sql",
  ]) {
    const migration = readFileSync(
      resolve(import.meta.dirname, "../../../db/migrations", file),
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

type TableName =
  | "lunch_session"
  | "session_member"
  | "swipe"
  | "restaurant_cache"
  | "poll_candidate"
  | "vote"
  | "outbox_event"
  | "user";

interface FakeOperation {
  kind: "insert" | "select" | "update";
  table: TableName;
  values?: unknown;
  set?: unknown;
  conflict?: "nothing" | "update";
}

interface FakeContext {
  operations: FakeOperation[];
  rows: Partial<Record<TableName, unknown[]>>;
}

type FakeDrizzle = ReturnType<typeof makeFakeDrizzle>;

type FakeDb = FakeDrizzle & {
  root: FakeContext;
  tx: FakeContext;
  transactionCalls: number;
  transaction<T>(fn: (tx: FakeDrizzle) => Promise<T>): Promise<T>;
};

function makeFakeDb(rows: Partial<Record<TableName, unknown[]>> = {}): FakeDb {
  const root = makeFakeContext(rows);
  const tx = makeFakeContext(rows);
  return {
    root,
    tx,
    transactionCalls: 0,
    async transaction<T>(fn: (tx: FakeDrizzle) => Promise<T>): Promise<T> {
      this.transactionCalls += 1;
      return fn(makeFakeDrizzle(tx));
    },
    ...makeFakeDrizzle(root),
  };
}

function makeFakeContext(rows: Partial<Record<TableName, unknown[]>>): FakeContext {
  return { operations: [], rows };
}

function makeFakeDrizzle(ctx: FakeContext): {
  insert(table: unknown): { values(values: unknown): FakeInsertValuesBuilder };
  select(selection?: unknown): { from(table: unknown): FakeSelectChain };
  update(table: unknown): {
    set(set: unknown): { where(condition?: unknown): FakeUpdateWhereBuilder };
  };
} {
  return {
    insert(table: unknown) {
      const operation: FakeOperation = {
        kind: "insert",
        table: tableName(table),
      };
      ctx.operations.push(operation);
      return {
        values(values: unknown) {
          operation.values = values;
          return {
            onConflictDoNothing() {
              operation.conflict = "nothing";
              return insertReturning(ctx, operation.table);
            },
            onConflictDoUpdate(options?: { set?: unknown }) {
              operation.conflict = "update";
              operation.set = options?.set;
              return insertReturning(ctx, operation.table);
            },
            returning: () => rowsPromise(ctx, operation.table, generatedIdRows()),
          };
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          const operation: FakeOperation = {
            kind: "select",
            table: tableName(table),
          };
          ctx.operations.push(operation);
          const chain = {
            where: () => chain,
            leftJoin: () => chain,
            groupBy: () => chain,
            orderBy: () => chain,
            limit: () => rowsPromise(ctx, operation.table),
            // biome-ignore lint/suspicious/noThenProperty: test mock chain needs .then to be awaitable
            then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
              rowsPromise(ctx, operation.table).then(resolve, reject),
          };
          return chain;
        },
      };
    },
    update(table: unknown) {
      const operation: FakeOperation = {
        kind: "update",
        table: tableName(table),
      };
      ctx.operations.push(operation);
      return {
        set(set: unknown) {
          operation.set = set;
          return {
            where: () => updateWhere(ctx, operation.table),
          };
        },
      };
    },
  };
}

interface FakeInsertValuesBuilder {
  onConflictDoNothing(): FakeInsertReturningBuilder;
  onConflictDoUpdate(): FakeInsertReturningBuilder;
  returning(): Promise<unknown[]>;
}

interface FakeInsertReturningBuilder {
  returning(): Promise<unknown[]>;
}

interface FakeSelectChain {
  where(condition?: unknown): FakeSelectChain;
  leftJoin(table?: unknown, condition?: unknown): FakeSelectChain;
  groupBy(...columns: unknown[]): FakeSelectChain;
  orderBy(...columns: unknown[]): FakeSelectChain;
  limit(count?: number): Promise<unknown[]>;
  then(
    resolve: (value: unknown[]) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown>;
}

interface FakeUpdateWhereBuilder extends PromiseLike<unknown[]> {
  returning(selection?: unknown): Promise<unknown[]>;
}

function insertReturning(ctx: FakeContext, table: TableName): FakeInsertReturningBuilder {
  return {
    returning: () => rowsPromise(ctx, table, generatedIdRows()),
  };
}

function updateWhere(ctx: FakeContext, table: TableName): FakeUpdateWhereBuilder {
  const promise = rowsPromise(ctx, table, generatedIdRows());
  return {
    returning: () => rowsPromise(ctx, table, generatedIdRows()),
    // biome-ignore lint/suspicious/noThenProperty: test mock implements PromiseLike
    then<TResult1 = unknown[], TResult2 = never>(
      onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): PromiseLike<TResult1 | TResult2> {
      return promise.then(onfulfilled, onrejected);
    },
  };
}

function rowsPromise(ctx: FakeContext, table: TableName, fallback?: unknown[]): Promise<unknown[]> {
  return Promise.resolve(rowsFor(ctx, table, fallback));
}

function rowsFor(ctx: FakeContext, table: TableName, fallback: unknown[] = []): unknown[] {
  return ctx.rows[table] ?? fallback;
}

function generatedIdRows(): unknown[] {
  return [{ id: "generated-id" }];
}

function operationLabels(ctx: FakeContext): string[] {
  return ctx.operations.map((operation) => `${operation.kind}:${operation.table}`);
}

function operationTables(ctx: FakeContext): TableName[] {
  return ctx.operations.map((operation) => operation.table);
}

function tableName(table: unknown): TableName {
  const name = getTableName(
    table as
      | typeof lunchSession
      | typeof sessionMember
      | typeof swipe
      | typeof restaurantCache
      | typeof pollCandidate
      | typeof vote
      | typeof outboxEvent
      | typeof user,
  );
  return name as TableName;
}
