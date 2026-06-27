import { building } from "$app/environment";
import type { Handle } from "@sveltejs/kit";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { configureBackendLogging } from "@scope/logging";
import { getAuth } from "$lib/server/auth";
import { ensureRelayStarted } from "$lib/server/relayRuntime";

configureBackendLogging({ service: "web" });

export const handle: Handle = async ({ event, resolve }) => {
  ensureRelayStarted();

  const auth = getAuth();
  const session = await auth.api.getSession({
    headers: event.request.headers,
  });

  event.locals.session = session?.session ?? null;
  event.locals.user = session?.user ?? null;

  return svelteKitHandler({ event, resolve, auth, building });
};
