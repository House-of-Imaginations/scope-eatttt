import { expect, test } from "@playwright/test";

// Playwright runs against `pnpm dev` with PUBLIC_USE_MOCK=1 and
// PUBLIC_GOOGLE_ENABLED=1 (see playwright.config.ts webServer env), so the
// Google button renders and can be asserted. Mock mode has no real auth
// backend, so /api/auth/* is intercepted per-test with page.route — the page
// only cares about the response status (ok / 429), mirroring authClient.ts.

test.describe("Auth pages — login + signup on the comic-panel design", () => {
	test("/login renders email + password inputs, Google button, and a /signup link", async ({
		page,
	}) => {
		await page.goto("/login");

		await expect(
			page.getByRole("heading", { name: /sign in|welcome back/i }),
		).toBeVisible();
		await expect(page.getByRole("textbox", { name: /email/i })).toBeVisible();
		await expect(page.getByLabel(/password/i)).toBeVisible();
		await expect(
			page.getByRole("button", { name: /sign in with google/i }),
		).toBeVisible();
		await expect(page.getByRole("link", { name: /sign up/i })).toBeVisible();
	});

	test("valid credentials navigate to the redirect target", async ({
		page,
	}) => {
		// sign-in/email -> 200 ok. authClient treats any 2xx as { ok: true }.
		await page.route("**/api/auth/sign-in/email", (route) =>
			route.fulfill({
				status: 200,
				contentType: "application/json",
				body: "{}",
			}),
		);

		await page.goto("/login?redirect=/dashboard");

		// Gate on hydration: the submit button is disabled until the bound state
		// wires up; assert the form is interactive before filling.
		await expect(
			page.getByRole("heading", { name: /welcome back/i }),
		).toBeVisible();

		await page.getByRole("textbox", { name: /email/i }).fill("a@b.com");
		await page.getByLabel(/password/i).fill("hunter2hunter2");
		await expect(
			page.getByRole("button", { name: /^sign in$/i }),
		).toBeEnabled();
		await page.getByRole("button", { name: /^sign in$/i }).click();

		await expect(page).toHaveURL(/\/dashboard$/, { timeout: 8000 });
	});

	test("a 429 shows a 'try again in 30s' message", async ({ page }) => {
		await page.route("**/api/auth/sign-in/email", (route) =>
			route.fulfill({
				status: 429,
				headers: { "X-Retry-After": "30" },
				contentType: "application/json",
				body: "{}",
			}),
		);

		await page.goto("/login");

		await expect(
			page.getByRole("heading", { name: /welcome back/i }),
		).toBeVisible();

		await page.getByRole("textbox", { name: /email/i }).fill("a@b.com");
		await page.getByLabel(/password/i).fill("hunter2hunter2");
		await expect(
			page.getByRole("button", { name: /^sign in$/i }),
		).toBeEnabled();
		await page.getByRole("button", { name: /^sign in$/i }).click();

		await expect(page.getByText(/try again in 30s/i)).toBeVisible({
			timeout: 8000,
		});
	});

	test("the /signup link preserves ?redirect", async ({ page }) => {
		await page.goto("/login?redirect=/dashboard");
		await expect(page.getByRole("link", { name: /sign up/i })).toHaveAttribute(
			"href",
			"/signup?redirect=%2Fdashboard",
		);
	});

	test("/signup renders name + email + password and calls signUpEmail", async ({
		page,
	}) => {
		let signUpHit = false;
		await page.route("**/api/auth/sign-up/email", (route) => {
			signUpHit = true;
			return route.fulfill({
				status: 200,
				contentType: "application/json",
				body: "{}",
			});
		});

		await page.goto("/signup?redirect=/dashboard");

		await expect(page.getByRole("textbox", { name: /name/i })).toBeVisible();
		await expect(page.getByRole("textbox", { name: /email/i })).toBeVisible();
		await expect(page.getByLabel(/password/i)).toBeVisible();

		await page.getByRole("textbox", { name: /name/i }).fill("Alice");
		await page.getByRole("textbox", { name: /email/i }).fill("a@b.com");
		await page.getByLabel(/password/i).fill("hunter2hunter2");
		await expect(
			page.getByRole("button", { name: /^sign up$/i }),
		).toBeEnabled();
		await page.getByRole("button", { name: /^sign up$/i }).click();

		await expect(page).toHaveURL(/\/dashboard$/, { timeout: 8000 });
		expect(signUpHit, "signUpEmail should POST /api/auth/sign-up/email").toBe(
			true,
		);
	});
});
