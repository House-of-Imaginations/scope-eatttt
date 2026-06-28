import { ORPCError, implement } from "@orpc/server";
import {
  type Candidate,
  type Member,
  type Restaurant,
  type SessionState,
  contract,
} from "@scope/contract";
import type { AddMemberRecord, AuthUser, SessionSummary, StreakStore } from "@scope/core";
import {
  NotHostError,
  NotMemberError,
  castVote,
  closePoll,
  createSessionCommand,
  decideSwipe,
  getSessionSummary,
  joinSessionCommand,
  listHistory,
  startPoll,
  startSwiping as startSwipingCommand,
} from "@scope/core";
import type { AppContainer } from "./container";
import { getContainer } from "./container";
import { outboxRowToEvent } from "./relay";

export interface ORPCContext {
  user: AuthUser | null;
}

export interface ORPCIds {
  sessionId?: () => string;
  memberId: () => string;
  joinCode?: () => string;
}

export interface ORPCDeps {
  container?: AppContainer;
  ids?: ORPCIds;
  now?: () => string;
  streak?: StreakStore;
}

const os = implement(contract).$context<ORPCContext>();

export function createORPCRouter(deps: ORPCDeps = {}) {
  const container = deps.container ?? getContainer();
  const ids = deps.ids ?? { memberId: () => crypto.randomUUID() };
  const now = deps.now ?? (() => new Date().toISOString());
  const streak = deps.streak ?? new ProcessStreakStore();

  return os.router({
    session: {
      create: os.session.create.handler(async ({ input, context }) => {
        const user = requireUser(context);
        const result = await createSessionCommand(
          { repo: container.repo, ids, now },
          input,
          user.id,
          user.displayName,
          user.image ?? undefined,
        );
        await enqueuePlacesFetch(
          container,
          {
            id: result.sessionId,
            joinCode: result.joinCode,
            hostUserId: user.id,
            status: "lobby",
            lat: input.lat,
            lng: input.lng,
            radiusM: input.radiusM,
            cuisines: input.cuisines,
          },
          result.memberId,
          input.radiusM,
        );
        return result;
      }),
      join: os.session.join.handler(async ({ input, context }) => {
        const user = requireUser(context);
        const result = await joinSessionCommand(
          { repo: container.repo, ids, now },
          input,
          user.id,
          user.image ?? undefined,
        );
        const session = await container.repo.withTx((tx) =>
          container.repo.getSession(tx, result.sessionId),
        );
        if (!session) {
          throw new ORPCError("NOT_FOUND", { message: "Session not found" });
        }
        await enqueuePlacesFetch(
          container,
          session,
          result.memberId,
          session.radiusM ?? container.config.RADIUS_BASE_M,
        );
        return result;
      }),
      startSwiping: os.session.startSwiping.handler(async ({ input, context }) => {
        const user = requireUser(context);
        const { member } = await requireSessionMember(
          container,
          input.sessionId,
          user.id,
          input.memberId,
        );
        if (!member.isHost) {
          throw new ORPCError("NOT_HOST", {
            status: 403,
            message: "Only the host can perform this action",
          });
        }
        return mapDomainError(() =>
          startSwipingCommand({ repo: container.repo }, input.sessionId, user.id),
        );
      }),
      state: os.session.state.handler(async ({ input, context }) => {
        const user = requireUser(context);
        await requireMember(container, input.sessionId, user.id, input.memberId);
        return buildSessionState(container, input.sessionId, user.id, input.memberId);
      }),
      eventsSince: os.session.eventsSince.handler(async ({ input, context }) => {
        const user = requireUser(context);
        await requireMember(container, input.sessionId, user.id);
        return (
          await container.relayStore.listSessionEventsAfter(input.sessionId, input.afterEventId)
        ).map(outboxRowToEvent);
      }),
    },
    swipe: {
      deck: os.swipe.deck.handler(async ({ input, context }) => {
        const user = requireUser(context);
        const { member } = await requireSessionMember(
          container,
          input.sessionId,
          user.id,
          input.memberId,
        );
        return container.repo.withTx((tx) =>
          container.repo.listDeckRestaurants(tx, input.sessionId, member.id, input.limit),
        );
      }),
      decide: os.swipe.decide.handler(async ({ input, context }) => {
        const user = requireUser(context);
        const { session, member } = await requireSessionMember(
          container,
          input.sessionId,
          user.id,
          input.memberId,
        );

        const restaurant = await requireRestaurant(container, input.restaurantId);
        const result = await decideSwipe(
          {
            repo: container.repo,
            streak,
            promoteThreshold: session.promoteThreshold ?? container.config.PROMOTE_THRESHOLD,
            radius: {
              rejectStreak: container.config.REJECT_STREAK,
              stepM: container.config.RADIUS_STEP_M,
              capM: container.config.RADIUS_CAP_M,
            },
            now,
          },
          {
            sessionId: input.sessionId,
            restaurantId: input.restaurantId,
            decision: input.decision,
            restaurant,
            memberRadiusM: member.radiusM ?? session.radiusM ?? container.config.RADIUS_BASE_M,
            ...(input.deckLeft === undefined ? {} : { deckLeft: input.deckLeft }),
          },
          user.id,
          member.id,
        );

        if (result.broaden && result.newRadiusM !== undefined) {
          await enqueuePlacesFetch(container, session, member.id, result.newRadiusM);
        }

        if (result.candidateId === undefined) {
          return { promoted: result.promoted };
        }

        return {
          promoted: result.promoted,
          candidate: candidateFromPromotion(result.candidateId, restaurant, now()),
        };
      }),
      broaden: os.swipe.broaden.handler(async ({ input, context }) => {
        const user = requireUser(context);
        if (input.userId !== user.id) {
          throw new ORPCError("FORBIDDEN", {
            status: 403,
            message: "Cannot broaden another member's deck",
          });
        }

        const { session, member } = await requireSessionMember(
          container,
          input.sessionId,
          user.id,
          input.memberId,
        );
        const currentRadiusM = member.radiusM ?? session.radiusM ?? container.config.RADIUS_BASE_M;
        const radiusM = Math.min(currentRadiusM + input.stepM, container.config.RADIUS_CAP_M);

        await container.repo.withTx((tx) =>
          container.repo.updateMemberRadius(tx, input.sessionId, member.id, radiusM),
        );
        await enqueuePlacesFetch(container, session, member.id, radiusM);

        return { radiusM, restaurants: [] };
      }),
    },
    poll: {
      start: os.poll.start.handler(async ({ input, context }) => {
        const user = requireUser(context);
        const { session, member } = await requireSessionMember(
          container,
          input.sessionId,
          user.id,
          input.memberId,
        );
        if (!member.isHost) {
          throw new ORPCError("NOT_HOST", {
            status: 403,
            message: "Only the host can perform this action",
          });
        }
        return mapDomainError(() =>
          startPoll(
            {
              repo: container.repo,
              queue: container.queue,
              timerMs: (session.pollDurationSec ?? input.timerMs / 1000) * 1000,
              now,
            },
            input.sessionId,
            user.id,
          ),
        );
      }),
      results: os.poll.results.handler(async ({ input, context }) => {
        const user = requireUser(context);
        await requireMember(container, input.sessionId, user.id);
        return container.repo.withTx((tx) =>
          container.repo.listCandidateResults(tx, input.sessionId),
        );
      }),
      vote: os.poll.vote.handler(async ({ input, context }) => {
        const user = requireUser(context);
        const { member } = await requireSessionMember(
          container,
          input.sessionId,
          user.id,
          input.memberId,
        );
        const tally = await castVote({ repo: container.repo }, input, user.id, member.id);
        return { candidateId: input.candidateId, netScore: tally.net };
      }),
      close: os.poll.close.handler(async ({ input, context }) => {
        const user = requireUser(context);
        const { member } = await requireSessionMember(
          container,
          input.sessionId,
          user.id,
          input.memberId,
        );
        if (!member.isHost) {
          throw new ORPCError("NOT_HOST", {
            status: 403,
            message: "Only the host can perform this action",
          });
        }
        return mapDomainError(() => closePoll({ repo: container.repo }, input.sessionId, user.id));
      }),
    },
    dashboard: {
      history: os.dashboard.history.handler(async ({ context }) => {
        const user = requireUser(context);
        if (user.isAnonymous) {
          throw new ORPCError("UNAUTHORIZED");
        }
        return listHistory({ repo: container.repo }, user.id);
      }),
      session: os.dashboard.session.handler(async ({ input, context }) => {
        const user = requireUser(context);
        return getSessionSummary({ repo: container.repo }, input.sessionId, user.id);
      }),
    },
  });
}

