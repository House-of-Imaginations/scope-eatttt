import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createDatabaseClients, outboxEvent } from "@scope/db";
import { DrizzleRelayStore } from "./outboxRelayStore";

const eventId = "00000000-0000-4000-8000-000000000201";
const nextEventId = "00000000-0000-4000-8000-000000000202";
const sessionId = "00000000-0000-4000-8000-000000000001";
const occurredAt = "2026-06-20T01:02:03.000Z";

describe("DrizzleRelayStore", () => {
  it("loads pending outbox rows and marks them dispatched once", async () => {
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
      await clients.db.insert(outboxEvent).values({
        id: eventId,
        aggregate: "session",
        aggregateId: sessionId,
        type: "poll.opened",
        payload: { deadlineAt: "2026-06-20T01:07:03.000Z" },
        occurredAt: new Date(occurredAt),
      });

      const store = new DrizzleRelayStore(clients.db);

      await expect(store.listPending()).resolves.toMatchObject([
        {
          id: eventId,
          aggregate: "session",
          aggregateId: sessionId,
          type: "poll.opened",
          payload: { deadlineAt: "2026-06-20T01:07:03.000Z" },
          dispatchedAt: null,
        },
      ]);
      await expect(store.getPending(eventId)).resolves.toMatchObject({ id: eventId });
      await expect(store.markDispatched(eventId)).resolves.toBe(true);
      await expect(store.markDispatched(eventId)).resolves.toBe(false);
      await expect(store.listPending()).resolves.toEqual([]);

      await clients.db.insert(outboxEvent).values({
        id: nextEventId,
        aggregate: "session",
        aggregateId: sessionId,
        type: "poll.closed",
        payload: { winnerCandidateId: "00000000-0000-4000-8000-000000000301" },
        occurredAt: new Date("2026-06-20T01:08:03.000Z"),
      });
      await expect(store.listSessionEventsAfter(sessionId, eventId)).resolves.toMatchObject([{ id: nextEventId }]);
      await expect(store.listSessionEventsAfter(sessionId, "00000000-0000-4000-8000-000000000999")).resolves.toEqual([]);
    } finally {
      await clients.pooledSql.end({ timeout: 5 });
      await clients.directSql.end({ timeout: 5 });
      await container.stop();
    }
  }, 120_000);
});

async function applyMigrations(sqlClient: ReturnType<typeof createDatabaseClients>["pooledSql"]): Promise<void> {
  await sqlClient`set client_min_messages to warning`;

  for (const file of ["0000_normal_gateway.sql", "0001_outbox_trigger.sql"]) {
    const migration = readFileSync(resolve(import.meta.dirname, "../../../db/migrations", file), "utf8");

    for (const statement of migration.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
        await sqlClient.unsafe(trimmed);
      }
    }
  }
}
