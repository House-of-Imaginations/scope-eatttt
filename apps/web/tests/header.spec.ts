import { expect, test } from "@playwright/test";

// AppHeader renders on every page (mounted in +layout.svelte). It reads the
// current user via getCurrentUser(), which always hits GET /api/auth/get-session
// (not mock-aware). We intercept that route to drive the three branches.
// ensureAnonSession() is a no-op in mock mode, so this route is only hit by
// getCurrentUser(). We host the header on /login — a simple existing page.

// ponytail: same route-stub idiom as join-account.spec.ts.
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

test.describe("AppHeader — nav to login / dashboard / logout", () => {
	test("logged out: shows a Log in link to /login", async ({ page }) => {
		await mockSession(page, { user: null, session: null });
		await page.goto("/login");

		const header = page.getByRole("banner");
		const login = header.getByRole("link", { name: /log in/i });
		await expect(login).toBeVisible();
		await expect(login).toHaveAttribute("href", "/login");
	});

	test("logged-in real user: shows avatar, name, Dashboard link, and Log out", async ({
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
		await page.goto("/login");

		const header = page.getByRole("banner");
		await expect(header.getByText("Alice")).toBeVisible();
		await expect(
			header.getByRole("link", { name: /dashboard/i }),
		).toHaveAttribute("href", "/dashboard");
		await expect(
			header.getByRole("button", { name: /log out/i }),
		).toBeVisible();
		// No Log in link on the real-user path.
		await expect(header.getByRole("link", { name: /log in/i })).toHaveCount(0);
	});

	test("anonymous user: shows Log in, NOT Dashboard", async ({ page }) => {
		await mockSession(page, {
			user: {
				id: "anon-1",
				isAnonymous: true,
				name: "Guest",
				email: "",
				image: null,
			},
			session: { id: "sess-anon" },
		});
		await page.goto("/login");

		const header = page.getByRole("banner");
		await expect(header.getByRole("link", { name: /log in/i })).toBeVisible();
		await expect(header.getByRole("link", { name: /dashboard/i })).toHaveCount(
			0,
		);
	});
});
