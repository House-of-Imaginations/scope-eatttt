import type { VoteInput } from "@scope/contract";
import type { JobQueue } from "../ports/queue";
import type { OutboxWrite, TransactionContext } from "../ports/repo";
import { NotHostError } from "../index";

export interface CandidateTally {
  id: string;
  net: number;
  promotedAt: string;
}

export interface Tally {
  up: number;
  down: number;
  net: number;
}

export interface PollRepo<Tx = TransactionContext> {
  withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  isHost(tx: Tx, sessionId: string, userId: string): Promise<boolean>;
  startPoll(tx: Tx, sessionId: string, deadlineAt: string): Promise<void>;
  upsertVote(tx: Tx, input: { sessionId: string; candidateId: string; userId: string; memberId: string; value: 1 | -1 }): Promise<void>;
  candidateBelongsToSession(tx: Tx, sessionId: string, candidateId: string): Promise<boolean>;
  tally(tx: Tx, candidateId: string): Promise<Tally>;
  listCandidatesWithTally(tx: Tx, sessionId: string): Promise<CandidateTally[]>;
  closePoll(tx: Tx, sessionId: string, winnerCandidateId: string): Promise<boolean>;
  insertOutbox(tx: Tx, event: OutboxWrite): Promise<string>;
}

export interface StartPollDeps<Tx = TransactionContext> {
  repo: PollRepo<Tx>;
  queue: JobQueue;
  timerMs: number;
  now: () => string;
}

export interface PollDeps<Tx = TransactionContext> {
  repo: PollRepo<Tx>;
}

export function computeWinner(candidates: CandidateTally[]): string {
  const winner = [...candidates].sort(compareCandidateTallies)[0];
  if (!winner) {
    throw new Error("Cannot compute winner without candidates");
  }
  return winner.id;
}

export async function startPoll<Tx>(
  deps: StartPollDeps<Tx>,
  sessionId: string,
  hostUserId: string,
): Promise<{ deadlineAt: string }> {
  const openedAt = new Date(deps.now());
  const deadlineAt = new Date(openedAt.getTime() + deps.timerMs).toISOString();

  await deps.repo.withTx(async (tx) => {
    await assertHost(deps.repo, tx, sessionId, hostUserId);
    await deps.repo.startPoll(tx, sessionId, deadlineAt);
    await deps.repo.insertOutbox(tx, pollOpenedEvent(sessionId, deadlineAt));
  });
  // BullMQ rejects custom job IDs containing ':' (Job.validateOptions throws
  // "Custom Id cannot contain :"). Use a hyphen — same constraint that bit
  // places-fetch. Without this, the poll commits but enqueue throws → client 500.
  await deps.queue.enqueue("poll.close", { sessionId }, { delayMs: deps.timerMs, jobId: `poll-close-${sessionId}` });

  return { deadlineAt };
}

export async function castVote<Tx>(
  deps: PollDeps<Tx>,
  input: VoteInput,
  userId: string,
  memberId = userId,
): Promise<Tally> {
  return deps.repo.withTx(async (tx) => {
    if (!(await deps.repo.candidateBelongsToSession(tx, input.sessionId, input.candidateId))) {
      throw new Error("Candidate does not belong to this session");
    }
    await deps.repo.upsertVote(tx, { ...input, userId, memberId });
    const tally = await deps.repo.tally(tx, input.candidateId);
    await deps.repo.insertOutbox(tx, voteCastEvent(input.sessionId, input.candidateId, userId, input.value, tally));
    return tally;
  });
}

export async function closePoll<Tx>(
  deps: PollDeps<Tx>,
  sessionId: string,
  hostUserId?: string,
): Promise<{ closed: boolean; winnerCandidateId: string }> {
  return deps.repo.withTx(async (tx) => {
    if (hostUserId !== undefined) {
      await assertHost(deps.repo, tx, sessionId, hostUserId);
    }
    const candidates = await deps.repo.listCandidatesWithTally(tx, sessionId);
    const winnerCandidateId = computeWinner(candidates);
    const closed = await deps.repo.closePoll(tx, sessionId, winnerCandidateId);
    if (closed) {
      await deps.repo.insertOutbox(tx, pollClosedEvent(sessionId, winnerCandidateId));
    }
    return { closed, winnerCandidateId };
  });
}

async function assertHost<Tx>(repo: PollRepo<Tx>, tx: Tx, sessionId: string, userId: string): Promise<void> {
  if (!(await repo.isHost(tx, sessionId, userId))) {
    throw new NotHostError();
  }
}

function compareCandidateTallies(left: CandidateTally, right: CandidateTally): number {
  const netScoreOrder = right.net - left.net;
  if (netScoreOrder !== 0) {
    return netScoreOrder;
  }

  return left.promotedAt.localeCompare(right.promotedAt);
}

function sessionOutboxEvent(type: OutboxWrite["type"], aggregateId: string, payload: unknown): OutboxWrite {
  return {
    aggregate: "session",
    aggregateId,
    type,
    payload,
  };
}

function pollOpenedEvent(sessionId: string, deadlineAt: string): OutboxWrite {
  return sessionOutboxEvent("poll.opened", sessionId, { deadlineAt });
}

function voteCastEvent(sessionId: string, candidateId: string, userId: string, value: 1 | -1, tally: Tally): OutboxWrite {
  return sessionOutboxEvent("vote.cast", sessionId, {
    candidateId,
    userId,
    value,
    tally: {
      upvotes: tally.up,
      downvotes: tally.down,
      netScore: tally.net,
    },
  });
}

function pollClosedEvent(sessionId: string, winnerCandidateId: string): OutboxWrite {
  return sessionOutboxEvent("poll.closed", sessionId, { winnerCandidateId });
}
