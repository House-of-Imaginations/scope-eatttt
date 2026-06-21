import { test, expect } from "@playwright/test";

// Mock mode (PUBLIC_USE_MOCK=1) is active via playwright.config.ts webServer env.
// The whole flow runs in ONE page so the in-memory mock (a module-level
// singleton that survives SvelteKit client-side navigation) keeps the same
// session across route changes — one host driving the session, not a hack.
//
// HONEST MOCK LIMIT (verified, not assumed): a real candidate promotion cannot
// be produced by a single browser swiping the UI deck. Promotion needs >= 2
// DISTINCT member accepts on the SAME restaurant (PROMOTE_THRESHOLD=2), but the
// deck advances after every decide, so each card is only ever accepted once by
// whichever member the mock has rotated in. No single card ever reaches two
// accepts. This is inherent to the per-deck mock and is exactly what the F1.6
// multi-client E2E covers (two browsers, each with its own deck, swiping the
// same restaurant). These tests therefore assert the UI transitions a single
// browser CAN genuinely drive: lobby -> swiping (with a live, advancing deck)
// and the host's poll control transitioning the screen into the polling phase.
// They do NOT fake a candidate or a winner.

test.describe("Session screen — status-driven state machine", () => {
  test("create lands in lobby with join code and self in members", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      geolocation: { latitude: -33.8688, longitude: 151.2093 },
      permissions: ["geolocation"],
    });
    const page = await context.newPage();

    await page.goto("/");
    // Wait for geolocation to resolve before submitting so coords are present
    // (the start screen blocks submit without a location).
    await expect(page.getByText(/location detected/i)).toBeVisible({
      timeout: 8000,
    });
    await page.getByRole("button", { name: /pizza/i }).click();
    await page.getByRole("button", { name: /start lunch/i }).click();

    // Land on /s/<id> in the lobby.
    await expect(page).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: 8000 });
    await expect(
      page.getByRole("heading", { name: /lobby/i }),
    ).toBeVisible({ timeout: 8000 });

    // Join code is shown, big and shareable.
    await expect(page.getByTestId("lobby-join-code")).toBeVisible();

    // Self (the host) appears in the member list.
    await expect(page.getByText(/host/i).first()).toBeVisible();

    // Host sees the "Start swiping" control.
    await expect(
      page.getByRole("button", { name: /start swiping/i }),
    ).toBeVisible();

    await context.close();
  });

  test("lobby -> swiping shows a live, advancing swipe deck", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      geolocation: { latitude: -33.8688, longitude: 151.2093 },
      permissions: ["geolocation"],
    });
    const page = await context.newPage();

    await page.goto("/");
    await expect(page.getByText(/location detected/i)).toBeVisible({
      timeout: 8000,
    });
    await page.getByRole("button", { name: /pizza/i }).click();
    await page.getByRole("button", { name: /start lunch/i }).click();
    await expect(page).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: 8000 });

    await page.getByRole("button", { name: /start swiping/i }).click();

    // The swipe deck renders the top card with its accept/reject controls.
    await expect(
      page.getByRole("button", { name: /^accept$/i }),
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.getByRole("button", { name: /^reject$/i }),
    ).toBeVisible();

    // Swiping advances the deck: accept the top card, a different card replaces it.
    const firstCardName = await page
      .getByTestId("swipe-card-name")
      .textContent();
    await page.getByRole("button", { name: /^accept$/i }).click();
    await expect
      .poll(async () => page.getByTestId("swipe-card-name").textContent())
      .not.toBe(firstCardName);

    // Host control to advance into the poll phase is present while swiping.
    await expect(
      page.getByRole("button", { name: /open poll/i }),
    ).toBeVisible();

    await context.close();
  });

  test("host opens the poll: screen transitions into the polling phase with a countdown", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      geolocation: { latitude: -33.8688, longitude: 151.2093 },
      permissions: ["geolocation"],
    });
    const page = await context.newPage();

    await page.goto("/");
    await expect(page.getByText(/location detected/i)).toBeVisible({
      timeout: 8000,
    });
    await page.getByRole("button", { name: /pizza/i }).click();
    await page.getByRole("button", { name: /start lunch/i }).click();
    await expect(page).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: 8000 });

    await page.getByRole("button", { name: /start swiping/i }).click();
    await expect(
      page.getByRole("button", { name: /open poll/i }),
    ).toBeVisible({ timeout: 8000 });

    // Host opens the poll -> the mock sets status=polling and a deadline.
    await page.getByRole("button", { name: /open poll/i }).click();

    // Polling phase renders: heading + a live countdown to the deadline.
    // HONEST LIMIT: no candidate rows appear because no candidate could be
    // promoted single-browser (see file header). The polling UI itself — its
    // heading, countdown, and host "End poll" control — is genuinely reached.
    await expect(
      page.getByRole("heading", { name: /vote/i }),
    ).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("poll-countdown")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /end poll/i }),
    ).toBeVisible();

    await context.close();
  });
});
