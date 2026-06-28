import type { AppEvent } from "@scope/contract";
import { describe, expect, it } from "vitest";
import { applyEvent, initialState, reduce } from "./sessionStore.svelte";

const base = (over: Partial<{ id: string }> = {}) => ({
  id: over.id ?? "00000000-0000-0000-0000-000000000001",
  sessionId: "11111111-1111-1111-1111-111111111111",
  occurredAt: "2026-06-21T00:00:00.000Z",
});

describe("reduce", () => {
  it("adds a member on member.joined", () => {
    const ev: AppEvent = {
      ...base(),
      type: "member.joined",
      member: {
        id: "m1",
        userId: "u1",
        displayName: "A",
        isHost: true,
        joinedAt: "2026-06-21T00:00:00.000Z",
      },
    };
    const s = reduce(initialState("s1", "CODE"), ev);
    expect(s.members).toHaveLength(1);
    expect(s.members[0]!.isHost).toBe(true);
  });

  it("adds a candidate on restaurant.promoted and updates tally on vote.cast", () => {
    let s = reduce(initialState("s1", "CODE"), {
      ...base({ id: "e1" }),
      type: "restaurant.promoted",
      candidateId: "c1",
      promotedAt: "2026-06-21T00:00:00.000Z",
      restaurant: { id: "r1", name: "X", address: "1 St", cuisineTags: [] },
    });
    expect(s.candidates).toHaveLength(1);
    expect(s.candidates[0]!.netScore).toBe(0);
    s = reduce(s, {
      ...base({ id: "e2" }),
      type: "vote.cast",
      candidateId: "c1",
      userId: "u1",
      value: 1,
      tally: { upvotes: 3, downvotes: 1, netScore: 2 },
    });
    expect(s.candidates[0]!.netScore).toBe(2);
    expect(s.candidates[0]!.upvotes).toBe(3);
  });

  it("opens and closes the poll", () => {
    let s = initialState("s1", "CODE");
    s = reduce(s, {
      ...base({ id: "e3" }),
      type: "poll.opened",
      deadlineAt: "2026-06-21T00:05:00.000Z",
    });
    expect(s.status).toBe("polling");
    expect(s.pollDeadlineAt).toBe("2026-06-21T00:05:00.000Z");
    s = reduce(s, {
      ...base({ id: "e3b" }),
      type: "restaurant.promoted",
      candidateId: "c1",
      promotedAt: "2026-06-21T00:00:00.000Z",
      restaurant: { id: "r1", name: "X", address: "1 St", cuisineTags: [] },
    });
    s = reduce(s, {
      ...base({ id: "e4" }),
      type: "poll.closed",
      winnerCandidateId: "c1",
    });
    expect(s.status).toBe("decided");
    expect(s.winnerCandidateId).toBe("c1");
  });

  it("keeps same-user members separate but ignores the same member twice", () => {
    const ev: AppEvent = {
      ...base(),
      type: "member.joined",
      member: {
        id: "m1",
        userId: "u1",
        displayName: "A",
        isHost: true,
        joinedAt: "2026-06-21T00:00:00.000Z",
      },
    };
    let s = reduce(initialState("s1", "CODE"), ev);
    s = reduce(s, {
      ...ev,
      id: "00000000-0000-0000-0000-000000000099",
      member: { ...ev.member, id: "m2", displayName: "B", isHost: false },
    });
    s = reduce(s, { ...ev, id: "00000000-0000-0000-0000-000000000098" });
    expect(s.members.map((member) => member.displayName)).toEqual(["A", "B"]);
  });

  it("does not mutate the input state (purity)", () => {
    const prev = initialState("s1", "CODE");
    const next = reduce(prev, {
      ...base(),
      type: "member.joined",
      member: {
        id: "m1",
        userId: "u1",
        displayName: "A",
        isHost: true,
        joinedAt: "2026-06-21T00:00:00.000Z",
      },
    });
    expect(prev.members).toHaveLength(0);
    expect(next).not.toBe(prev);
    expect(next.members).not.toBe(prev.members);
  });

  it("moves lobby -> swiping on the first promotion only", () => {
    let s = initialState("s1", "CODE");
    expect(s.status).toBe("lobby");
    s = reduce(s, {
      ...base({ id: "p1" }),
      type: "restaurant.promoted",
      candidateId: "c1",
      promotedAt: "2026-06-21T00:00:00.000Z",
      restaurant: { id: "r1", name: "X", address: "1 St", cuisineTags: [] },
    });
    expect(s.status).toBe("swiping");
    s = reduce(s, {
      ...base({ id: "po" }),
      type: "poll.opened",
      deadlineAt: "2026-06-21T00:05:00.000Z",
    });
    expect(s.status).toBe("polling");
    s = reduce(s, {
      ...base({ id: "p2" }),
      type: "restaurant.promoted",
      candidateId: "c2",
      promotedAt: "2026-06-21T00:00:00.000Z",
      restaurant: { id: "r2", name: "Y", address: "2 St", cuisineTags: [] },
    });
    expect(s.status).toBe("polling");
  });

  it("is a no-op vote.cast when the candidate is missing", () => {
    const s = reduce(initialState("s1", "CODE"), {
      ...base(),
      type: "vote.cast",
      candidateId: "missing",
      userId: "u1",
      value: 1,
      tally: { upvotes: 5, downvotes: 0, netScore: 5 },
    });
    expect(s.candidates).toHaveLength(0);
  });

  it("skips a duplicate candidate (same candidateId)", () => {
    const ev: AppEvent = {
      ...base(),
      type: "restaurant.promoted",
      candidateId: "c1",
      promotedAt: "2026-06-21T00:00:00.000Z",
      restaurant: { id: "r1", name: "X", address: "1 St", cuisineTags: [] },
    };
    let s = reduce(initialState("s1", "CODE"), ev);
    s = reduce(s, { ...ev, id: "00000000-0000-0000-0000-000000000099" });
    expect(s.candidates).toHaveLength(1);
  });

  it("broadens the radius only when the next radius is larger", () => {
    let s = initialState("s1", "CODE");
    s = reduce(s, {
      ...base({ id: "b1" }),
      type: "prompt.broaden",
      userId: "u1",
      nextRadiusM: 1000,
    });
    expect(s.radiusM).toBe(1000);
    s = reduce(s, {
      ...base({ id: "b2" }),
      type: "prompt.broaden",
      userId: "u1",
      nextRadiusM: 500,
    });
    expect(s.radiusM).toBe(1000);
  });

  it("leaves session state unchanged on deck.replenished", () => {
    const prev = initialState("s1", "CODE");
    const next = reduce(prev, {
      ...base(),
      type: "deck.replenished",
      userId: "u1",
      restaurants: [{ id: "r1", name: "X", address: "1 St", cuisineTags: [] }],
    });
    expect(next).toEqual(prev);
  });
});

