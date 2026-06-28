import { test, expect } from "@playwright/test";

// Tests for the extracted CreatePollForm component.
// PUBLIC_USE_MOCK=1 is set by playwright.config.ts webServer env — no backend required.

test.describe("CreatePollForm — new fields", () => {
  test("renders session-name input, timer select (300 pre-selected), threshold control (2 pre-selected)", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      geolocation: { latitude: -33.8688, longitude: 151.2093 },
      permissions: ["geolocation"],
    });
    const page = await context.newPage();
    await page.goto("/");

    // Session name input
    await expect(page.getByLabel(/session name/i)).toBeVisible();

    // Timer select — the "5 min" option (value 300) should be selected by default
    const timerSelect = page.getByLabel(/poll timer/i);
    await expect(timerSelect).toBeVisible();
    await expect(timerSelect).toHaveValue("300");

    // Promote threshold — default 2
    const thresholdControl = page.getByLabel(/promote threshold/i);
    await expect(thresholdControl).toBeVisible();
    await expect(thresholdControl).toHaveValue("2");

    await context.close();
  });

  test("renders existing location + cuisine controls", async ({ browser }) => {
    const context = await browser.newContext({
      geolocation: { latitude: -33.8688, longitude: 151.2093 },
      permissions: ["geolocation"],
    });
    const page = await context.newPage();
    await page.goto("/");

    // Cuisine chips still present
    await expect(page.getByRole("button", { name: /pizza/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /sushi/i })).toBeVisible();

    // Location detected message (geolocation granted)
    await expect(page.getByText(/location detected/i)).toBeVisible({ timeout: 8000 });

    await context.close();
  });

  test("submits with title/pollDurationSec/promoteThreshold included when name filled", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      geolocation: { latitude: -33.8688, longitude: 151.2093 },
      permissions: ["geolocation"],
    });
    const page = await context.newPage();
    await page.goto("/");

    await expect(page.getByText(/location detected/i)).toBeVisible({ timeout: 8000 });

    // Fill session name
    await page.getByLabel(/session name/i).fill("Friday Lunch");

    // Change timer to 10 min (600)
    await page.getByLabel(/poll timer/i).selectOption("600");

    // Change threshold to 3
    await page.getByLabel(/promote threshold/i).selectOption("3");

    // Pick a cuisine
    await page.getByRole("button", { name: /pizza/i }).click();

    // Submit
    await page.getByRole("button", { name: /start lunch/i }).click();

    // Join code banner appears — session was created successfully with the extra fields
    await expect(page.getByTestId("join-code")).toBeVisible({ timeout: 6000 });

    // Navigates to session screen
    await expect(page).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: 8000 });

    await context.close();
  });

  test("omits title from payload when name field is blank", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      geolocation: { latitude: -33.8688, longitude: 151.2093 },
      permissions: ["geolocation"],
    });
    const page = await context.newPage();
    await page.goto("/");

    await expect(page.getByText(/location detected/i)).toBeVisible({ timeout: 8000 });

    // Leave session name blank (default)
    await page.getByRole("button", { name: /sushi/i }).click();

    // Submit — should succeed (title omitted, not sent as empty string)
    await page.getByRole("button", { name: /start lunch/i }).click();

    // Join code banner appears — no validation error about title
    await expect(page.getByTestId("join-code")).toBeVisible({ timeout: 6000 });
    await expect(page).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: 8000 });

    await context.close();
  });

  test("post-create UX: shows join code then navigates to /s/<id>", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      geolocation: { latitude: -33.8688, longitude: 151.2093 },
      permissions: ["geolocation"],
    });
    const page = await context.newPage();
    await page.goto("/");

    await expect(page.getByText(/location detected/i)).toBeVisible({ timeout: 8000 });
    await page.getByRole("button", { name: /pizza/i }).click();
    await page.getByRole("button", { name: /start lunch/i }).click();

    // Join code visible briefly
    await expect(page.getByTestId("join-code")).toBeVisible({ timeout: 6000 });

    // Then navigates away
    await expect(page).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: 8000 });

    await context.close();
  });
});
