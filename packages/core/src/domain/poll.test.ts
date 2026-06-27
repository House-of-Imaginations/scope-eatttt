import { describe, expect, it } from "vitest";
import { castVote, closePoll, computeWinner, startPoll } from "./poll";
import type { JobQueue } from "../ports/queue";
import type { OutboxWrite, TransactionContext } from "../ports/repo";

class FakePollRepo {
  outbox: OutboxWrite[] = [];
  writes: string[] = [];
  candidates = [
    { id: "a", net: 2, promotedAt: "2026-06-20T00:00:09.000Z" },
    { id: "b", net: 5, promotedAt: "2026-06-20T00:00:02.000Z" },
  ];

  async withTx<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return fn({ txId: "tx-1" });
  }

  async isHost() {
    return true;
  }

  async startPoll(tx: TransactionContext) {
    this.writes.push(`start:${tx.txId}`);
  }

  async upsertVote(tx: TransactionContext) {
    this.writes.push(`vote:${tx.txId}`);
  }

  async candidateBelongsToSession() {
    return true;
  }

  async tally() {
    return { up: 2, down: 1, net: 1 };
  }

  async listCandidatesWithTally() {
    return this.candidates;
  }

  async closePoll(tx: TransactionContext) {
    this.writes.push(`close:${tx.txId}`);
    return true;
  }

  async insertOutbox(tx: TransactionContext, event: OutboxWrite) {
    this.writes.push(`outbox:${tx.txId}`);
    this.outbox.push(event);
    return "event-1";
  }
}

class FakeQueue implements JobQueue {
  jobs: Array<{ name: string; data: unknown; opts?: { delayMs?: number; jobId?: string } }> = [];

  async enqueue(name: string, data: unknown, opts?: { delayMs?: number; jobId?: string }) {
    // Mirror BullMQ's real constraint so unit tests catch the colon bug that
    // only manifests against a live queue (Job.validateOptions: "Custom Id
    // cannot contain :"). Without this, a fake queue silently accepts an
    // invalid jobId and the 500 only surfaces in the real E2E.
    if (opts?.jobId?.includes(":")) {
      throw new Error("Custom Id cannot contain :");
    }
    this.jobs.push(opts === undefined ? { name, data } : { name, data, opts });
  }
}

describe("computeWinner", () => {
  it("picks max net score and breaks ties by earliest promotion", () => {
    expect(computeWinner([{ id: "a", net: 2, promotedAt: "9" }, { id: "b", net: 5, promotedAt: "2" }])).toBe("b");
    expect(computeWinner([{ id: "a", net: 3, promotedAt: "9" }, { id: "b", net: 3, promotedAt: "2" }])).toBe("b");
  });
});

describe("poll commands", () => {
  it("starts a host poll, emits poll.opened, and enqueues deterministic close job", async () => {
    const repo = new FakePollRepo();
    const queue = new FakeQueue();

    const result = await startPoll(
      { repo, queue, timerMs: 300000, now: () => "2026-06-20T00:00:00.000Z" },
      "session-1",
      "host-user",
    );

    expect(result).toEqual({ deadlineAt: "2026-06-20T00:05:00.000Z" });
    expect(repo.writes).toEqual(["start:tx-1", "outbox:tx-1"]);
    expect(repo.outbox[0]).toMatchObject({ type: "poll.opened", aggregateId: "session-1" });
    expect(queue.jobs).toEqual([
      { name: "poll.close", data: { sessionId: "session-1" }, opts: { delayMs: 300000, jobId: "poll-close-session-1" } },
    ]);
  });

  it("casts a vote, returns tally, and emits vote.cast", async () => {
    const repo = new FakePollRepo();

    const result = await castVote({ repo }, { sessionId: "session-1", candidateId: "candidate-1", value: 1 }, "user-1");

    expect(result).toEqual({ up: 2, down: 1, net: 1 });
    expect(repo.writes).toEqual(["vote:tx-1", "outbox:tx-1"]);
    expect(repo.outbox[0]).toMatchObject({
      type: "vote.cast",
      payload: {
        candidateId: "candidate-1",
        userId: "user-1",
        value: 1,
        tally: { upvotes: 2, downvotes: 1, netScore: 1 },
      },
    });
  });

  it("rejects votes for candidates outside the session", async () => {
    const repo = new FakePollRepo();
    repo.candidateBelongsToSession = async () => false;

    await expect(castVote({ repo }, { sessionId: "session-1", candidateId: "candidate-1", value: 1 }, "user-1")).rejects.toThrow(
      "Candidate does not belong to this session",
    );
    expect(repo.writes).toEqual([]);
  });

  it("closes a poll with computed winner and emits poll.closed", async () => {
    const repo = new FakePollRepo();

    const result = await closePoll({ repo }, "session-1");

    expect(result).toEqual({ closed: true, winnerCandidateId: "b" });
    expect(repo.writes).toEqual(["close:tx-1", "outbox:tx-1"]);
    expect(repo.outbox[0]).toMatchObject({ type: "poll.closed", payload: { winnerCandidateId: "b" } });
  });

  it("does not emit poll.closed when another closer already won", async () => {
    const repo = new FakePollRepo();
    repo.closePoll = async (tx: TransactionContext) => {
      repo.writes.push(`close:${tx.txId}`);
      return false;
    };

    const result = await closePoll({ repo }, "session-1");

    expect(result).toEqual({ closed: false, winnerCandidateId: "b" });
    expect(repo.writes).toEqual(["close:tx-1"]);
    expect(repo.outbox).toEqual([]);
  });

  it("requires the host when a manual close supplies a user id", async () => {
    const repo = new FakePollRepo();
    repo.isHost = async () => false;

    await expect(closePoll({ repo }, "session-1", "guest-user")).rejects.toThrow("Only the session host can perform this action");
    expect(repo.writes).toEqual([]);
  });
});
