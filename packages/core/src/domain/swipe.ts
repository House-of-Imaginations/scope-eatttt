import type { Decision, Restaurant } from "@scope/contract";
import type { OutboxWrite, TransactionContext } from "../ports/repo";
import type { StreakStore } from "../ports/streak";

export interface RadiusConfig {
  rejectStreak: number;
  stepM: number;
  capM: number;
}

export interface MemberRadius {
  radiusM: number;
}

export interface RadiusEvaluation {
  broaden: boolean;
  newRadiusM?: number;
}

export interface SwipeRepo<Tx = TransactionContext> {
  withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  recordSwipe(tx: Tx, input: { sessionId: string; userId: string; restaurantId: string; decision: Decision; swipedAt: string }): Promise<{ created: boolean }>;
  countAccepts(tx: Tx, sessionId: string, restaurantId: string): Promise<number>;
  isCandidate(tx: Tx, sessionId: string, restaurantId: string): Promise<boolean>;
  addCandidate(tx: Tx, input: { sessionId: string; restaurantId: string; promotedAt: string }): Promise<{ candidateId: string }>;
  updateMemberRadius(tx: Tx, sessionId: string, userId: string, radiusM: number): Promise<void>;
  insertOutbox(tx: Tx, event: OutboxWrite): Promise<string>;
}

export interface DecideSwipeDeps<Tx = TransactionContext> {
  repo: SwipeRepo<Tx>;
  streak: StreakStore;
  promoteThreshold: number;
  radius?: RadiusConfig;
  now: () => string;
}

export interface DecideSwipeInput {
  sessionId: string;
  restaurantId: string;
  decision: Decision;
  restaurant: Restaurant;
  memberRadiusM?: number;
  deckLeft?: number;
}

export interface DecideSwipeResult {
  promoted: boolean;
  candidateId?: string;
  broaden?: boolean;
  newRadiusM?: number;
}

export function evaluateRadius(streak: number, deckLeft: number, member: MemberRadius, cfg: RadiusConfig): RadiusEvaluation {
  const shouldBroaden = streak >= cfg.rejectStreak || deckLeft <= 0;
  if (!shouldBroaden || member.radiusM >= cfg.capM) {
    return { broaden: false };
  }

  return {
    broaden: true,
    newRadiusM: Math.min(member.radiusM + cfg.stepM, cfg.capM),
  };
}

export async function decideSwipe<Tx>(
  deps: DecideSwipeDeps<Tx>,
  input: DecideSwipeInput,
  userId: string,
): Promise<DecideSwipeResult> {
  return deps.repo.withTx(async (tx) => {
    const swipedAt = deps.now();
    const record = await deps.repo.recordSwipe(tx, {
      sessionId: input.sessionId,
      userId,
      restaurantId: input.restaurantId,
      decision: input.decision,
      swipedAt,
    });

    if (!record.created) {
      return { promoted: false };
    }

    if (input.decision === "reject") {
      return handleReject(deps, tx, input, userId);
    }

    await deps.streak.reset(input.sessionId, userId);

    const acceptCount = await deps.repo.countAccepts(tx, input.sessionId, input.restaurantId);
    const alreadyCandidate = await deps.repo.isCandidate(tx, input.sessionId, input.restaurantId);

    if (acceptCount < deps.promoteThreshold || alreadyCandidate) {
      return { promoted: false };
    }

    const candidate = await deps.repo.addCandidate(tx, {
      sessionId: input.sessionId,
      restaurantId: input.restaurantId,
      promotedAt: swipedAt,
    });
    await deps.repo.insertOutbox(tx, restaurantPromotedEvent(input.sessionId, candidate.candidateId, input.restaurant, swipedAt));

    return { promoted: true, candidateId: candidate.candidateId };
  });
}

async function handleReject<Tx>(
  deps: DecideSwipeDeps<Tx>,
  tx: Tx,
  input: DecideSwipeInput,
  userId: string,
): Promise<DecideSwipeResult> {
  const streak = await deps.streak.incr(input.sessionId, userId);
  const radius = deps.radius;

  if (!radius || input.memberRadiusM === undefined || input.deckLeft === undefined) {
    return { promoted: false };
  }

  const evaluation = evaluateRadius(streak, input.deckLeft, { radiusM: input.memberRadiusM }, radius);

  if (!evaluation.broaden || evaluation.newRadiusM === undefined) {
    return { promoted: false };
  }

  await deps.repo.updateMemberRadius(tx, input.sessionId, userId, evaluation.newRadiusM);
  await deps.repo.insertOutbox(tx, promptBroadenEvent(input.sessionId, userId, evaluation.newRadiusM));

  return { promoted: false, broaden: true, newRadiusM: evaluation.newRadiusM };
}

function restaurantPromotedEvent(sessionId: string, candidateId: string, restaurant: Restaurant, promotedAt: string): OutboxWrite {
  return {
    aggregate: "session",
    aggregateId: sessionId,
    type: "restaurant.promoted",
    payload: { candidateId, restaurant, promotedAt },
  };
}

function promptBroadenEvent(sessionId: string, userId: string, nextRadiusM: number): OutboxWrite {
  return {
    aggregate: "session",
    aggregateId: sessionId,
    type: "prompt.broaden",
    payload: { userId, nextRadiusM },
  };
}
