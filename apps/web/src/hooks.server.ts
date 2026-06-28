import { building } from "$app/environment";
import type { Handle } from "@sveltejs/kit";
import { svelteKitHandler } from "better-auth/svelte-kit";
import { configureBackendLogging } from "@scope/logging";
import { getAuth } from "$lib/server/auth";
import { ensureRelayStarted } from "$lib/server/relayRuntime";
import { getContainer } from "$lib/server/container";
import { checkRateLimit } from "$lib/server/rateLimit";
import { RedisCache } from "@scope/adapters";
import { loadEnv } from "@scope/config";

configureBackendLogging({ service: "web" });

export const handle: Handle = async ({ event, resolve }) => {
  ensureRelayStarted();

  const env = loadEnv();
  if (env.RATE_LIMIT_ENABLED) {
    const path = event.url.pathname;
    // ponytail: skip SSE path — long-lived stream, rate-limiting kills live updates.
    if (!/^\/api\/sessions\/[^/]+\/events/.test(path)) {
      const header = env.TRUSTED_IP_HEADER;
      // ponytail: read single trusted header value, no comma-split — don't trust raw x-forwarded-for chains.
      const ip =
        (header ? event.request.headers.get(header) : null) ??
        event.getClientAddress();
      const redis = (getContainer().cache as RedisCache).rateLimitClient;
      const { ok, retryAfter } = await checkRateLimit(redis, ip, 300, 60);
      if (!ok) {
        return new Response("Too Many Requests", {
          status: 429,
          headers: { "Retry-After": String(retryAfter) },
        });
      }
    }
  }

  const auth = getAuth();
  const session = await auth.api.getSession({
    headers: event.request.headers,
  });

  event.locals.session = session?.session ?? null;
  event.locals.user = session?.user ?? null;

  return svelteKitHandler({ event, resolve, auth, building });
};
