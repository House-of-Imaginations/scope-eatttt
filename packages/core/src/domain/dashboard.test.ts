import type { DashboardHistoryItem, DashboardSessionSummary } from "@scope/contract";
import { describe, expect, it } from "vitest";
import type { SessionRepo, TransactionContext } from "../ports/repo";
import { getSessionSummary, listHistory } from "./dashboard";

class FakeDashboardRepo
  implements
    Pick<SessionRepo<TransactionContext>, "withTx" | "listSessionsForUser" | "getSessionSummary">
{
  history: DashboardHistoryItem[] = [];
  summary: DashboardSessionSummary | null = null;
  calls: string[] = [];

  async withTx<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return fn({ txId: "tx-1" });
  }

  async listSessionsForUser(
    tx: TransactionContext,
    userId: string,
  ): Promise<DashboardHistoryItem[]> {
    this.calls.push(`history:${tx.txId}:${userId}`);
    return this.history;
  }

  async getSessionSummary(
    tx: TransactionContext,
    sessionId: string,
    userId: string,
  ): Promise<DashboardSessionSummary | null> {
    this.calls.push(`summary:${tx.txId}:${sessionId}:${userId}`);
    return this.summary;
  }
}

describe("dashboard queries", () => {
  it("lists history for the current user inside the repo transaction", async () => {
    const repo = new FakeDashboardRepo();
    repo.history = [
      {
        id: crypto.randomUUID(),
        title: "Friday lunch",
        joinCode: "JOIN01",
        status: "decided",
        createdAt: "2026-06-20T00:00:00.000Z",
        winnerName: "Noodle House",
      },
    ];

    await expect(listHistory({ repo }, "user-1")).resolves.toEqual(repo.history);
    expect(repo.calls).toEqual(["history:tx-1:user-1"]);
  });

  it("returns a member-gated session summary or null", async () => {
    const repo = new FakeDashboardRepo();
    repo.summary = {
      id: crypto.randomUUID(),
      title: null,
      joinCode: "JOIN01",
      status: "polling",
      winnerName: null,
      candidates: [],
      members: [],
    };

    await expect(getSessionSummary({ repo }, repo.summary.id, "user-1")).resolves.toEqual(
      repo.summary,
    );
    repo.summary = null;
    await expect(getSessionSummary({ repo }, crypto.randomUUID(), "user-1")).resolves.toBeNull();
  });
});
