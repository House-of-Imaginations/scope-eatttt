import { describe, expect, it } from "vitest";
import { createSession, joinSession, startSwiping } from "./session";
import type { AddMemberRecord, OutboxWrite, SessionRepo, TransactionContext } from "../ports/repo";

class FakeSessionRepo implements SessionRepo<TransactionContext> {
  sessions = new Map<string, {
    id: string;
    joinCode: string;
    status?: "lobby" | "swiping";
    hostUserId?: string;
    title?: string;
    pollDurationSec?: number;
    promoteThreshold?: number;
  }>();
  members: AddMemberRecord[] = [];
  outbox: OutboxWrite[] = [];
  transactionWrites: string[] = [];

  async withTx<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return fn({ txId: "tx-1" });
  }

  async createSession(tx: TransactionContext, input: Parameters<SessionRepo<TransactionContext>["createSession"]>[1]) {
    this.transactionWrites.push(`createSession:${tx.txId}`);
    this.sessions.set(input.id, { ...input, status: "lobby" });
  }

  async addMember(tx: TransactionContext, input: Parameters<SessionRepo<TransactionContext>["addMember"]>[1]) {
    this.transactionWrites.push(`addMember:${tx.txId}`);
    this.members.push(input);
  }

  async getSessionByJoinCode(_tx: TransactionContext, joinCode: string) {
    return [...this.sessions.values()].find((session) => session.joinCode === joinCode) ?? null;
  }

  async listSessionsForUser() {
    return [];
  }

  async getSessionSummary() {
    return null;
  }

  async getSession(_tx: TransactionContext, sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  async listMembers() {
    return [];
  }

  async isHost(_tx: TransactionContext, sessionId: string, userId: string) {
    return this.members.some((member) => member.sessionId === sessionId && member.userId === userId && member.isHost);
  }

  async startSwiping(tx: TransactionContext, sessionId: string) {
    this.transactionWrites.push(`startSwiping:${tx.txId}`);
    const session = this.sessions.get(sessionId);
    if (session) session.status = "swiping";
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

  it("generates a 10-character join code when no code generator is injected", async () => {
    const repo = new FakeSessionRepo();

    const result = await createSession(
      { repo, ids: { sessionId: () => "session-1", memberId: () => "member-1" }, now: () => "2026-06-20T00:00:00.000Z" },
      { lat: -37.8136, lng: 144.9631, cuisines: [], radiusM: 500 },
      "host-user",
      "Ada",
    );

    expect(result.joinCode).toMatch(/^[A-Z2-9]{10}$/);
  });

  it("persists poll options and host image on create", async () => {
    const repo = new FakeSessionRepo();

    await createSession(
      { repo, ids: { sessionId: () => "session-1", memberId: () => "member-1", joinCode: () => "ABCD12" }, now: () => "2026-06-20T00:00:00.000Z" },
      { lat: -37.8136, lng: 144.9631, cuisines: ["thai"], radiusM: 500, pollDurationSec: 180, promoteThreshold: 3, title: "Friday lunch" },
      "host-user",
      "Ada",
      "https://example.test/ada.png",
    );

    expect(repo.sessions.get("session-1")).toMatchObject({
      title: "Friday lunch",
      pollDurationSec: 180,
      promoteThreshold: 3,
    });
    expect(repo.outbox[0]).toMatchObject({
      payload: { member: { image: "https://example.test/ada.png" } },
    });
  });

  it("joins by code and appends member.joined in the same repo transaction", async () => {
    const repo = new FakeSessionRepo();
    repo.sessions.set("session-1", { id: "session-1", joinCode: "ABCD12" });

    const result = await joinSession(
      { repo, ids: { memberId: () => "member-2" }, now: () => "2026-06-20T00:00:00.000Z" },
      { joinCode: "abcd12", displayName: "Grace" },
      "guest-user",
      "https://example.test/grace.png",
    );

    expect(result).toEqual({ sessionId: "session-1", memberId: "member-2" });
    expect(repo.transactionWrites).toEqual(["addMember:tx-1", "outbox:tx-1"]);
    expect(repo.members[0]).toMatchObject({ image: "https://example.test/grace.png" });
    expect(repo.outbox[0]).toMatchObject({
      aggregate: "session",
      aggregateId: "session-1",
      type: "member.joined",
      payload: {
        member: {
          id: "member-2",
          userId: "guest-user",
          displayName: "Grace",
          image: "https://example.test/grace.png",
          isHost: false,
          joinedAt: "2026-06-20T00:00:00.000Z",
        },
      },
    });
  });

  it("lets the host move the session into swiping once and emits session.started", async () => {
    const repo = new FakeSessionRepo();
    repo.sessions.set("session-1", { id: "session-1", joinCode: "ABCD12", status: "lobby", hostUserId: "host-user" });
    repo.members.push({
      id: "member-1",
      sessionId: "session-1",
      userId: "host-user",
      displayName: "Ada",
      isHost: true,
      joinedAt: "2026-06-20T00:00:00.000Z",
    });

    await expect(startSwiping({ repo }, "session-1", "host-user")).resolves.toEqual({ status: "swiping" });
    await expect(startSwiping({ repo }, "session-1", "host-user")).resolves.toEqual({ status: "swiping" });

    expect(repo.transactionWrites).toEqual(["startSwiping:tx-1", "outbox:tx-1"]);
    expect(repo.outbox).toEqual([
      {
        aggregate: "session",
        aggregateId: "session-1",
        type: "session.started",
        payload: {},
      },
    ]);
  });
});
