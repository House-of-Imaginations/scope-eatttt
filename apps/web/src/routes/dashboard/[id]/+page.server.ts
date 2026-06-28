import type { PageServerLoad } from "./$types";
import { getContainer } from "$lib/server/container";
import { loadSummary } from "./load";

export const load: PageServerLoad = async ({ locals, params }) => {
  return loadSummary(locals.user, getContainer().repo, params.id);
};
