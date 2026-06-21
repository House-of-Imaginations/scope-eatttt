import { describe, expect, it } from "vitest";
import { createSession, joinSession } from "./session";
import type { OutboxWrite, SessionRepo, TransactionContext } from "../ports/repo";

class FakeSessionRepo implements SessionRepo<TransactionContext> {
  sessions = new Map<string, { id: string; joinCode: string }>();
  members: unknown[] = [];
  outbox: OutboxWrite[] = [];
  transactionWrites: string[] = [];

  async withTx<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return fn({ txId: "tx-1" });
  }

  async createSession(tx: TransactionContext, input: Parameters<SessionRepo<TransactionContext>["createSession"]>[1]) {
    this.transactionWrites.push(`createSession:${tx.txId}`);
    this.sessions.set(input.id, { id: input.id, joinCode: input.joinCode });
  }

  async addMember(tx: TransactionContext, input: Parameters<SessionRepo<TransactionContext>["addMember"]>[1]) {
    this.transactionWrites.push(`addMember:${tx.txId}`);
    this.members.push(input);
  }

  async getSessionByJoinCode(_tx: TransactionContext, joinCode: string) {
    return [...this.sessions.values()].find((session) => session.joinCode === joinCode) ?? null;
  }

  async getSession() {
    return null;
  }

  async listMembers() {
    return [];
  }

  async insertOutbox(tx: TransactionContext, event: OutboxWrite) {
    this.transactionWrites.push(`outbox:${tx.txId}`);
    this.outbox.push(event);
    return "event-1";
  }
}

describe("session commands", () => {
  it("creates a lunch session, host member, and member.joined outbox event in one repo transaction", async () => {
    const repo = new FakeSessionRepo();

    const result = await createSession(
      { repo, ids: { sessionId: () => "session-1", memberId: () => "member-1", joinCode: () => "ABCD12" }, now: () => "2026-06-20T00:00:00.000Z" },
      { lat: -37.8136, lng: 144.9631, cuisines: ["thai"], radiusM: 500 },
      "host-user",
      "Ada",
    );

    expect(result).toEqual({ sessionId: "session-1", joinCode: "ABCD12", memberId: "member-1" });
    expect(repo.transactionWrites).toEqual(["createSession:tx-1", "addMember:tx-1", "outbox:tx-1"]);
    expect(repo.outbox[0]).toMatchObject({
      aggregate: "session",
      aggregateId: "session-1",
      type: "member.joined",
      payload: {
        member: {
          id: "member-1",
          userId: "host-user",
          displayName: "Ada",
          isHost: true,
          joinedAt: "2026-06-20T00:00:00.000Z",
        },
      },
    });
  });

  it("joins by code and appends member.joined in the same repo transaction", async () => {
    const repo = new FakeSessionRepo();
    repo.sessions.set("session-1", { id: "session-1", joinCode: "ABCD12" });

    const result = await joinSession(
      { repo, ids: { memberId: () => "member-2" }, now: () => "2026-06-20T00:00:00.000Z" },
      { joinCode: "abcd12", displayName: "Grace" },
      "guest-user",
    );

    expect(result).toEqual({ sessionId: "session-1", memberId: "member-2" });
    expect(repo.transactionWrites).toEqual(["addMember:tx-1", "outbox:tx-1"]);
    expect(repo.outbox[0]).toMatchObject({
      aggregate: "session",
      aggregateId: "session-1",
      type: "member.joined",
      payload: {
        member: {
          id: "member-2",
          userId: "guest-user",
          displayName: "Grace",
          isHost: false,
          joinedAt: "2026-06-20T00:00:00.000Z",
        },
      },
    });
  });
});