describe("applyEvent (store-level dedupe)", () => {
  it("does not double-apply the same event id", () => {
    const seen = new Set<string>();
    const ev: AppEvent = {
      ...base(),
      type: "member.joined",
      member: {
        id: "m1",
        userId: "u1",
        displayName: "A",
        isHost: true,
        joinedAt: "2026-06-21T00:00:00.000Z",
      },
    };
    let s = applyEvent(initialState("s1", "CODE"), ev, seen);
    s = applyEvent(s, ev, seen);
    expect(s.members).toHaveLength(1);
    expect(seen.has(ev.id)).toBe(true);
  });

  it("applies two distinct event ids", () => {
    const seen = new Set<string>();
    let s = initialState("s1", "CODE");
    s = applyEvent(
      s,
      {
        ...base({ id: "a1" }),
        type: "member.joined",
        member: {
          id: "m1",
          userId: "u1",
          displayName: "A",
          isHost: true,
          joinedAt: "2026-06-21T00:00:00.000Z",
        },
      },
      seen,
    );
    s = applyEvent(
      s,
      {
        ...base({ id: "a2" }),
        type: "member.joined",
        member: {
          id: "m2",
          userId: "u2",
          displayName: "B",
          isHost: false,
          joinedAt: "2026-06-21T00:00:00.000Z",
        },
      },
      seen,
    );
    expect(s.members).toHaveLength(2);
  });
});

describe("reconnect idempotency (F1.5)", () => {
  // Proves that applying the same vote.cast event id twice never double-counts.
  it("vote.cast with same event id applied twice — tally counted once, not doubled", () => {
    const seen = new Set<string>();
    // First set up a candidate so vote.cast has something to hit.
    let s = applyEvent(
      initialState("s1", "CODE"),
      {
        ...base({ id: "e-promote" }),
        type: "restaurant.promoted",
        candidateId: "c1",
        promotedAt: "2026-06-21T00:00:00.000Z",
        restaurant: {
          id: "r1",
          name: "Noodle Bar",
          address: "1 St",
          cuisineTags: [],
        },
      },
      seen,
    );

    const voteEv: AppEvent = {
      ...base({ id: "e-vote" }),
      type: "vote.cast",
      candidateId: "c1",
      userId: "u1",
      value: 1,
      tally: { upvotes: 3, downvotes: 1, netScore: 2 },
    };

    // Apply once (live delivery), then again (replay on reconnect — same event id).
    s = applyEvent(s, voteEv, seen);
    s = applyEvent(s, voteEv, seen);

    // Tally must reflect the event payload exactly once, not doubled.
    expect(s.candidates[0]!.upvotes).toBe(3);
    expect(s.candidates[0]!.netScore).toBe(2);
  });

  // Proves that a reconnect replay feeding already-seen events leaves state unchanged.
  it("replaying already-seen events leaves state unchanged", () => {
    const seen = new Set<string>();
    let s = initialState("s1", "CODE");

    const ev1: AppEvent = {
      ...base({ id: "r1" }),
      type: "member.joined",
      member: {
        id: "m1",
        userId: "u1",
        displayName: "Alice",
        isHost: true,
        joinedAt: "2026-06-21T00:00:00.000Z",
      },
    };
    const ev2: AppEvent = {
      ...base({ id: "r2" }),
      type: "member.joined",
      member: {
        id: "m2",
        userId: "u2",
        displayName: "Bob",
        isHost: false,
        joinedAt: "2026-06-21T00:00:00.000Z",
      },
    };

    // Initial live delivery.
    s = applyEvent(s, ev1, seen);
    s = applyEvent(s, ev2, seen);
    expect(s.members).toHaveLength(2);

    const stateBeforeReplay = s;

    // Simulate reconnect replay: same events replayed via eventsSince.
    // ponytail: this directly exercises the apply path the store uses on reconnect.
    s = applyEvent(s, ev1, seen);
    s = applyEvent(s, ev2, seen);

    // State must be referentially identical (applyEvent returns early, no new object).
    expect(s).toBe(stateBeforeReplay);
    expect(s.members).toHaveLength(2);
  });
});
