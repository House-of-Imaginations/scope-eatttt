import type { DashboardHistoryItem } from "@scope/contract";
import { type DashboardDeps, listHistory } from "@scope/core";
import { requireRealUser } from "./_guard.js";

export async function loadHistory<Tx>(
  user: unknown,
  repo: DashboardDeps<Tx>["repo"],
): Promise<{ items: DashboardHistoryItem[] }> {
  const real = requireRealUser(user);
  return { items: await listHistory({ repo }, real.id) };
}
