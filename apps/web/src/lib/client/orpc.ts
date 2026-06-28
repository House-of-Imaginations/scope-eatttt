import { PUBLIC_USE_MOCK } from "$env/static/public";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { parsePublicEnv } from "@scope/config";
import type { contract } from "@scope/contract";
import { ensureAnonSession } from "./auth";
import { makeMockApi } from "./mockHandler";

// Fully-typed client inferred from the oRPC contract. Each leaf becomes
// (input) => Promise<output> — do not hand-roll the mapped type (the contract's
// internal shape uses inputSchema/outputSchema, so a manual mapper resolves to never).
export type Api = ContractRouterClient<typeof contract>;

// PUBLIC_ flag (validated via @scope/config) switches real vs mock transport.
// Read via $env/static/public — SvelteKit does NOT expose PUBLIC_* on import.meta.env in the browser.
const USE_MOCK = parsePublicEnv({ PUBLIC_USE_MOCK }).useMock;

function buildRealClient(): Api {
  // @orpc/client calls new URL(url) internally — must be absolute.
  // In the browser, build from window.location.origin; in SSR (Node), use a
  // placeholder origin (the RPCLink is never called server-side).
  // ponytail: inline origin derivation, no abstraction.
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";

  // ponytail: fetch wrapper that awaits ensureAnonSession() before every RPC
  // request, killing the race between the layout onMount bootstrap and each
  // page's own onMount RPC calls. ensureAnonSession() is idempotent and shares
  // a single in-flight promise, so concurrent calls cost nothing extra.
  // No-op in mock mode because ensureAnonSession() returns immediately when
  // PUBLIC_USE_MOCK=1 — the wrapper is harmless in both modes.
  const authFetch: typeof fetch = async (input, init) => {
    await ensureAnonSession();
    return fetch(input, init);
  };

  const link = new RPCLink({ url: `${origin}/api/rpc`, fetch: authFetch });
  return createORPCClient(link);
}

export const api: Api = USE_MOCK ? (makeMockApi() as unknown as Api) : buildRealClient();
