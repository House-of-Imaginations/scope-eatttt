import { listHistory, type DashboardDeps } from "@scope/core";
import type { DashboardHistoryItem } from "@scope/contract";
import { requireRealUser } from "./_guard.js";

export async function loadHistory<Tx>(
  user: unknown,
  repo: DashboardDeps<Tx>["repo"],
): Promise<{ items: DashboardHistoryItem[] }> {
  const real = requireRealUser(user);
  return { items: await listHistory({ repo }, real.id) };
}
