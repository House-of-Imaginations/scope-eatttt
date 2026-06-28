import { redirect } from "@sveltejs/kit";
import { getSessionSummary, type DashboardDeps } from "@scope/core";
import type { DashboardSessionSummary } from "@scope/contract";

interface MaybeUser {
  id: string;
  isAnonymous?: boolean | null;
}

function requireRealUser(user: unknown): MaybeUser {
  const u = user as MaybeUser | null;
  if (!u || u.isAnonymous) {
    throw redirect(302, "/login?redirect=/dashboard");
  }
  return u;
}

export async function loadSummary<Tx>(
  user: unknown,
  repo: DashboardDeps<Tx>["repo"],
  sessionId: string,
): Promise<{ summary: DashboardSessionSummary | null }> {
  const real = requireRealUser(user);
  // null summary = not a member (or no such session). We pass it through as
  // { summary: null } rather than a 404, so the page can't be used to probe
  // which session ids exist.
  return { summary: await getSessionSummary({ repo }, sessionId, real.id) };
}
