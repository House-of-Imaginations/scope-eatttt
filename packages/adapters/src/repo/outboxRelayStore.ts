import type { AppEvent } from "@scope/contract";
import { type createDatabaseClients, outboxEvent } from "@scope/db";
import { type SQL, and, asc, eq, isNull, sql } from "drizzle-orm";

type Database = ReturnType<typeof createDatabaseClients>["db"];
const SESSION_REPLAY_LIMIT = 500;

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

  async listSessionEventsAfter(
    sessionId: string,
    afterEventId?: string,
  ): Promise<DrizzleRelayOutboxRow[]> {
    const baseWhere = and(
      eq(outboxEvent.aggregate, "session"),
      eq(outboxEvent.aggregateId, sessionId),
    );
    const cursorWhere = afterEventId ? replayCursorWhere(sessionId, afterEventId) : undefined;

    const rows = await this.db
      .select()
      .from(outboxEvent)
      .where(cursorWhere ? and(baseWhere, cursorWhere) : baseWhere)
      .orderBy(asc(outboxEvent.createdAt), asc(outboxEvent.id))
      .limit(SESSION_REPLAY_LIMIT);
    return rows.map(outboxRow);
  }
}

function replayCursorWhere(sessionId: string, afterEventId: string): SQL {
  return sql`
    (${outboxEvent.createdAt}, ${outboxEvent.id}) > (
      select cursor_event.created_at, cursor_event.id
      from outbox_event as cursor_event
      where cursor_event.aggregate = 'session'
        and cursor_event.aggregate_id = ${sessionId}
        and cursor_event.id = ${afterEventId}
      limit 1
    )
  `;
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
