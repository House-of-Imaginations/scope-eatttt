/**
 * Unit tests for authClient helpers.
 *
 * ponytail: vi.stubGlobal for fetch, reset between tests, no helper abstractions.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("$env/static/public", () => ({ PUBLIC_USE_MOCK: "0" }));

const { getCurrentUser, signInEmail, signUpEmail, signOut, signInGoogle } =
  await import("./authClient");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("signInEmail", () => {
  it("posts to /api/auth/sign-in/email with credentials:include and returns ok:true on 200", async () => {
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedInit = init;
        return new Response(JSON.stringify({ token: "t" }), { status: 200 });
      }),
    );

    const result = await signInEmail({ email: "a@b.com", password: "pass" });

    expect(result).toEqual({ ok: true });
    expect(capturedInit?.credentials).toBe("include");
  });

  it("returns ok:false with retryAfter when response is 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ message: "slow down" }), {
          status: 429,
          headers: { "X-Retry-After": "30" },
        }),
      ),
    );

    const result = await signInEmail({ email: "a@b.com", password: "pass" });

    expect(result).toEqual({ ok: false, error: "Too many attempts", retryAfter: 30 });
  });

  it("returns ok:false with message from JSON body on non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ message: "bad creds" }), { status: 401 }),
      ),
    );

    const result = await signInEmail({ email: "a@b.com", password: "pass" });

    expect(result).toEqual({ ok: false, error: "bad creds" });
  });

  it("falls back to 'Something went wrong' when error body has no message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 500 })),
    );

    const result = await signInEmail({ email: "a@b.com", password: "pass" });

    expect(result).toEqual({ ok: false, error: "Something went wrong" });
  });
});

describe("signUpEmail", () => {
  it("posts to /api/auth/sign-up/email and returns ok:true on 200", async () => {
    let capturedUrl: string | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ token: "t" }), { status: 200 });
      }),
    );

    const result = await signUpEmail({ name: "Al", email: "a@b.com", password: "pass" });

    expect(result).toEqual({ ok: true });
    expect(capturedUrl).toBe("/api/auth/sign-up/email");
  });
});

describe("getCurrentUser", () => {
  it("returns null when get-session body has no session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(null), { status: 200 }),
      ),
    );

    const user = await getCurrentUser();

    expect(user).toBeNull();
  });

  it("returns null when response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 })),
    );

    expect(await getCurrentUser()).toBeNull();
  });

  it("maps {user,session} shape to flat object with isAnonymous defaulting to false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            user: {
              id: "u1",
              name: "Al",
              email: "a@b.com",
              image: null,
            },
            session: { id: "s1" },
          }),
          { status: 200 },
        ),
      ),
    );

    const user = await getCurrentUser();

    expect(user).toEqual({ id: "u1", isAnonymous: false, name: "Al", email: "a@b.com", image: null });
  });

  it("maps isAnonymous:true when user.isAnonymous is true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            user: { id: "u2", name: "Guest", email: "", image: null, isAnonymous: true },
            session: { id: "s2" },
          }),
          { status: 200 },
        ),
      ),
    );

    const user = await getCurrentUser();

    expect(user?.isAnonymous).toBe(true);
  });
});

describe("signOut", () => {
  it("posts to /api/auth/sign-out with credentials:include", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return new Response("", { status: 200 });
      }),
    );

    await signOut();

    expect(capturedUrl).toBe("/api/auth/sign-out");
    expect(capturedInit?.credentials).toBe("include");
  });
});

describe("signInGoogle", () => {
  it("sets window.location.href to the social sign-in URL with encoded redirect", () => {
    // ponytail: stub globalThis.window.location — works in both jsdom and node.
    const loc = { href: "" };
    vi.stubGlobal("window", { location: loc });

    signInGoogle("/dashboard");

    expect(loc.href).toBe(
      "/api/auth/sign-in/social?provider=google&callbackURL=%2Fdashboard",
    );
  });
});
