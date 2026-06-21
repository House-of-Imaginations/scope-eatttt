import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("loads required URLs, providers, auth settings, and pinned defaults", () => {
    expect(
      parseEnv({
        DATABASE_URL: "postgres://app:app@localhost:6432/app",
        DATABASE_DIRECT_URL: "postgres://app:app@localhost:5432/app",
        REDIS_URL: "redis://localhost:6379",
        BETTER_AUTH_SECRET: "secret",
        BETTER_AUTH_URL: "http://localhost:5173",
      }),
    ).toMatchObject({
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
    });
  });

  it("accepts explicit provider and numeric overrides", () => {
    expect(
      parseEnv({
        DATABASE_URL: "postgres://app:app@localhost:6432/app",
        DATABASE_DIRECT_URL: "postgres://app:app@localhost:5432/app",
        REDIS_URL: "redis://localhost:6379",
        BETTER_AUTH_SECRET: "secret",
        BETTER_AUTH_URL: "http://localhost:5173",
        PLACES_PROVIDER: "google",
        OCR_PROVIDER: "mindee",
        GOOGLE_MAPS_API_KEY: "maps-key",
        GOOGLE_CLIENT_ID: "google-client-id",
        GOOGLE_CLIENT_SECRET: "google-client-secret",
        PROMOTE_THRESHOLD: "3",
        RADIUS_CAP_M: "4500",
      }),
    ).toMatchObject({
      PLACES_PROVIDER: "google",
      OCR_PROVIDER: "mindee",
      GOOGLE_MAPS_API_KEY: "maps-key",
      GOOGLE_CLIENT_ID: "google-client-id",
      GOOGLE_CLIENT_SECRET: "google-client-secret",
      PROMOTE_THRESHOLD: 3,
      RADIUS_CAP_M: 4500,
    });
  });

  it("treats empty strings as undefined before applying defaults", () => {
    expect(
      parseEnv({
        DATABASE_URL: "postgres://app:app@localhost:6432/app",
        DATABASE_DIRECT_URL: "postgres://app:app@localhost:5432/app",
        REDIS_URL: "redis://localhost:6379",
        BETTER_AUTH_SECRET: "secret",
        BETTER_AUTH_URL: "http://localhost:5173",
        GOOGLE_MAPS_API_KEY: "",
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
        PROMOTE_THRESHOLD: "",
      }),
    ).toMatchObject({
      GOOGLE_MAPS_API_KEY: undefined,
      GOOGLE_CLIENT_ID: undefined,
      GOOGLE_CLIENT_SECRET: undefined,
      PROMOTE_THRESHOLD: 2,
    });
  });

  it("throws on missing required variables", () => {
    expect(() => parseEnv({})).toThrow();
  });
});
