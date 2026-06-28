import { test, expect } from "@playwright/test";

// Mock mode (PUBLIC_USE_MOCK=1) is active via playwright.config.ts. The mock
// transport handles `session.join`. getCurrentUser() is NOT mock-aware — it
// always hits GET /api/auth/get-session — so we intercept that route to drive
// the anonymous-vs-real-user branch on mount. ensureAnonSession() is a no-op in
// mock mode, so this route is only ever hit by getCurrentUser().

// ponytail: route stub returns the shape getCurrentUser() expects; null user or
// missing session → getCurrentUser() resolves null (anonymous path).
async function mockSession(
  page: import("@playwright/test").Page,
  body: unknown,
): Promise<void> {
  await page.route("**/api/auth/get-session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    }),
  );
}

test.describe("Join screen — account sign-in option", () => {
  test("anonymous visitor sees the name field and a Sign in link to /login", async ({
    page,
  }) => {
    await mockSession(page, { user: null, session: null });
    await page.goto("/join/ABCD12");

    // Existing fast guest path is intact: name field is present.
    await expect(
      page.getByRole("textbox", { name: /display name/i }),
    ).toBeVisible();

    // New: a subtle "Have an account? Sign in" link to the login redirect.
    const signIn = page.getByRole("link", { name: /sign in/i });
    await expect(signIn).toBeVisible();
    await expect(signIn).toHaveAttribute(
      "href",
      "/login?redirect=%2Fjoin%2FABCD12",
    );
  });

  test("logged-in real user sees a one-tap Join button instead of the name field", async ({
    page,
  }) => {
    await mockSession(page, {
      user: {
        id: "user-1",
        isAnonymous: false,
        name: "Alice",
        email: "alice@example.com",
        image: null,
      },
      session: { id: "sess-1" },
    });
    await page.goto("/join/ABCD12");

    // One-tap button addressed to the account name.
    await expect(
      page.getByRole("button", { name: /join as alice/i }),
    ).toBeVisible();

    // No free-text name field on the logged-in path.
    await expect(
      page.getByRole("textbox", { name: /display name/i }),
    ).toHaveCount(0);

    // Clicking joins as the account name → navigates to /s/<id>.
    await page.getByRole("button", { name: /join as alice/i }).click();
    await expect(page).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: 8000 });
  });

  test("guest join via the name field still works as before", async ({
    page,
  }) => {
    await mockSession(page, { user: null, session: null });
    await page.goto("/join/ABCD12");

    await page.getByRole("textbox", { name: /display name/i }).fill("Bob");
    await page.getByRole("button", { name: /join lunch/i }).click();
    await expect(page).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: 8000 });
  });
});
