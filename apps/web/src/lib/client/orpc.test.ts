import { describe, it, expect } from "vitest";
import { makeMockApi } from "./mockHandler";

describe("mock api", () => {
  it("creates a session with a join code", async () => {
    const api = makeMockApi();
    const { sessionId, joinCode } = await api.session.create({ lat: 1, lng: 2, cuisines: [] });
    expect(sessionId).toBeTruthy();
    expect(joinCode.length).toBeGreaterThanOrEqual(4);
  });

  it("promotes a restaurant after 2 distinct-member accepts", async () => {
    const api = makeMockApi();
    const { sessionId, joinCode } = await api.session.create({ lat: 1, lng: 2, cuisines: [] });
    await api.session.join({ joinCode, displayName: "B" });
    const r1 = await api.swipe.decide({ sessionId, restaurantId: "r1", decision: "accept" }); // host accept
    const r2 = await api.swipe.decide({ sessionId, restaurantId: "r1", decision: "accept" }); // 2nd member accept
    expect(r1.promoted).toBe(false);
    expect(r2.promoted).toBe(true);
    expect(r2.candidate?.restaurant.id).toBe("r1");
  });

  it("serves a deck of restaurants", async () => {
    const api = makeMockApi();
    const { sessionId } = await api.session.create({ lat: 1, lng: 2, cuisines: [] });
    const deck = await api.swipe.deck({ sessionId, limit: 5 });
    expect(deck.length).toBeGreaterThan(0);
    expect(deck[0]).toHaveProperty("cuisineTags");
  });

  it("tallies votes and closes to a winner", async () => {
    const api = makeMockApi();
    const { sessionId, joinCode } = await api.session.create({ lat: 1, lng: 2, cuisines: [] });
    await api.session.join({ joinCode, displayName: "B" });
    await api.swipe.decide({ sessionId, restaurantId: "r1", decision: "accept" });
    const p = await api.swipe.decide({ sessionId, restaurantId: "r1", decision: "accept" });
    const candId = p.candidate!.id;
    await api.poll.start({ sessionId });
    const v = await api.poll.vote({ sessionId, candidateId: candId, value: 1 });
    expect(v.netScore).toBe(1);
    const { winnerCandidateId } = await api.poll.close({ sessionId });
    expect(winnerCandidateId).toBe(candId);
  });
});
