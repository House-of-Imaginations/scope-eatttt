import type { Candidate, Decision, Restaurant, SessionState } from "@scope/contract";

export * from "./ports/auth";
export * from "./ports/bus";
export * from "./ports/cache";
export * from "./ports/places";
export * from "./ports/queue";
export * from "./ports/repo";
export * from "./ports/streak";
export * from "./domain/session";
export * from "./domain/swipe";
export * from "./domain/poll";
export * from "./domain/auth";
export * from "./domain/dashboard";
export { createSession as createSessionCommand, joinSession as joinSessionCommand } from "./domain/session";
export * from "./testing/fakePlaces";
export * from "./testing/inMemoryBus";
export * from "./testing/inlineQueue";
export * from "./testing/memoryCache";

export const DEFAULT_RADIUS_M = 500;
export const MAX_RADIUS_M = 3000;
export const RADIUS_EXPAND_STEP_M = 500;
export const REJECT_STREAK_EXPAND_THRESHOLD = 5;
export const PROMOTE_ACCEPT_THRESHOLD = 2;

export class ClosedSessionError extends Error {
  constructor(message = "Cannot perform this action on a closed session") {
    super(message);
    this.name = "ClosedSessionError";
  }
}

export class NotHostError extends Error {
  constructor(message = "Only the session host can perform this action") {
    super(message);
    this.name = "NotHostError";
  }
}

export class NotMemberError extends Error {
  constructor(message = "User is not a member of this session") {
    super(message);
    this.name = "NotMemberError";
  }
}

export interface CreateSessionStateInput {
  id: string;
  hostUserId: string;
  hostMemberId: string;
  hostDisplayName: string;
  lat: number;
  lng: number;
  now: string;
  cuisines?: string[];
  radiusM?: number;
  generateJoinCode?: () => string;
}

export interface JoinSessionInput {
  memberId: string;
  userId: string;
  displayName: string;
  joinedAt: string;
}

export interface SwipeRecord {
  sessionId: string;
  userId: string;
  restaurantId: string;
  decision: Decision;
  swipedAt: string;
}

export interface SwipeState {
  session: SessionState;
  swipes: SwipeRecord[];
  rejectStreak: number;
}

export interface RecordSwipeInput extends SwipeState {
  userId: string;
  restaurant: Restaurant;
  decision: Decision;
  now: string;
}

export type RecordSwipeResult = SwipeState & {
  suggestedRadiusM?: number;
};

export interface DecidePollWinnerInput {
  actorUserId: string;
}

export function createSessionState(input: CreateSessionStateInput): SessionState {
  return {
    id: input.id,
    joinCode: normalizeJoinCode(input.generateJoinCode?.() ?? generateJoinCode()),
    status: "lobby",
    hostUserId: input.hostUserId,
    viewerIsHost: true,
    lat: input.lat,
    lng: input.lng,
    radiusM: input.radiusM ?? DEFAULT_RADIUS_M,
    cuisines: input.cuisines ?? [],
    members: [
      {
        id: input.hostMemberId,
        userId: input.hostUserId,
        displayName: input.hostDisplayName,
        isHost: true,
        joinedAt: input.now,
      },
    ],
    candidates: [],
  };
}

export function joinSession(session: SessionState, input: JoinSessionInput): SessionState {
  if (session.status === "closed") {
    throw new ClosedSessionError();
  }

  if (session.members.some((member) => member.userId === input.userId)) {
    return session;
  }

  return {
    ...session,
    members: [
      ...session.members,
      {
        id: input.memberId,
        userId: input.userId,
        displayName: input.displayName,
        isHost: false,
        joinedAt: input.joinedAt,
      },
    ],
  };
}

export function recordSwipe(input: RecordSwipeInput): RecordSwipeResult {
  if (input.session.status === "closed") {
    throw new ClosedSessionError();
  }
  assertMember(input.session, input.userId);

  const existingSwipe = input.swipes.find(
    (swipe) =>
      swipe.sessionId === input.session.id &&
      swipe.userId === input.userId &&
      swipe.restaurantId === input.restaurant.id,
  );

  if (existingSwipe) {
    return {
      session: input.session,
      swipes: input.swipes,
      rejectStreak: input.rejectStreak,
    };
  }

  const swipes = [
    ...input.swipes,
    {
      sessionId: input.session.id,
      userId: input.userId,
      restaurantId: input.restaurant.id,
      decision: input.decision,
      swipedAt: input.now,
    },
  ];

  const rejectStreak = input.decision === "accept" ? 0 : input.rejectStreak + 1;
  const session =
    input.decision === "accept" ? promoteIfThresholdReached(input.session, swipes, input.restaurant, input.now) : input.session;
  const result: RecordSwipeResult = {
    session,
    swipes,
    rejectStreak,
  };

  if (input.decision === "reject" && rejectStreak >= REJECT_STREAK_EXPAND_THRESHOLD) {
    result.suggestedRadiusM = Math.min(input.session.radiusM + RADIUS_EXPAND_STEP_M, MAX_RADIUS_M);
  }

  return result;
}

export function decidePollWinner(session: SessionState, input: DecidePollWinnerInput): SessionState {
  if (session.status === "decided") {
    return session;
  }
  assertHost(session, input.actorUserId);

  const winner = [...session.candidates].sort(
    (left, right) => right.netScore - left.netScore || left.promotedAt.localeCompare(right.promotedAt),
  )[0];

  return {
    ...session,
    status: "decided",
    ...(winner ? { winnerCandidateId: winner.id } : {}),
  };
}

function promoteIfThresholdReached(
  session: SessionState,
  swipes: SwipeRecord[],
  restaurant: Restaurant,
  promotedAt: string,
): SessionState {
  if (session.candidates.some((candidate) => candidate.restaurant.id === restaurant.id)) {
    return session;
  }

  const acceptUserCount = new Set(
    swipes
      .filter(
        (swipe) =>
          swipe.sessionId === session.id &&
          swipe.restaurantId === restaurant.id &&
          swipe.decision === "accept",
      )
      .map((swipe) => swipe.userId),
  ).size;

  if (acceptUserCount < PROMOTE_ACCEPT_THRESHOLD) {
    return session;
  }

  const candidate: Candidate = {
    id: `${session.id}:${restaurant.id}`,
    restaurant,
    promotedAt,
    upvotes: 0,
    downvotes: 0,
    netScore: 0,
  };

  return {
    ...session,
    candidates: [...session.candidates, candidate],
  };
}

function assertMember(session: SessionState, userId: string): void {
  if (!session.members.some((member) => member.userId === userId)) {
    throw new NotMemberError();
  }
}

function assertHost(session: SessionState, userId: string): void {
  if (session.hostUserId !== userId) {
    throw new NotHostError();
  }
}

function normalizeJoinCode(joinCode: string): string {
  return joinCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function generateJoinCode(): string {
  return Math.random().toString(36).slice(2, 8);
}
