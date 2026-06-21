import { and, asc, eq, isNull } from "drizzle-orm";
import type { AppEvent } from "@scope/contract";
import { createDatabaseClients, outboxEvent } from "@scope/db";

type Database = ReturnType<typeof createDatabaseClients>["db"];

export interface DrizzleRelayOutboxRow {
  id: string;
  aggregate: string;
  aggregateId: string;
  type: AppEvent["type"];
  payload: unknown;
  occurredAt: Date;
  dispatchedAt: Date | null;
}

export class DrizzleRelayStore {
  constructor(private readonly db: Database) {}

  async listPending(): Promise<DrizzleRelayOutboxRow[]> {
    const rows = await this.db
      .select()
      .from(outboxEvent)
      .where(isNull(outboxEvent.dispatchedAt))
      .orderBy(asc(outboxEvent.createdAt));
    return rows.map(outboxRow);
  }

  async getPending(id: string): Promise<DrizzleRelayOutboxRow | null> {
    const rows = await this.db
      .select()
      .from(outboxEvent)
      .where(and(eq(outboxEvent.id, id), isNull(outboxEvent.dispatchedAt)))
      .limit(1);
    return rows[0] ? outboxRow(rows[0]) : null;
  }

  async markDispatched(id: string): Promise<boolean> {
    const rows = await this.db
      .update(outboxEvent)
      .set({ dispatchedAt: new Date() })
      .where(and(eq(outboxEvent.id, id), isNull(outboxEvent.dispatchedAt)))
      .returning({ id: outboxEvent.id });
    return rows.length > 0;
  }

  async listSessionEventsAfter(sessionId: string, afterEventId?: string): Promise<DrizzleRelayOutboxRow[]> {
    const rows = await this.db
      .select()
      .from(outboxEvent)
      .where(and(eq(outboxEvent.aggregate, "session"), eq(outboxEvent.aggregateId, sessionId)))
      .orderBy(asc(outboxEvent.createdAt));
    return rows.slice(replayStartIndex(rows, afterEventId)).map(outboxRow);
  }
}

function replayStartIndex(rows: Array<typeof outboxEvent.$inferSelect>, afterEventId?: string): number {
  if (!afterEventId) {
    return 0;
  }

  const eventIndex = rows.findIndex((row) => row.id === afterEventId);
  return eventIndex === -1 ? 0 : eventIndex + 1;
}

function outboxRow(row: typeof outboxEvent.$inferSelect): DrizzleRelayOutboxRow {
  return {
    id: row.id,
    aggregate: row.aggregate,
    aggregateId: row.aggregateId,
    type: row.type as AppEvent["type"],
    payload: row.payload,
    occurredAt: row.occurredAt,
    dispatchedAt: row.dispatchedAt,
  };
}
