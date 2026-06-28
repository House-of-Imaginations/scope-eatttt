/**
 * Playwright config for the REAL multi-client E2E suite (Task F1.6).
 *
 * Differences from playwright.config.ts (mock mode):
 *   - PUBLIC_USE_MOCK=0  → real oRPC, real SSE, real Postgres + Redis
 *   - webServer reuseExistingServer=false → always spawns a fresh dev server
 *     that loads root .env via `pnpm with-env` (same as `pnpm dev`), then
 *     overrides PUBLIC_USE_MOCK to 0 via process.env.
 *
 * Prerequisites before running:
 *   1. docker compose up -d          (Postgres, PgBouncer, Redis — already up)
 *   2. pnpm --filter worker dev &    (BullMQ worker for places.fetch jobs)
 *      OR: pnpm --filter worker dev  in a separate terminal
 *
 * Run:
 *   pnpm --filter web exec playwright test -c playwright.real.config.ts e2e-real
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  // Real-mode E2E suites: the original realtime fanout flow plus the accounts /
  // dashboard / avatars / anon-link flow. Both need the same real stack + server.
  testMatch: ["**/e2e-real.spec.ts", "**/e2e-accounts.spec.ts"],
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://localhost:5174",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // `pnpm dev` already runs `pnpm with-env vite dev` which loads ../../.env.
    // We override PUBLIC_USE_MOCK=0 and bind to port 5174 (avoids clashing with
    // the mock dev server on 5173 if it happens to be running).
    command: "pnpm with-env vite dev --port 5174",
    url: "http://localhost:5174",
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      PUBLIC_USE_MOCK: "0",
      // Better Auth validates its baseURL against incoming request origins.
      // Override to match the port this dev server actually listens on.
      BETTER_AUTH_URL: "http://localhost:5174",
      // /login and /signup import PUBLIC_GOOGLE_ENABLED from $env/static/public.
      // Root .env doesn't define it, so without this the virtual module omits the
      // export and those pages 500. "0" = Google button hidden (email-only path,
      // which is all the accounts E2E exercises).
      PUBLIC_GOOGLE_ENABLED: "0",
    },
  },
});
