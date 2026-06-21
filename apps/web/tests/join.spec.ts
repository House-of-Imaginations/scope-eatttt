import { test, expect } from "@playwright/test";

// ponytail: mock mode (PUBLIC_USE_MOCK=1) active via playwright.config.ts webServer env.
//
// The mock API is a browser-side singleton (module-level in orpc.ts). Hard page.goto()
// reloads destroy module state, so a session created on the start screen would be lost
// before the join screen could use it.
//
// Strategy to keep mock state alive across routes:
//   1. Patch window.history.pushState (via addInitScript) to silently drop /s/* pushes —
//      this prevents SvelteKit's client goto('/s/...') from navigating away, so the join
//      code banner stays visible long enough to read.
//   2. Inject an anchor pointing at /join/<code> and click it — SvelteKit intercepts
//      anchor element clicks for client-side routing, preserving all module singletons.
//   3. Restore normal pushState before the join API call so the final goto('/s/...') works.
//
// Honest limitation: /s/[id] does not exist yet (F1.4); the page 404s after navigation
// but the URL does change — we assert that.

test.describe("Join screen — enter code + display name to join session", () => {
  test("navigates to /s/<id> after entering display name and clicking Join lunch", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      geolocation: { latitude: -33.8688, longitude: 151.2093 },
      permissions: ["geolocation"],
    });
    const page = await context.newPage();

    // Block SvelteKit's client-side goto('/s/...') so the join code banner stays.
    // addInitScript runs before any page JS — it patches pushState in the window.
    await page.addInitScript(() => {
      const orig = window.history.pushState.bind(window.history);
      window.history.pushState = function (state, title, url) {
        if (typeof url === "string" && url.startsWith("/s/")) return;
        return orig(state, title, url);
      };
    });

    // ── 1. Create a session on the start screen ───────────────────────────────
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /where are we eating/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /pizza/i }).click();
    await page.getByRole("button", { name: /start lunch/i }).click();

    // Join code banner appears; nav to /s/ is blocked so it stays.
    await expect(page.getByTestId("join-code")).toBeVisible({ timeout: 6000 });
    const raw = await page.locator(".join-code-value").textContent();
    const joinCode = raw?.trim() ?? "";
    expect(joinCode).toBeTruthy();

    // ── 2. Client-side navigate to /join/<code> (preserves mock singleton) ────
    // SvelteKit intercepts anchor clicks and routes them via its client router.
    await page.evaluate((code) => {
      const a = document.createElement("a");
      a.href = `/join/${code}`;
      document.body.appendChild(a);
      a.click();
    }, joinCode);

    // ── 3. Join screen renders ────────────────────────────────────────────────
    await expect(
      page.getByRole("heading", { name: /you're invited to lunch/i }),
    ).toBeVisible({ timeout: 5000 });

    // Restore pushState so the join API's goto('/s/...') succeeds.
    await page.evaluate(() => {
      // Replace patcher with a transparent pass-through to the native implementation.
      window.history.pushState = window.history.pushState.bind(window.history);
      // Re-apply native by grabbing from the prototype directly.
      // ponytail: simplest restore — re-assign from History.prototype.
      Object.defineProperty(window.history, "pushState", {
        value: History.prototype.pushState.bind(window.history),
        writable: true,
        configurable: true,
      });
    });

    // ── 4. Enter display name and submit ─────────────────────────────────────
    await page.getByRole("textbox", { name: /display name/i }).fill("Alice");
    await page.getByRole("button", { name: /join lunch/i }).click();

    // ── 5. URL navigates to /s/<uuid> ────────────────────────────────────────
    // /s/[id] is not built yet (F1.4) — the page 404s but the URL changes.
    await expect(page).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: 8000 });

    await context.close();
  });

  test("empty display name keeps Join lunch button disabled", async ({ page }) => {
    // ponytail: no session needed — verifying the disabled state only.
    // Hard goto is fine here; we never call session.join.
    await page.goto("/join/ABCD12");

    const joinBtn = page.getByRole("button", { name: /join lunch/i });
    await expect(joinBtn).toBeDisabled();

    // Typing a name enables the button
    await page.getByRole("textbox", { name: /display name/i }).fill("Bob");
    await expect(joinBtn).toBeEnabled();

    // Clearing re-disables
    await page.getByRole("textbox", { name: /display name/i }).fill("");
    await expect(joinBtn).toBeDisabled();
  });
});
