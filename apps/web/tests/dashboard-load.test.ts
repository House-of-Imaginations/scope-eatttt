import type {
	DashboardHistoryItem,
	DashboardSessionSummary,
} from "@scope/contract";
import type { SessionRepo, TransactionContext } from "@scope/core";
import { describe, expect, it } from "vitest";
import { loadSummary } from "../src/routes/dashboard/[id]/load";
import { loadHistory } from "../src/routes/dashboard/load";

// The dashboard load functions read locals.user (set in hooks.server.ts from
// Better Auth) and call the domain queries against the container repo. The
// guard + null-summary logic is what matters; we exercise it with a fake repo
// and fake locals, the same seam the oRPC handlers cross. (Full server-load
// auth can't be intercepted by Playwright's page.route, so this lives here.)

class FakeRepo
	implements
		Pick<
			SessionRepo<TransactionContext>,
			"withTx" | "listSessionsForUser" | "getSessionSummary"
		>
{
	history: DashboardHistoryItem[] = [];
	summary: DashboardSessionSummary | null = null;

	async withTx<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
		return fn({ txId: "tx-1" });
	}

	async listSessionsForUser(): Promise<DashboardHistoryItem[]> {
		return this.history;
	}

	async getSessionSummary(): Promise<DashboardSessionSummary | null> {
		return this.summary;
	}
}

async function expectRedirect(
	fn: () => Promise<unknown>,
	location: string,
): Promise<void> {
	try {
		await fn();
	} catch (err) {
		expect((err as { status: number; location: string }).status).toBe(302);
		expect((err as { status: number; location: string }).location).toBe(
			location,
		);
		return;
	}
	throw new Error("expected a redirect to be thrown");
}

describe("dashboard history load", () => {
	it("redirects logged-out visitors to /login?redirect=/dashboard", async () => {
		const repo = new FakeRepo();
		await expectRedirect(
			() => loadHistory(null, repo),
			"/login?redirect=/dashboard",
		);
	});

	it("redirects anonymous visitors to /login?redirect=/dashboard", async () => {
		const repo = new FakeRepo();
		await expectRedirect(
			() => loadHistory({ id: "u1", isAnonymous: true }, repo),
			"/login?redirect=/dashboard",
		);
	});

	it("returns history items for a real user", async () => {
		const repo = new FakeRepo();
		repo.history = [
			{
				id: crypto.randomUUID(),
				title: "Friday lunch",
				joinCode: "JOIN01",
				status: "decided",
				createdAt: "2026-06-20T00:00:00.000Z",
				winnerName: "Noodle House",
			},
		];

		await expect(
			loadHistory({ id: "u1", isAnonymous: false }, repo),
		).resolves.toEqual({
			items: repo.history,
		});
	});
});

describe("dashboard summary load", () => {
	it("redirects anonymous visitors", async () => {
		const repo = new FakeRepo();
		await expectRedirect(
			() => loadSummary({ id: "u1", isAnonymous: true }, repo, "sess-1"),
			"/login?redirect=/dashboard",
		);
	});

	it("returns { summary: null } for a non-member (no existence leak)", async () => {
		const repo = new FakeRepo();
		repo.summary = null;
		await expect(
			loadSummary({ id: "u1", isAnonymous: false }, repo, "sess-1"),
		).resolves.toEqual({
			summary: null,
		});
	});

	it("returns the summary for a member", async () => {
		const repo = new FakeRepo();
		repo.summary = {
			id: crypto.randomUUID(),
			title: "Friday lunch",
			joinCode: "JOIN01",
			status: "decided",
			winnerName: "Noodle House",
			candidates: [],
			members: [],
		};

		await expect(
			loadSummary({ id: "u1", isAnonymous: false }, repo, repo.summary.id),
		).resolves.toEqual({
			summary: repo.summary,
		});
	});
});
