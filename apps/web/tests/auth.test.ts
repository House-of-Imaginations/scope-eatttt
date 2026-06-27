import { describe, expect, it, vi } from "vitest";
import { memoryAdapter } from "better-auth/adapters/memory";
import { BetterAuthProvider, RedisSecondaryStorage } from "@scope/adapters";
import { createAuth, createAuthOptionsFromEnv } from "../src/lib/server/auth";

describe("web auth", () => {
  it("configures anonymous sign-in and maps the session user", async () => {
    const auth = createAuth({
      database: memoryAdapter({}),
      secret: "test-secret-at-least-32-characters",
      baseURL: "http://localhost:5173",
    });

    const response = await auth.api.signInAnonymous({ headers: new Headers() });

    expect(response.user.isAnonymous).toBe(true);
    expect(response.user.id).toBeTruthy();
  });

  it("maps Better Auth sessions to core auth users", async () => {
    const provider = new BetterAuthProvider({
      api: {
        getSession: async () => ({
          user: { id: "u1", displayName: "Ada", email: "ada@example.com", isAnonymous: true },
          session: { id: "s1" },
        }),
      },
    });

    await expect(provider.getUser(new Headers())).resolves.toEqual({
      id: "u1",
      displayName: "Ada",
      email: "ada@example.com",
      image: null,
      isAnonymous: true,
    });
  });

  it("loads optional Google OAuth settings from the validated env", () => {
    expect(
      createAuthOptionsFromEnv(
        {
          DATABASE_URL: "postgres://app:app@localhost:6432/app",
          DATABASE_DIRECT_URL: "postgres://app:app@localhost:5432/app",
          REDIS_URL: "redis://localhost:6379",
          PLACES_PROVIDER: "fake",
          OCR_PROVIDER: "fake",
          BETTER_AUTH_SECRET: "secret",
          BETTER_AUTH_URL: "http://localhost:5173",
          PROMOTE_THRESHOLD: 2,
          REJECT_STREAK: 5,
          RADIUS_BASE_M: 500,
          RADIUS_STEP_M: 500,
          RADIUS_CAP_M: 3000,
          POLL_TIMER_MS: 300000,
          PLACES_CACHE_TTL_S: 1800,
          GOOGLE_CLIENT_ID: "google-client-id",
          GOOGLE_CLIENT_SECRET: "google-client-secret",
        },
        memoryAdapter({}),
      ).google,
    ).toEqual({ clientId: "google-client-id", clientSecret: "google-client-secret" });
  });

  it("configures Better Auth rate limits against secondary storage", () => {
    const secondaryStorage = new RedisSecondaryStorage({
      get: async () => null,
      set: async () => {},
      del: async () => {},
      incr: async () => 1,
      expire: async () => {},
    });

    const options = createAuthOptionsFromEnv(
      {
        DATABASE_URL: "postgres://app:app@localhost:6432/app",
        DATABASE_DIRECT_URL: "postgres://app:app@localhost:5432/app",
        REDIS_URL: "redis://localhost:6379",
        PLACES_PROVIDER: "fake",
        OCR_PROVIDER: "fake",
        BETTER_AUTH_SECRET: "secret",
        BETTER_AUTH_URL: "http://localhost:5173",
        PROMOTE_THRESHOLD: 2,
        REJECT_STREAK: 5,
        RADIUS_BASE_M: 500,
        RADIUS_STEP_M: 500,
        RADIUS_CAP_M: 3000,
        POLL_TIMER_MS: 300000,
        PLACES_CACHE_TTL_S: 1800,
        RATE_LIMIT_ENABLED: true,
        TRUSTED_IP_HEADER: "x-real-ip",
      },
      memoryAdapter({}),
      undefined,
      secondaryStorage,
    );

    expect(options.secondaryStorage).toBe(secondaryStorage);
    expect(options.rateLimit).toMatchObject({
      enabled: true,
      window: 60,
      max: 100,
      storage: "secondary-storage",
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 10 },
        "/sign-in/anonymous": { window: 60, max: 10 },
        "/get-session": false,
      },
    });
    expect(options.advanced).toMatchObject({ ipAddress: { ipAddressHeaders: ["x-real-ip"] } });
  });

  it("defaults rate-limit IP resolution to one trusted proxy header", () => {
    const secondaryStorage = new RedisSecondaryStorage({
      get: async () => null,
      set: async () => {},
      del: async () => {},
      incr: async () => 1,
      expire: async () => {},
    });

    const options = createAuthOptionsFromEnv(
      {
        DATABASE_URL: "postgres://app:app@localhost:6432/app",
        DATABASE_DIRECT_URL: "postgres://app:app@localhost:5432/app",
        REDIS_URL: "redis://localhost:6379",
        PLACES_PROVIDER: "fake",
        OCR_PROVIDER: "fake",
        BETTER_AUTH_SECRET: "secret",
        BETTER_AUTH_URL: "http://localhost:5173",
        PROMOTE_THRESHOLD: 2,
        REJECT_STREAK: 5,
        RADIUS_BASE_M: 500,
        RADIUS_STEP_M: 500,
        RADIUS_CAP_M: 3000,
        POLL_TIMER_MS: 300000,
        PLACES_CACHE_TTL_S: 1800,
        RATE_LIMIT_ENABLED: true,
      },
      memoryAdapter({}),
      undefined,
      secondaryStorage,
    );

    expect(options.advanced).toMatchObject({ ipAddress: { ipAddressHeaders: ["x-real-ip"] } });
  });

  it("calls the anonymous-link migration hook with both user ids", async () => {
    const onLinkAnonymousAccount = vi.fn();
    const auth = createAuth({
      database: memoryAdapter({}),
      secret: "test-secret-at-least-32-characters",
      baseURL: "http://localhost:5173",
      onLinkAnonymousAccount,
    });
    const linkAccount = auth.options.plugins?.[0]?.options?.onLinkAccount as
      | ((input: { anonymousUser: { user: { id: string } }; newUser: { user: { id: string } } }) => Promise<void>)
      | undefined;

    await linkAccount?.({
      anonymousUser: { user: { id: "anon-user" } },
      newUser: { user: { id: "real-user" } },
    });

    expect(onLinkAnonymousAccount).toHaveBeenCalledWith({
      anonymousUserId: "anon-user",
      newUserId: "real-user",
    });
  });
});
