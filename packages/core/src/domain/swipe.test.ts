import type { Restaurant } from "@scope/contract";
import { describe, expect, it } from "vitest";
import { decideSwipe, evaluateRadius } from "./swipe";
import type { OutboxWrite, TransactionContext } from "../ports/repo";
import type { StreakStore } from "../ports/streak";

const restaurant: Restaurant = {
  id: "place-1",
  name: "Noodle House",
  address: "1 Main St",
  cuisineTags: ["thai"],
};

class FakeSwipeRepo {
  accepts = 0;
  candidate = false;
  outbox: OutboxWrite[] = [];
  writes: string[] = [];

  async withTx<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return fn({ txId: "tx-1" });
  }

  async recordSwipe(tx: TransactionContext) {
    this.writes.push(`swipe:${tx.txId}`);
    return { created: true };
  }

  async countAccepts() {
    return this.accepts;
  }

  async isCandidate() {
    return this.candidate;
  }

  async addCandidate(tx: TransactionContext) {
    this.writes.push(`candidate:${tx.txId}`);
    this.candidate = true;
    return { candidateId: "candidate-1" };
  }

  async updateMemberRadius(tx: TransactionContext, _sessionId: string, _userId: string, radiusM: number) {
    this.writes.push(`radius:${tx.txId}:${radiusM}`);
  }

  async insertOutbox(tx: TransactionContext, event: OutboxWrite) {
    this.writes.push(`outbox:${tx.txId}`);
    this.outbox.push(event);
    return "event-1";
  }
}

class FakeStreakStore implements StreakStore {
  streak = 0;

  async incr() {
    this.streak += 1;
    return this.streak;
  }

  async reset() {
    this.streak = 0;
  }

  async get() {
    return this.streak;
  }
}

describe("evaluateRadius", () => {
  it("broadens after reject streak or empty deck and caps the radius", () => {
    expect(evaluateRadius(5, 3, { radiusM: 500 }, { rejectStreak: 5, stepM: 500, capM: 3000 })).toEqual({
      broaden: true,
      newRadiusM: 1000,
    });
    expect(evaluateRadius(1, 0, { radiusM: 2800 }, { rejectStreak: 5, stepM: 500, capM: 3000 })).toEqual({
      broaden: true,
      newRadiusM: 3000,
    });
  });
});

describe("decideSwipe", () => {
  it("promotes once threshold accepts are reached and writes restaurant.promoted outbox in the same tx", async () => {
    const repo = new FakeSwipeRepo();
    repo.accepts = 2;
    const streak = new FakeStreakStore();

    const result = await decideSwipe(
      { repo, streak, promoteThreshold: 2, now: () => "2026-06-20T00:00:00.000Z" },
      { sessionId: "session-1", restaurantId: restaurant.id, decision: "accept", restaurant },
      "user-1",
    );

    expect(result).toEqual({ promoted: true, candidateId: "candidate-1" });
    expect(streak.streak).toBe(0);
    expect(repo.writes).toEqual(["swipe:tx-1", "candidate:tx-1", "outbox:tx-1"]);
    expect(repo.outbox[0]).toMatchObject({
      aggregate: "session",
      aggregateId: "session-1",
      type: "restaurant.promoted",
      payload: { candidateId: "candidate-1", restaurant },
    });
  });

  it("increments reject streak and prompts radius broaden when the threshold is reached", async () => {
    const repo = new FakeSwipeRepo();
    const streak = new FakeStreakStore();
    streak.streak = 4;

    const result = await decideSwipe(
      {
        repo,
        streak,
        promoteThreshold: 2,
        radius: { rejectStreak: 5, stepM: 500, capM: 3000 },
        now: () => "2026-06-20T00:00:00.000Z",
      },
      { sessionId: "session-1", restaurantId: restaurant.id, decision: "reject", restaurant, memberRadiusM: 500, deckLeft: 3 },
      "user-1",
    );

    expect(result).toEqual({ promoted: false, broaden: true, newRadiusM: 1000 });
    expect(repo.writes).toEqual(["swipe:tx-1", "radius:tx-1:1000", "outbox:tx-1"]);
    expect(repo.outbox[0]).toMatchObject({
      type: "prompt.broaden",
      payload: { userId: "user-1", nextRadiusM: 1000 },
    });
  });
});