function requireUser(context: ORPCContext): AuthUser {
  if (!context.user) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return context.user;
}

async function requireMember(
  container: AppContainer,
  sessionId: string,
  userId: string,
  memberId?: string,
): Promise<void> {
  await requireSessionMember(container, sessionId, userId, memberId);
}

async function requireSessionMember(
  container: AppContainer,
  sessionId: string,
  userId: string,
  memberId?: string,
): Promise<{ session: SessionSummary; member: AddMemberRecord }> {
  const result = await container.repo.withTx(async (tx) => {
    const session = await container.repo.getSession(tx, sessionId);
    const members = await container.repo.listMembers(tx, sessionId);
    const member =
      memberId === undefined
        ? members.find((candidate) => candidate.userId === userId)
        : members.find((candidate) => candidate.id === memberId && candidate.userId === userId);
    return { session, member };
  });

  if (!result.session) {
    throw new ORPCError("NOT_FOUND", {
      status: 404,
      message: "Session not found",
    });
  }
  if (result.member) {
    return { session: result.session, member: result.member };
  }

  throw new ORPCError("NOT_MEMBER", {
    status: 403,
    message: "User is not a member of this session",
  });
}

async function requireRestaurant(
  container: AppContainer,
  restaurantId: string,
): Promise<Restaurant> {
  const restaurant = await container.repo.withTx((tx) =>
    container.repo.getRestaurant(tx, restaurantId),
  );
  if (!restaurant) {
    throw new ORPCError("NOT_FOUND", {
      status: 404,
      message: "Restaurant is not in the server-side deck cache",
    });
  }
  return restaurant;
}

