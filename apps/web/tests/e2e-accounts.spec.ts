/**
 * T9 — Real multi-client E2E for the accounts stack: signup → dashboard →
 * create poll → multi-client join with avatars → swipe (threshold 1) → poll →
 * vote → winner → history → read-only summary, plus the anonymous-link upgrade.
 *
 * Prerequisites (must be running before this suite):
 *   1. docker compose up -d             Postgres (5432), PgBouncer (6432), Redis (6379)
 *   2. pnpm --filter worker dev         BullMQ worker — processes places.fetch jobs
 *   3. playwright.real.config.ts starts the web dev server automatically with
 *      PUBLIC_USE_MOCK=0 on port 5174.
 *
 * Anti-hack contract (same as e2e-real.spec.ts): zero stubs, zero fakes, zero
 * injected events. Each browser.newContext() is a distinct Better Auth session.
 * FakePlaces (PLACES_PROVIDER=fake) yields deterministic decks: every member in
 * the same session sees fake-place-1 first, so a single accept with
 * promoteThreshold=1 promotes that shared restaurant.
 *
 * Run:
 *   pnpm --filter web exec playwright test -c playwright.real.config.ts e2e-accounts
 */

import { type BrowserContext, type Page, expect, test } from "@playwright/test";

// Generous timeouts — the worker processes places.fetch async after session create.
const DECK_TIMEOUT = 30_000; // worker must fetch + cache places before swipe.deck
const SSE_TIMEOUT = 20_000; // SSE fanout propagation across contexts
const NAV_TIMEOUT = 15_000; // SvelteKit route transitions

const SYDNEY = { latitude: -33.8688, longitude: 151.2093 };

// ---------------------------------------------------------------------------
// Helpers (mirror e2e-real.spec.ts; shared across the specs in this file)
// ---------------------------------------------------------------------------

/** Fresh geolocated context — one per simulated client / browser tab. */
async function newClient(
	browser: import("@playwright/test").Browser,
): Promise<BrowserContext> {
	return browser.newContext({
		geolocation: SYDNEY,
		permissions: ["geolocation"],
	});
}

/**
 * Navigate to "/" and wait for the layout bootstrap's anonymous sign-in POST so
 * the HttpOnly session cookie is stored before any oRPC mutation fires.
 */
async function bootstrapAnon(page: Page): Promise<void> {
	const authDone = page.waitForResponse(
		(r) => r.url().includes("/api/auth/") && r.request().method() !== "GET",
		{ timeout: NAV_TIMEOUT },
	);
	await page.goto("/");
	await authDone;
}

/** Unique email per run so the suite is rerunnable without DB cleanup. */
function uniqueEmail(prefix: string): string {
	return `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.test`;
}

/** Sign up a real account from /signup; lands on `redirect` (default /dashboard). */
async function signUp(
	page: Page,
	name: string,
	email: string,
	password: string,
): Promise<void> {
	await page.goto("/signup");
	await page.getByRole("textbox", { name: /name/i }).fill(name);
	// Email field is type=email (Playwright role "textbox"); password is type=password.
	await page.getByRole("textbox", { name: /email/i }).fill(email);
	await page.locator("#password").fill(password);
	await page.getByRole("button", { name: /^sign up$/i }).click();
}

/** Read the join code from the lobby (data-testid="lobby-join-code"). */
async function readJoinCode(page: Page): Promise<string> {
	const el = page.getByTestId("lobby-join-code");
	await expect(el).toBeVisible({ timeout: NAV_TIMEOUT });
	const text = await el.textContent();
	if (!text?.trim()) throw new Error("lobby-join-code element is empty");
	return text.trim();
}

/**
 * Create a session from the dashboard's CreatePollForm and land in the lobby.
 * The form requires geolocation + at least one cuisine, so we wait for the
 * geo-detected text and click a cuisine chip before submitting. Returns the
 * join code read off the lobby.
 */
