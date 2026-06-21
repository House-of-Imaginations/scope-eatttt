import { test, expect } from "@playwright/test";

// Mock mode (PUBLIC_USE_MOCK=1). The in-memory mock always succeeds, so to
// exercise the poll-action ERROR path (BUG 2: a rejected RPC must surface a
// visible, dismissable error instead of an unhandled promise rejection) we
// override the singleton api.poll.start to reject ONCE, then assert the banner.
// This is the genuine failing-first guard the unit layer cannot provide (a
// Svelte 5 rune component needs a browser, and the mock has no failure mode).

test.describe("Session screen — poll action error handling", () => {
  test("a failed open-poll surfaces a dismissable error banner", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      geolocation: { latitude: -33.8688, longitude: 151.2093 },
      permissions: ["geolocation"],
    });
    const page = await context.newPage();

    // Any unhandled rejection fails the test — BUG 2 was exactly an unhandled
    // rejection escaping the click handler.
    const rejections: string[] = [];
    page.on("pageerror", (e) => rejections.push(e.message));

    // Drive to the swiping phase where the host's "Open poll" control lives.
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

    // Force the next poll.start RPC to reject, then self-restore.
    await page.evaluate(async () => {
      const m = await import("/src/lib/client/orpc.ts");
      const orig = m.api.poll.start;
      // @ts-expect-error override leaf for the error-path test
      m.api.poll.start = async () => {
        // @ts-expect-error restore after one failing call
        m.api.poll.start = orig;
        throw new Error("Internal server error");
      };
    });

    await page.getByRole("button", { name: /open poll/i }).click();

    // The error banner must appear with the rejected message — not silence.
    const banner = page.getByTestId("action-error");
    await expect(banner).toBeVisible({ timeout: 6000 });
    await expect(banner).toContainText(/internal server error/i);

    // And it must be dismissable.
    await page.getByRole("button", { name: /dismiss/i }).click();
    await expect(banner).toBeHidden();

    expect(rejections, "no unhandled rejection should escape the handler").toEqual([]);

    await context.close();
  });
});
