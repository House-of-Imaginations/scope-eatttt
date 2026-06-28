import { getContainer } from "$lib/server/container";
import type { PageServerLoad } from "./$types";
import { loadHistory } from "./load";

// Direct domain call — no oRPC round-trip to our own server. Reads locals.user
// (set in hooks.server.ts from Better Auth) and runs the same listHistory query
// the dashboard.history handler uses. Dates are already ISO strings per the
// contract schema, so the return serializes plainly.
export const load: PageServerLoad = async ({ locals }) => {
  return loadHistory(locals.user, getContainer().repo);
};
