import { closePoll, type PollRepo, type SessionSummary, type TransactionContext } from "@scope/core";

export interface PollCloseJobData {
  sessionId: string;
}

export interface PollCloseRepo<Tx = TransactionContext> extends PollRepo<Tx> {
  getSession(tx: Tx, sessionId: string): Promise<SessionSummary | null>;
}

export interface PollCloseDeps<Tx = TransactionContext> {
  repo: PollCloseRepo<Tx>;
}

export type PollCloseJobResult =
  | { closed: true; winnerCandidateId: string }
  | { closed: false; reason: "not-found" | "already-decided" };

export async function runPollCloseJob<Tx>(
  deps: PollCloseDeps<Tx>,
  data: PollCloseJobData,
): Promise<PollCloseJobResult> {
  const session = await deps.repo.withTx((tx) => deps.repo.getSession(tx, data.sessionId));
  if (!session) {
    return { closed: false, reason: "not-found" };
  }
  if (isClosedPollStatus(session.status)) {
    return { closed: false, reason: "already-decided" };
  }

  const result = await closePoll({ repo: deps.repo }, data.sessionId);
  if (!result.closed) {
    return { closed: false, reason: "already-decided" };
  }
  return { closed: true, winnerCandidateId: result.winnerCandidateId };
}

function isClosedPollStatus(status: SessionSummary["status"]): boolean {
  return status === "decided" || status === "closed";
}
