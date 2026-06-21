/**
 * F1.6 — Real multi-client E2E: live promote → vote → winner fanout.
 *
 * Prerequisites (must be running before this suite):
 *   1. docker compose up -d             Postgres (5432), PgBouncer (6432), Redis (6379)
 *   2. pnpm --filter worker dev         BullMQ worker — processes places.fetch jobs
 *      (in a separate terminal, or background: pnpm --filter worker dev &)
 *   3. playwright.real.config.ts starts the web dev server automatically with
 *      PUBLIC_USE_MOCK=0 on port 5174.
 *
 * Anti-hack contract: zero stubs, zero fakes, zero injected events.
 * Two independent browser contexts = two distinct anonymous Better Auth sessions.
 * FakePlaces (PLACES_PROVIDER=fake in root .env) generates deterministic decks:
 *   fake-place-1, fake-place-2, … per cuisine.  Both members get the same IDs
 *   since they share the same session lat/lng/cuisines → the first card (fake-place-1)
 *   is the shared restaurant used to hit PROMOTE_THRESHOLD=2.
 *
 * Anonymous sign-in note: Better Auth requires the browser to call
 * POST /api/auth/sign-in/anonymous before any oRPC procedure (the server
 * reads event.locals.user from the auth session cookie). The app itself does
 * not yet auto-bootstrap anon sign-in in the UI — this is an intentional
 * integration gap that this E2E test exercises. We call the real auth endpoint
 * per context so the real auth cookie is set; the oRPC then sees a real user.
 *
 * Run:
 *   pnpm --filter web exec playwright test -c playwright.real.config.ts e2e-real
 */

import { test, expect, type Page } from "@playwright/test";

// Generous timeouts — the worker processes places.fetch async after session create.
const DECK_TIMEOUT = 30_000; // worker must fetch + cache places before swipe.deck
const SSE_TIMEOUT = 20_000;  // SSE fanout propagation across contexts
const NAV_TIMEOUT = 15_000;  // SvelteKit route transitions

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Call POST /api/auth/sign-in/anonymous to get a real anonymous session cookie
 * for this browser context. Better Auth sets a `Set-Cookie` header that
 * Playwright auto-stores — subsequent requests from this context carry it.
 */
async function signInAnonymous(page: Page): Promise<void> {
  const resp = await page.request.post("/api/auth/sign-in/anonymous", {
    data: {},
    headers: { "Content-Type": "application/json" },
  });
  if (!resp.ok()) {
    const body = await resp.text();
    throw new Error(`Anonymous sign-in failed: HTTP ${resp.status()} — ${body}`);
  }
}

/** Read the join code from the lobby page (data-testid="lobby-join-code"). */
async function readJoinCode(page: Page): Promise<string> {
  const el = page.getByTestId("lobby-join-code");
  await expect(el).toBeVisible({ timeout: NAV_TIMEOUT });
  const text = await el.textContent();
  if (!text?.trim()) throw new Error("lobby-join-code element is empty");
  return text.trim();
}

// ---------------------------------------------------------------------------
// The test
// ---------------------------------------------------------------------------

