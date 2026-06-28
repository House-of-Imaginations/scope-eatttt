import { expect, test } from "@playwright/test";

// Mock mode (PUBLIC_USE_MOCK=1) is active via playwright.config.ts webServer env.
// The mock `session.join` creates the session on join for unknown codes, so
// /join/<code> works on a fresh page load — just like a real joiner who is on a
// different device than the host. No cross-route state juggling needed.

test.describe("Join screen — enter code + display name to join session", () => {
	test("navigates to /s/<id> after entering display name and clicking Join lunch", async ({
		page,
	}) => {
		await page.goto("/join/ABCD12");

		await expect(
			page.getByRole("heading", { name: /you're invited to lunch/i }),
		).toBeVisible();

		await page.getByRole("textbox", { name: /display name/i }).fill("Alice");
		await page.getByRole("button", { name: /join lunch/i }).click();

		// /s/[id] is not built yet (F1.4) — the page 404s, but the URL changes.
		await expect(page).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: 8000 });
	});

	test("empty display name keeps Join lunch button disabled", async ({
		page,
	}) => {
		await page.goto("/join/ABCD12");

		const joinBtn = page.getByRole("button", { name: /join lunch/i });
		await expect(joinBtn).toBeDisabled();

		await page.getByRole("textbox", { name: /display name/i }).fill("Bob");
		await expect(joinBtn).toBeEnabled();

		await page.getByRole("textbox", { name: /display name/i }).fill("");
		await expect(joinBtn).toBeDisabled();
	});
});
