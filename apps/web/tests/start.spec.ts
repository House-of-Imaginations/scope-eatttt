import { expect, test } from "@playwright/test";

// ponytail: grant mock geolocation so coords are resolved without waiting for
// a 5 s timeout. The page uses $env/static/public to detect PUBLIC_USE_MOCK=1
// and routes through the in-memory mock — no backend required.

test.describe("Start screen — create lunch session", () => {
	test("shows the start form heading", async ({ page }) => {
		await page.goto("/");
		await expect(
			page.getByRole("heading", { name: /where are we eating/i }),
		).toBeVisible();
	});

	test("selects cuisines, submits form, shows join code, then navigates to /s/<id>", async ({
		browser,
	}) => {
		// Grant geolocation permission with a fixed position (Sydney CBD)
		const context = await browser.newContext({
			geolocation: { latitude: -33.8688, longitude: 151.2093 },
			permissions: ["geolocation"],
		});
		const page = await context.newPage();

		await page.goto("/");

		// Heading is present
		await expect(
			page.getByRole("heading", { name: /where are we eating/i }),
		).toBeVisible();

		// Select two cuisine chips
		await page.getByRole("button", { name: /pizza/i }).click();
		await page.getByRole("button", { name: /sushi/i }).click();

		// Submit the form
		await page.getByRole("button", { name: /start lunch/i }).click();

		// Assert: join code banner appears (shown for 1.5 s before nav).
		// The mock generates a random 6-char join code — assert it is present.
		// Honest limitation: /s/[id] route not built yet (F1.4); the URL changes
		// but SvelteKit renders a 404. We assert the join code is visible on the
		// start screen first, then that the URL changed to /s/<id>.
		const joinCodeEl = page.getByTestId("join-code");
		await expect(joinCodeEl).toBeVisible({ timeout: 6000 });

		// After the 1.5 s pause, SvelteKit navigates to /s/<sessionId>
		await expect(page).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: 8000 });

		await context.close();
	});
});
