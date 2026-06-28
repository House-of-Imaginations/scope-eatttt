import { test, expect } from "@playwright/test";

// /dashboard guards on event.locals.user, which hooks.server.ts derives from
// Better Auth server-side (auth.api.getSession). Playwright's page.route can't
// intercept that server-internal call, and mock mode (PUBLIC_USE_MOCK=1) has no
// auth backend — so the only reachable server-load state here is the logged-out
// guard. The logged-in history/summary rendering and the not-found passthrough
// are covered by the load-helper unit tests (tests/dashboard-load.test.ts),
// which exercise the same guard + query seam with a fake repo.

test.describe("Dashboard — logged-out guard", () => {
  test("redirects a logged-out visit to /login?redirect=/dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)dashboard$/, { timeout: 8000 });
    await expect(page.getByRole("heading", { name: /welcome back|sign in/i })).toBeVisible();
  });

  test("redirects a logged-out visit to a summary page too", async ({ page }) => {
    await page.goto("/dashboard/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/login\?redirect=(%2F|\/)dashboard$/, { timeout: 8000 });
  });
});