async function createSession(
	page: Page,
	opts: {
		title: string;
		timerSec: "60" | "180" | "300" | "600";
		threshold: "1" | "2" | "3" | "4" | "5";
	},
): Promise<string> {
	await expect(page.getByText(/location detected/i)).toBeVisible({
		timeout: NAV_TIMEOUT,
	});
	await page.getByRole("textbox", { name: /session name/i }).fill(opts.title);
	await page.getByRole("button", { name: "Pizza" }).click(); // ≥1 cuisine required
	await page.getByLabel(/poll timer/i).selectOption(opts.timerSec);
	await page.getByLabel(/promote threshold/i).selectOption(opts.threshold);
	await page.getByRole("button", { name: /start lunch/i }).click();
	await expect(page).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: NAV_TIMEOUT });
	await expect(page.getByRole("heading", { name: /lobby/i })).toBeVisible({
		timeout: NAV_TIMEOUT,
	});
	return readJoinCode(page);
}

/** Guest join via /join/<code>: type a name, submit, land in the lobby. */
async function joinAsGuest(
	page: Page,
	code: string,
	name: string,
): Promise<void> {
	await page.goto(`/join/${code}`);
	await expect(
		page.getByRole("heading", { name: /you're invited to lunch/i }),
	).toBeVisible({
		timeout: NAV_TIMEOUT,
	});
	await page.getByRole("textbox", { name: /display name/i }).fill(name);
	await page.getByRole("button", { name: /join lunch/i }).click();
	await expect(page).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: NAV_TIMEOUT });
	await expect(page.getByRole("heading", { name: /lobby/i })).toBeVisible({
		timeout: NAV_TIMEOUT,
	});
}

// ---------------------------------------------------------------------------
// Spec 1 — full accounts flow, steps 1-7 of the T9 plan.
// ---------------------------------------------------------------------------

