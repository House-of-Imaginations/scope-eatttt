import { redirect } from "@sveltejs/kit";
import { listHistory, type DashboardDeps } from "@scope/core";
import type { DashboardHistoryItem } from "@scope/contract";

// Minimal shape of locals.user we branch on (the rest is irrelevant here).
interface MaybeUser {
  id: string;
  isAnonymous?: boolean | null;
}

function requireRealUser(user: unknown): MaybeUser {
  const u = user as MaybeUser | null;
  // ponytail: guard mirrors the oRPC dashboard.history handler — logged-out OR
  // anonymous both bounce to /login, since history is real-account only.
  if (!u || u.isAnonymous) {
    throw redirect(302, "/login?redirect=/dashboard");
  }
  return u;
}

export async function loadHistory<Tx>(
  user: unknown,
  repo: DashboardDeps<Tx>["repo"],
): Promise<{ items: DashboardHistoryItem[] }> {
  const real = requireRealUser(user);
  return { items: await listHistory({ repo }, real.id) };
}
