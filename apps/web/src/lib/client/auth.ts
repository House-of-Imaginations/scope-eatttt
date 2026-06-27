import { PUBLIC_USE_MOCK } from "$env/static/public";
import { parsePublicEnv } from "@scope/config";
import { getAppLogger } from "@scope/logging/browser";

// ponytail: plain fetch, no better-auth client lib, no abstraction layer.
const USE_MOCK = parsePublicEnv({ PUBLIC_USE_MOCK }).useMock;

// Guard against concurrent bootstrap calls — share a single in-flight promise.
let _inflight: Promise<void> | null = null;

// ponytail: small bounded retry for transient fetch failures (cold-start blip).
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 300;

/**
 * Ensure an anonymous Better Auth session exists for this browser context.
 *
 * Checks GET /api/auth/get-session first; if no session, calls
 * POST /api/auth/sign-in/anonymous. Both are same-origin fetches so the
 * browser sends and stores the HttpOnly session cookie automatically.
 *
 * Idempotent: safe to call on every page load — skips the sign-in POST when a
 * session is already present. Concurrent calls share the same in-flight promise.
 * Retries up to MAX_ATTEMPTS times on thrown fetch errors (e.g. "Failed to fetch"
 * on cold start) before logging once and resolving — bootstrap must never reject.
 *
 * No-op when PUBLIC_USE_MOCK=1 (mock transport needs no auth).
 */
export async function ensureAnonSession(): Promise<void> {
  if (USE_MOCK) return; // ponytail: skip entirely in mock mode

  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      let lastErr: unknown;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          // Check for an existing session first — avoids creating a new anon user on
          // every hard reload when the cookie is already set.
          const check = await fetch("/api/auth/get-session", {
            credentials: "include",
          });
          if (check.ok) {
            const data = await check.json().catch(() => null);
            if (data?.session) return; // already signed in
          }

          // No session — sign in anonymously.
          const resp = await fetch("/api/auth/sign-in/anonymous", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
            credentials: "include",
          });
          if (!resp.ok) {
            const body = await resp.text().catch(() => "");
            getAppLogger(["auth"]).error("Anonymous sign-in failed: HTTP {status} - {body}", {
              status: resp.status,
              body,
            });
          }
          return; // success — exit retry loop
        } catch (err) {
          lastErr = err;
          if (attempt < MAX_ATTEMPTS - 1) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          }
        }
      }
      // All retries exhausted — log once, resolve quietly so layout bootstrap never crashes.
      getAppLogger(["auth"]).error("ensureAnonSession failed after retries", { error: lastErr });
    } finally {
      // Clear the in-flight reference so subsequent calls (e.g. after a sign-out)
      // can attempt a fresh bootstrap.
      _inflight = null;
    }
  })();

  return _inflight;
}