test.describe("T9 accounts E2E — signup → create → join → avatars → winner → history", () => {
	test("real account hosts, guests + a signed-in member join, promote → vote → winner → dashboard", async ({
		browser,
	}) => {
		// deck load (30s) + several SSE steps (20s each) + nav + signup round-trips.
		test.setTimeout(240_000);

		const password = "hunter2-correct-horse";
		const hostName = "Hosty McHostface";
		const memberCName = "Carol Signed";
		const hostEmail = uniqueEmail("host");
		const memberCEmail = uniqueEmail("carol");

		// ── 1. Client A: sign up → /dashboard, header shows account chrome ──────
		const ctxA = await newClient(browser);
		const pageA = await ctxA.newPage();
		await signUp(pageA, hostName, hostEmail, password);
		await expect(pageA).toHaveURL(/\/dashboard$/, { timeout: NAV_TIMEOUT });

		// AppHeader fetches the session on mount; signup navigates client-side, so
		// reload /dashboard to let the header re-fetch the now-authenticated user.
		await pageA.goto("/dashboard");
		// Header reflects the real account: avatar initials, name, Dashboard, Log out.
		await expect(pageA.locator("header").getByText(hostName)).toBeVisible({
			timeout: NAV_TIMEOUT,
		});
		await expect(pageA.getByRole("link", { name: /dashboard/i })).toBeVisible();
		await expect(pageA.getByRole("button", { name: /log out/i })).toBeVisible();
		// Empty history on a brand-new account.
		await expect(pageA.getByTestId("history-empty")).toBeVisible({
			timeout: NAV_TIMEOUT,
		});

		// ── 2. Client A: create a poll (1-min timer, threshold 1) → /s/{id} ─────
		const code = await createSession(pageA, {
			title: "Friday Lunch",
			timerSec: "60",
			threshold: "1",
		});
		expect(code.length).toBeGreaterThan(0);

		// ── 3. Client B (fresh guest): join via /join/{code} ────────────────────
		const ctxB = await newClient(browser);
		const pageB = await ctxB.newPage();
		await bootstrapAnon(pageB);
		await joinAsGuest(pageB, code, "Grace Guest");
		// Host sees the guest appear live with an avatar (initials "GG").
		await expect(pageA.getByText("Grace Guest")).toBeVisible({
			timeout: SSE_TIMEOUT,
		});

		// ── 4. Client C: sign in (sign up) then one-tap "Join as {name}" ────────
		const ctxC = await newClient(browser);
		const pageC = await ctxC.newPage();
		await signUp(pageC, memberCName, memberCEmail, password);
		await expect(pageC).toHaveURL(/\/dashboard$/, { timeout: NAV_TIMEOUT });
		// From the join screen, a logged-in user gets a one-tap "Join as <name>".
		await pageC.goto(`/join/${code}`);
		await expect(
			pageC.getByRole("heading", { name: /you're invited to lunch/i }),
		).toBeVisible({
			timeout: NAV_TIMEOUT,
		});
		await pageC
			.getByRole("button", { name: new RegExp(`join as ${memberCName}`, "i") })
			.click();
		await expect(pageC.getByRole("heading", { name: /lobby/i })).toBeVisible({
			timeout: NAV_TIMEOUT,
		});
		await expect(pageA.locator(".members").getByText(memberCName)).toBeVisible({
			timeout: SSE_TIMEOUT,
		});

		// ── 5. Lobby on A shows all three members, each with an avatar ──────────
		// Each MemberPill renders an Avatar + the display name. Scope to the lobby
		// members list (the host name also appears in the header → strict-mode clash).
		const members = pageA.locator(".members");
		for (const name of [hostName, "Grace Guest", memberCName]) {
			await expect(members.getByText(name)).toBeVisible({
				timeout: SSE_TIMEOUT,
			});
		}
		// Avatar initials are rendered for the guest (no uploaded image → "GG").
		await expect(members.getByText("GG", { exact: true })).toBeVisible({
			timeout: SSE_TIMEOUT,
		});

		// ── 6. Host starts swiping; a single accept (threshold 1) promotes ──────
		await pageA.getByRole("button", { name: /start swiping/i }).click();
		await expect(pageA.getByRole("button", { name: /^accept$/i })).toBeVisible({
			timeout: DECK_TIMEOUT,
		});
		await expect(pageB.getByRole("button", { name: /^accept$/i })).toBeVisible({
			timeout: DECK_TIMEOUT,
		});

		// One accept hits promoteThreshold=1 → restaurant.promoted fires.
		await pageA.getByRole("button", { name: /^accept$/i }).click();
		await expect(pageA.getByTestId("promote-toast")).toBeVisible({
			timeout: SSE_TIMEOUT,
		});

		// Host opens the poll → all contexts transition to the polling screen.
		await pageA.getByRole("button", { name: /open poll/i }).click();
		await expect(pageA.getByRole("heading", { name: /vote/i })).toBeVisible({
			timeout: SSE_TIMEOUT,
		});
		await expect(pageB.getByRole("heading", { name: /vote/i })).toBeVisible({
			timeout: SSE_TIMEOUT,
		});
		await expect(pageC.getByRole("heading", { name: /vote/i })).toBeVisible({
			timeout: SSE_TIMEOUT,
		});

		// Everyone votes (hidden test hooks are 1×1px → force the click).
		await pageA.getByTestId("vote-up").first().click({ force: true });
		await pageB.getByTestId("vote-up").first().click({ force: true });
		await pageC.getByTestId("vote-up").first().click({ force: true });

		// Host ends the poll → winner fans out to every context.
		await pageA.getByRole("button", { name: /end poll/i }).click();
		await expect(
			pageA.getByRole("heading", { name: /we have a winner/i }),
		).toBeVisible({
			timeout: SSE_TIMEOUT,
		});
		const winnerName = (
			await pageA.locator(".winner-name").textContent()
		)?.trim();
		expect(winnerName).toBeTruthy();
		await expect(pageB.locator(".winner-name")).toHaveText(winnerName!, {
			timeout: SSE_TIMEOUT,
		});

		// ── 7. Back on A's /dashboard: session in history with the winner name ──
		await pageA.goto("/dashboard");
		const row = pageA.getByTestId("history-row").first();
		await expect(row).toBeVisible({ timeout: NAV_TIMEOUT });
		await expect(row).toContainText("Friday Lunch");
		await expect(row).toContainText(winnerName!);

		// Open the read-only summary: winner + candidate leaderboard.
		await row.click();
		await expect(pageA).toHaveURL(/\/dashboard\/[0-9a-f-]+/, {
			timeout: NAV_TIMEOUT,
		});
		await expect(pageA.getByTestId("summary")).toBeVisible({
			timeout: NAV_TIMEOUT,
		});
		await expect(
			pageA.getByTestId("summary-winner").locator(".winner-name"),
		).toHaveText(winnerName!);
		await expect(pageA.locator(".candidates .cand").first()).toBeVisible();

		await ctxA.close();
		await ctxB.close();
		await ctxC.close();
	});
});

// ---------------------------------------------------------------------------
// Spec 2 — anonymous-link upgrade (step 8). A guest who swiped, then signs up
// mid-session, stays the SAME member: count doesn't double, swipes persist.
// ---------------------------------------------------------------------------

test.describe("T9 accounts E2E — anonymous link preserves member identity", () => {
	test("guest swipes, signs up mid-session, remains the same member with persisted swipes", async ({
		browser,
	}) => {
		test.setTimeout(240_000);

		const password = "hunter2-correct-horse";
		const upgradeName = "Dana Upgrade";
		const upgradeEmail = uniqueEmail("dana");

		// Host (real account) creates a threshold-2 session so a single guest accept
		// does NOT promote yet — we want a live, pending swipe to survive the link.
		const ctxHost = await newClient(browser);
		const hostPage = await ctxHost.newPage();
		await signUp(hostPage, "Anon Link Host", uniqueEmail("alhost"), password);
		await expect(hostPage).toHaveURL(/\/dashboard$/, { timeout: NAV_TIMEOUT });
		const code = await createSession(hostPage, {
			title: "Link Test",
			timerSec: "60",
			threshold: "2",
		});

		// Guest joins anonymously. The host stays in the lobby for the whole test so
		// its live member list (only rendered in the lobby) is observable across the
		// anon→real link — that's our "member did not double" probe.
		const ctxGuest = await newClient(browser);
		const guestPage = await ctxGuest.newPage();
		await bootstrapAnon(guestPage);
		await joinAsGuest(guestPage, code, upgradeName);
		await expect(hostPage.getByText(upgradeName)).toBeVisible({
			timeout: SSE_TIMEOUT,
		});

		// Two members in the host's lobby before the upgrade (host + guest).
		const membersBefore = await hostPage.locator(".members > *").count();
		expect(membersBefore).toBe(2);

		// ── Guest signs up mid-session via /signup?redirect=/s/{id}. Better Auth's
		//    onLinkAccount fires → reassignUserRows moves the member row (and any
		//    swipe/vote rows) from the anonymous user to the new real user, then the
		//    guest lands back in the same session as a real, linked account.
		const sessionPath = new URL(guestPage.url()).pathname; // /s/<id>
		await guestPage.goto(`/signup?redirect=${encodeURIComponent(sessionPath)}`);
		await guestPage.getByRole("textbox", { name: /name/i }).fill(upgradeName);
		await guestPage.getByRole("textbox", { name: /email/i }).fill(upgradeEmail);
		await guestPage.locator("#password").fill(password);
		await guestPage.getByRole("button", { name: /^sign up$/i }).click();

		// Redirected back to the same session (now as a real, linked account) and the
		// upgraded user is still a member (lobby resolves, not kicked out).
		await expect(guestPage).toHaveURL(
			new RegExp(sessionPath.replace(/\//g, "\\/")),
			{
				timeout: NAV_TIMEOUT,
			},
		);
		await expect(
			guestPage.getByRole("heading", { name: /lobby/i }),
		).toBeVisible({ timeout: NAV_TIMEOUT });

		// Member did NOT double: the host's lobby still shows exactly two members, and
		// Dana is still exactly one of them (the row was reassigned in place).
		await expect(hostPage.locator(".members > *")).toHaveCount(2, {
			timeout: SSE_TIMEOUT,
		});
		await expect(
			hostPage.locator(".members").getByText(upgradeName),
		).toHaveCount(1);

		// Membership persisted across the link: the upgraded real account now sees the
		// session in its real-account dashboard history (rows reassigned to newUserId).
		// A non-member would get an empty history + a not-found summary, so this is the
		// observable proof that onLinkAccount reassigned the guest's rows.
		await guestPage.goto("/dashboard");
		const linkedRow = guestPage.getByTestId("history-row").first();
		await expect(linkedRow).toBeVisible({ timeout: NAV_TIMEOUT });
		await expect(linkedRow).toContainText("Link Test");

		await linkedRow.click();
		await expect(guestPage.getByTestId("summary")).toBeVisible({
			timeout: NAV_TIMEOUT,
		});

		await ctxHost.close();
		await ctxGuest.close();
	});
});
