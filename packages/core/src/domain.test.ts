import { describe, expect, it } from "vitest";
import type { Candidate, Restaurant, SessionState } from "@scope/contract";
import {
  ClosedSessionError,
  NotHostError,
  NotMemberError,
  type RecordSwipeResult,
  createSessionState,
  decidePollWinner,
  joinSession,
  recordSwipe,
} from "./index";

const now = "2026-06-20T01:00:00.000Z";

function baseRestaurant(id = "restaurant-1"): Restaurant {
  return {
    id,
    name: `Restaurant ${id}`,
    address: "1 Test Street",
    cuisineTags: ["thai"],
  };
}

function baseSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    id: "session-1",
    joinCode: "ABC123",
    status: "lobby",
    hostUserId: "host-user",
    viewerIsHost: true,
    lat: -37.8136,
    lng: 144.9631,
    radiusM: 500,
    cuisines: [],
    members: [
      {
        id: "member-host",
        userId: "host-user",
        displayName: "Host",
        isHost: true,
        joinedAt: now,
      },
    ],
    candidates: [],
    ...overrides,
  };
}

function candidate(id: string, netScore: number, promotedAt: string): Candidate {
  const restaurant = baseRestaurant(id);
  return {
    id: `candidate-${id}`,
    restaurant,
    promotedAt,
    upvotes: Math.max(netScore, 0),
    downvotes: Math.max(-netScore, 0),
    netScore,
  };
}

describe("session creation", () => {
  it("creates lobby state with default radius, cuisines, host member, and uppercase short join code", () => {
    const session = createSessionState({
      id: "session-1",
      hostUserId: "host-user",
      hostMemberId: "member-host",
      hostDisplayName: "Host",
      lat: -37.8136,
      lng: 144.9631,
      now,
      generateJoinCode: () => "ab12cd",
    });

    expect(session).toMatchObject({
      id: "session-1",
      joinCode: "AB12CD",
      status: "lobby",
      hostUserId: "host-user",
      lat: -37.8136,
      lng: 144.9631,
      radiusM: 500,
      cuisines: [],
      candidates: [],
    });
    expect(session.joinCode).toMatch(/^[A-Z0-9]{4,12}$/);
    expect(session.members).toEqual([
      {
        id: "member-host",
        userId: "host-user",
        displayName: "Host",
        isHost: true,
        joinedAt: now,
      },
    ]);
  });

  it("generates a 10-character join code when no code generator is injected", () => {
    const session = createSessionState({
      id: "session-1",
      hostUserId: "host-user",
      hostMemberId: "member-host",
      hostDisplayName: "Host",
      lat: -37.8136,
      lng: 144.9631,
      now,
    });

    expect(session.joinCode).toMatch(/^[A-Z2-9]{10}$/);
  });
});

describe("member joins", () => {
  it("rejects joins for closed sessions with a typed domain error", () => {
    expect(() =>
      joinSession(baseSession({ status: "closed" }), {
        memberId: "member-2",
        userId: "user-2",
        displayName: "Guest",
        joinedAt: now,
      }),
    ).toThrow(ClosedSessionError);
  });

  it("returns existing membership when the same user joins again", () => {
    const session = baseSession({
      members: [
        {
          id: "member-existing",
          userId: "user-2",
          displayName: "Guest",
          isHost: false,
          joinedAt: now,
        },
      ],
    });

    const result = joinSession(session, {
      memberId: "member-new",
      userId: "user-2",
      displayName: "Guest Again",
      joinedAt: "2026-06-20T02:00:00.000Z",
    });

    expect(result.members).toHaveLength(1);
    expect(result.members[0]?.id).toBe("member-existing");
  });
});