async function buildSessionState(
  container: AppContainer,
  sessionId: string,
  userId: string,
  memberId?: string,
): Promise<SessionState | null> {
  return container.repo.withTx(async (tx) => {
    const session = await container.repo.getSession(tx, sessionId);
    if (!session) {
      return null;
    }

    const members = await container.repo.listMembers(tx, sessionId);
    const candidates = await container.repo.listCandidateResults(tx, sessionId);

    return {
      id: session.id,
      joinCode: session.joinCode,
      status: session.status ?? "lobby",
      hostUserId: requireSessionString(session.hostUserId, "hostUserId"),
      viewerIsHost:
        memberId === undefined
          ? members.some((member) => member.userId === userId && member.isHost)
          : members.some(
              (member) => member.id === memberId && member.userId === userId && member.isHost,
            ),
      lat: requireSessionNumber(session.lat, "lat"),
      lng: requireSessionNumber(session.lng, "lng"),
      radiusM: session.radiusM ?? container.config.RADIUS_BASE_M,
      cuisines: session.cuisines ?? [],
      members: members.map(memberFromRecord),
      candidates,
      ...(session.pollDeadlineAt === undefined ? {} : { pollDeadlineAt: session.pollDeadlineAt }),
      ...(session.winnerCandidateId === undefined
        ? {}
        : { winnerCandidateId: session.winnerCandidateId }),
    };
  });
}

async function enqueuePlacesFetch(
  container: AppContainer,
  session: SessionSummary,
  userId: string,
  radiusM: number,
): Promise<void> {
  const lat = requireSessionNumber(session.lat, "lat");
  const lng = requireSessionNumber(session.lng, "lng");
  await container.queue.enqueue(
    "places.fetch",
    {
      sessionId: session.id,
      userId,
      lat,
      lng,
      radiusM,
      cuisines: session.cuisines ?? [],
      limit: 5,
    },
    { jobId: `places-fetch-${session.id}-${userId}-${radiusM}` },
  );
}

function requireSessionNumber(value: number | undefined, field: string): number {
  if (value === undefined) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      status: 500,
      message: `Session is missing ${field}`,
    });
  }
  return value;
}

function requireSessionString(value: string | undefined, field: string): string {
  if (value === undefined) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      status: 500,
      message: `Session is missing ${field}`,
    });
  }
  return value;
}

function memberFromRecord(member: AddMemberRecord): Member {
  return {
    id: member.id,
    userId: member.userId,
    displayName: member.displayName,
    isHost: member.isHost,
    joinedAt: member.joinedAt,
    ...(member.image === undefined ? {} : { image: member.image }),
  };
}

async function mapDomainError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof NotHostError) {
      throw new ORPCError("NOT_HOST", { status: 403, message: error.message });
    }
    if (error instanceof NotMemberError) {
      throw new ORPCError("NOT_MEMBER", {
        status: 403,
        message: error.message,
      });
    }
    throw error;
  }
}

function candidateFromPromotion(
  candidateId: string,
  restaurant: Restaurant,
  promotedAt: string,
): Candidate {
  return {
    id: candidateId,
    restaurant,
    promotedAt,
    upvotes: 0,
    downvotes: 0,
    netScore: 0,
  };
}

class ProcessStreakStore implements StreakStore {
  private readonly values = new Map<string, number>();

  async incr(sessionId: string, userId: string): Promise<number> {
    const key = streakKey(sessionId, userId);
    const next = (this.values.get(key) ?? 0) + 1;
    this.values.set(key, next);
    return next;
  }

  async reset(sessionId: string, userId: string): Promise<void> {
    this.values.delete(streakKey(sessionId, userId));
  }

  async get(sessionId: string, userId: string): Promise<number> {
    return this.values.get(streakKey(sessionId, userId)) ?? 0;
  }
}

function streakKey(sessionId: string, userId: string): string {
  return `${sessionId}:${userId}`;
}
