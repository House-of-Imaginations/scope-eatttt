import type { DashboardHistoryItem, DashboardSessionSummary } from "@scope/contract";
import type { SessionRepo, TransactionContext } from "../ports/repo";

export interface DashboardDeps<Tx = TransactionContext> {
  repo: Pick<SessionRepo<Tx>, "withTx" | "listSessionsForUser" | "getSessionSummary">;
}

export function listHistory<Tx>(deps: DashboardDeps<Tx>, userId: string): Promise<DashboardHistoryItem[]> {
  return deps.repo.withTx((tx) => deps.repo.listSessionsForUser(tx, userId));
}

export function getSessionSummary<Tx>(deps: DashboardDeps<Tx>, sessionId: string, userId: string): Promise<DashboardSessionSummary | null> {
  return deps.repo.withTx((tx) => deps.repo.getSessionSummary(tx, sessionId, userId));
}