describe("swipes", () => {
  it("records accept swipes idempotently and promotes a restaurant exactly once at threshold two", () => {
    const session = baseSession({
      status: "swiping",
      members: [
        ...baseSession().members,
        {
          id: "member-2",
          userId: "user-2",
          displayName: "Guest",
          isHost: false,
          joinedAt: now,
        },
      ],
    });
    const restaurant = baseRestaurant();

    const first = recordSwipe({
      session,
      swipes: [],
      rejectStreak: 0,
      userId: "host-user",
      restaurant,
      decision: "accept",
      now,
    });
    const duplicate = recordSwipe({
      ...first,
      userId: "host-user",
      restaurant,
      decision: "accept",
      now: "2026-06-20T01:01:00.000Z",
    });
    const promoted = recordSwipe({
      ...duplicate,
      userId: "user-2",
      restaurant,
      decision: "accept",
      now: "2026-06-20T01:02:00.000Z",
    });
    const duplicateAfterPromotion = recordSwipe({
      ...promoted,
      userId: "user-2",
      restaurant,
      decision: "accept",
      now: "2026-06-20T01:03:00.000Z",
    });

    expect(first.swipes).toHaveLength(1);
    expect(duplicate.swipes).toHaveLength(1);
    expect(promoted.session.candidates).toHaveLength(1);
    expect(promoted.session.candidates[0]).toMatchObject({
      id: "session-1:restaurant-1",
      restaurant,
      promotedAt: "2026-06-20T01:02:00.000Z",
      upvotes: 0,
      downvotes: 0,
      netScore: 0,
    });
    expect(duplicateAfterPromotion.session.candidates).toHaveLength(1);
  });

  it("tracks reject streak, resets on accept, and suggests radius broadening with cap", () => {
    const session = baseSession({
      status: "swiping",
      members: [
        ...baseSession().members,
        {
          id: "member-2",
          userId: "user-2",
          displayName: "Guest",
          isHost: false,
          joinedAt: now,
        },
      ],
    });

    const initialSwipeState: RecordSwipeResult = { session, swipes: [], rejectStreak: 0 };
    const rejected = [1, 2, 3, 4, 5].reduce(
      (state, index) =>
        recordSwipe({
          ...state,
          userId: index % 2 === 0 ? "host-user" : "user-2",
          restaurant: baseRestaurant(`reject-${index}`),
          decision: "reject",
          now: `2026-06-20T01:0${index}:00.000Z`,
        }),
      initialSwipeState,
    );

    expect(rejected.rejectStreak).toBe(5);
    expect(rejected.suggestedRadiusM).toBe(1000);

    const accepted = recordSwipe({
      ...rejected,
      userId: "host-user",
      restaurant: baseRestaurant("accepted"),
      decision: "accept",
      now: "2026-06-20T01:06:00.000Z",
    });

    expect(accepted.rejectStreak).toBe(0);
    expect(accepted.suggestedRadiusM).toBeUndefined();

    const capped = recordSwipe({
      session: baseSession({ status: "swiping", radiusM: 3000 }),
      swipes: [],
      rejectStreak: 4,
      userId: "host-user",
      restaurant: baseRestaurant("capped"),
      decision: "reject",
      now,
    });

    expect(capped.suggestedRadiusM).toBe(3000);
  });

  it("requires the swiper to be a session member", () => {
    expect(() =>
      recordSwipe({
        session: baseSession({ status: "swiping" }),
        swipes: [],
        rejectStreak: 0,
        userId: "stranger",
        restaurant: baseRestaurant(),
        decision: "accept",
        now,
      }),
    ).toThrow(NotMemberError);
  });
});

describe("poll winner", () => {
  it("selects max net score and breaks ties by earliest promotion time", () => {
    const result = decidePollWinner(
      baseSession({
        status: "polling",
        candidates: [
          candidate("late", 3, "2026-06-20T01:03:00.000Z"),
          candidate("earliest", 3, "2026-06-20T01:01:00.000Z"),
          candidate("low", 1, "2026-06-20T01:00:00.000Z"),
        ],
      }),
      { actorUserId: "host-user" },
    );

    expect(result.status).toBe("decided");
    expect(result.winnerCandidateId).toBe("candidate-earliest");
  });

  it("keeps an already decided session unchanged", () => {
    const session = baseSession({
      status: "decided",
      winnerCandidateId: "candidate-existing",
      candidates: [candidate("existing", 1, now)],
    });

    expect(decidePollWinner(session, { actorUserId: "host-user" })).toBe(session);
  });

  it("requires the actor to be the session host", () => {
    expect(() =>
      decidePollWinner(
        baseSession({
          status: "polling",
          members: [
            ...baseSession().members,
            {
              id: "member-2",
              userId: "user-2",
              displayName: "Guest",
              isHost: false,
              joinedAt: now,
            },
          ],
        }),
        { actorUserId: "user-2" },
      ),
    ).toThrow(NotHostError);
  });
});