test.describe("Real multi-client E2E — live fanout over SSE", () => {
  test(
    "promote → vote → winner fanout across two independent browser contexts",
    async ({ browser }) => {
      // ── 1. Host context: anonymous sign-in then create session ──────────
      const hostCtx = await browser.newContext({
        geolocation: { latitude: -33.8688, longitude: 151.2093 },
        permissions: ["geolocation"],
      });
      const hostPage = await hostCtx.newPage();

      // Establish a real anonymous Better Auth session for the host context.
      // This sets the auth cookie so hooks.server.ts populates event.locals.user.
      await hostPage.goto("/");
      await signInAnonymous(hostPage);

      // Wait for geolocation to resolve so the form is submittable.
      await expect(hostPage.getByText(/location detected/i)).toBeVisible({ timeout: NAV_TIMEOUT });

      // Pick "Pizza" cuisine and create session.
      await hostPage.getByRole("button", { name: /pizza/i }).click();
      await hostPage.getByRole("button", { name: /start lunch/i }).click();

      // Land in lobby.
      await expect(hostPage).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: NAV_TIMEOUT });
      await expect(hostPage.getByRole("heading", { name: /lobby/i })).toBeVisible({ timeout: NAV_TIMEOUT });

      // Read the join code from the lobby.
      const joinCode = await readJoinCode(hostPage);
      expect(joinCode.length).toBeGreaterThan(0);

      // ── 2. Member context: anonymous sign-in then join via /join/<code> ──
      const memberCtx = await browser.newContext({
        geolocation: { latitude: -33.8688, longitude: 151.2093 },
        permissions: ["geolocation"],
      });
      const memberPage = await memberCtx.newPage();

      // Member must also get an anonymous session — different context = different user.
      await memberPage.goto("/");
      await signInAnonymous(memberPage);

      await memberPage.goto(`/join/${joinCode}`);
      await expect(memberPage.getByRole("heading", { name: /you're invited to lunch/i })).toBeVisible({ timeout: NAV_TIMEOUT });
      await memberPage.getByRole("textbox", { name: /display name/i }).fill("Grace");
      await memberPage.getByRole("button", { name: /join lunch/i }).click();

      // Member lands in the same session's lobby.
      await expect(memberPage).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: NAV_TIMEOUT });
      await expect(memberPage.getByRole("heading", { name: /lobby/i })).toBeVisible({ timeout: NAV_TIMEOUT });

      // Host sees the member appear live (member.joined SSE fanout).
      await expect(hostPage.getByText(/grace/i)).toBeVisible({ timeout: SSE_TIMEOUT });

      // ── 3. Both start swiping ────────────────────────────────────────────
      // Host clicks "Start swiping" (host control).
      await hostPage.getByRole("button", { name: /start swiping/i }).click();

      // Host waits for deck to load — worker must have processed places.fetch.
      await expect(hostPage.getByRole("button", { name: /^accept$/i })).toBeVisible({ timeout: DECK_TIMEOUT });

      // Member also starts swiping.
      await memberPage.getByRole("button", { name: /start swiping/i }).click();
      await expect(memberPage.getByRole("button", { name: /^accept$/i })).toBeVisible({ timeout: DECK_TIMEOUT });

      // ── 4. Both ACCEPT the same restaurant (fake-place-1) ───────────────
      // FakePlaces is deterministic: both decks start with fake-place-1 (first
      // card for any cuisine+session). Accepting it twice (from two distinct
      // Better Auth anonymous users) crosses PROMOTE_THRESHOLD=2 → promotion.

      // Verify both are on the same first card (same restaurant name).
      const hostCardName = await hostPage.getByTestId("swipe-card-name").textContent();
      const memberCardName = await memberPage.getByTestId("swipe-card-name").textContent();
      expect(hostCardName?.trim()).toBeTruthy();
      // Both decks start at the same place (FakePlaces deterministic by session).
      expect(hostCardName?.trim()).toEqual(memberCardName?.trim());

      // Host accepts first.
      await hostPage.getByRole("button", { name: /^accept$/i }).click();

      // Member accepts — this is the second accept on the same restaurant
      // → PROMOTE_THRESHOLD=2 hit → restaurant.promoted event fires.
      await memberPage.getByRole("button", { name: /^accept$/i }).click();

      // ── 5. Assert restaurant.promoted fanout ────────────────────────────
      // The swipe.decide response carries promoted=true for the second accepter.
      // The session screen calls flashPromoted() which sets the promote-toast.
      // We assert on the member side (member's click triggered promotion).
      await expect(memberPage.getByTestId("promote-toast")).toBeVisible({ timeout: SSE_TIMEOUT });

      // ── 6. Host opens the poll ───────────────────────────────────────────
      await hostPage.getByRole("button", { name: /open poll/i }).click();

      // Both contexts should transition to the polling screen (poll.opened SSE).
      await expect(hostPage.getByRole("heading", { name: /vote/i })).toBeVisible({ timeout: SSE_TIMEOUT });
      await expect(memberPage.getByRole("heading", { name: /vote/i })).toBeVisible({ timeout: SSE_TIMEOUT });

      // Both should see the countdown.
      await expect(hostPage.getByTestId("poll-countdown")).toBeVisible({ timeout: SSE_TIMEOUT });
      await expect(memberPage.getByTestId("poll-countdown")).toBeVisible({ timeout: SSE_TIMEOUT });

      // Both should see candidate vote buttons (hidden test hooks).
      await expect(hostPage.getByTestId("vote-up").first()).toBeVisible({ timeout: SSE_TIMEOUT });
      await expect(memberPage.getByTestId("vote-up").first()).toBeVisible({ timeout: SSE_TIMEOUT });

      // ── 7. Both vote ─────────────────────────────────────────────────────
      // Host upvotes.
      await hostPage.getByTestId("vote-up").first().click();

      // Member upvotes — vote.cast SSE fires, tally updates live cross-context.
      await memberPage.getByTestId("vote-up").first().click();

      // Assert voting was accepted: poll heading still visible (no error).
      await expect(hostPage.getByRole("heading", { name: /vote/i })).toBeVisible();
      await expect(memberPage.getByRole("heading", { name: /vote/i })).toBeVisible();

      // ── 8. Host ends poll → winner (poll.closed SSE fanout) ──────────────
      await hostPage.getByRole("button", { name: /end poll/i }).click();

      // Both contexts should show the winner screen.
      await expect(hostPage.getByRole("heading", { name: /we have a winner/i })).toBeVisible({ timeout: SSE_TIMEOUT });
      await expect(memberPage.getByRole("heading", { name: /we have a winner/i })).toBeVisible({ timeout: SSE_TIMEOUT });

      // Winner card shows the restaurant name (non-empty).
      const winnerName = await hostPage.locator(".winner-name").textContent();
      expect(winnerName?.trim()).toBeTruthy();

      // Member sees the same winner name (cross-context fanout confirmed).
      await expect(memberPage.locator(".winner-name")).toHaveText(winnerName!.trim(), { timeout: SSE_TIMEOUT });

      // ── Cleanup ───────────────────────────────────────────────────────────
      await hostCtx.close();
      await memberCtx.close();
    },
    // Total budget: deck load (30s) + SSE fanout steps + nav steps.
    120_000,
  );
});
