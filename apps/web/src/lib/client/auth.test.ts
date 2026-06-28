/**
 * Unit tests for ensureAnonSession() retry behaviour.
 *
 * ponytail: vi.stubGlobal for fetch, reset between tests, no helper abstractions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// $env/static/public must resolve before the module under test is imported.
// The sveltekit() vitest plugin handles resolution; we just mock the value here
// so parsePublicEnv sees PUBLIC_USE_MOCK=0 (real-mode).
vi.mock("$env/static/public", () => ({ PUBLIC_USE_MOCK: "0" }));

// Import AFTER mocking the env — module is evaluated once, so env mock must be
// in place before the module initialises USE_MOCK.
const { ensureAnonSession } = await import("./auth");

// Helper: build a minimal ok-looking get-session Response with a session object.
function sessionOk() {
  return new Response(JSON.stringify({ session: { id: "s1" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Helper: build a get-session Response where no session is present (returns null body).
function noSession() {
  return new Response(JSON.stringify(null), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Helper: a successful anonymous sign-in Response.
function signInOk() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// ponytail: ensureAnonSession clears its in-flight ref in finally, so each test
// that lets its promise settle starts clean — no module reload needed.

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ensureAnonSession", () => {
  beforeEach(() => {
    // Speed up the retry backoff — replace setTimeout so tests don't actually
    // wait 300 ms per retry.
    vi.useFakeTimers();
  });

  it("resolves without throwing when the first fetch throws but the second succeeds (transient failure)", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string) => {
        callCount++;
        if (callCount === 1) {
          // First call: transient fetch error — simulates cold-start network blip.
          throw new TypeError("Failed to fetch");
        }
        // Second call: get-session succeeds and returns an existing session.
        return sessionOk();
      }),
    );

    const promise = ensureAnonSession();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();

    // Two fetches total: the thrown get-session + its retry. The retry returned a
    // session, so the anonymous sign-in POST is never reached (callCount stays 2).
    expect(callCount).toBe(2);
  });

  it("signs in anonymously when get-session returns no session", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return url.includes("sign-in") ? signInOk() : noSession();
      }),
    );

    const promise = ensureAnonSession();
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();

    // get-session (no session) → anonymous sign-in POST, in that order.
    expect(urls).toEqual(["/api/auth/get-session", "/api/auth/sign-in/anonymous"]);
  });

  it("resolves (does not reject) when fetch always throws — exhausts retries gracefully", async () => {
    let callCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount++;
        throw new TypeError("Failed to fetch");
      }),
    );

    const promise = ensureAnonSession();
    await vi.runAllTimersAsync();
    // Must NOT reject — bootstrap crash is the bug we are fixing.
    await expect(promise).resolves.toBeUndefined();

    // Should have retried at most 3 times (MAX_ATTEMPTS = 3) before giving up.
    expect(callCount).toBeLessThanOrEqual(3);
    expect(callCount).toBeGreaterThanOrEqual(1);
  });
});
