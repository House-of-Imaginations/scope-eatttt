import { describe, expect, it } from "vitest";
import { absorbGuest } from "./auth";

class FakeUserLinkRepo {
  anonymous = new Set<string>();
  reassigned: Array<{ anonymousUserId: string; newUserId: string }> = [];

  async isAnonymousUser(userId: string): Promise<boolean> {
    return this.anonymous.has(userId);
  }

  async reassignUserRows(anonymousUserId: string, newUserId: string): Promise<void> {
    this.reassigned.push({ anonymousUserId, newUserId });
  }
}

describe("absorbGuest", () => {
  it("reassigns rows from an anonymous user to the current real user", async () => {
    const repo = new FakeUserLinkRepo();
    repo.anonymous.add("anon-1");

    await expect(absorbGuest(repo, { anonUserId: "anon-1" }, "real-1")).resolves.toEqual({
      reassigned: true,
    });
    expect(repo.reassigned).toEqual([{ anonymousUserId: "anon-1", newUserId: "real-1" }]);
  });

  it("does not reassign the current user or a non-anonymous user", async () => {
    const repo = new FakeUserLinkRepo();

    await expect(absorbGuest(repo, { anonUserId: "real-1" }, "real-1")).resolves.toEqual({
      reassigned: false,
    });
    await expect(absorbGuest(repo, { anonUserId: "other-real" }, "real-1")).resolves.toEqual({
      reassigned: false,
    });
    expect(repo.reassigned).toEqual([]);
  });

  it("does not reassign into another anonymous user", async () => {
    const repo = new FakeUserLinkRepo();
    repo.anonymous.add("anon-1");
    repo.anonymous.add("anon-2");

    await expect(absorbGuest(repo, { anonUserId: "anon-1" }, "anon-2")).resolves.toEqual({
      reassigned: false,
    });
    expect(repo.reassigned).toEqual([]);
  });
});
