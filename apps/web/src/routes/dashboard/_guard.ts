import { redirect } from "@sveltejs/kit";

// Minimal shape of locals.user we branch on (the rest is irrelevant here).
export interface MaybeUser {
  id: string;
  isAnonymous?: boolean | null;
}

// ponytail: guard mirrors the oRPC dashboard.history handler — logged-out OR
// anonymous both bounce to /login, since history is real-account only.
export function requireRealUser(user: unknown): MaybeUser {
  const u = user as MaybeUser | null;
  if (!u || u.isAnonymous) {
    throw redirect(302, "/login?redirect=/dashboard");
  }
  return u;
}
