import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import type {
  AddMemberRecord,
  CandidateTally,
  CreateSessionRecord,
  OutboxWrite,
  PlacesFetchRepo,
  PollRepo,
  RestaurantCacheRecord,
  SessionRepo,
  SessionSummary,
  SwipeRepo,
  Tally,
  UserLinkRepo,
} from "@scope/core";
import type { Candidate, DashboardHistoryItem, DashboardSessionSummary, Restaurant } from "@scope/contract";
import { lunchSession, outboxEvent, pollCandidate, restaurantCache, sessionMember, swipe, user, vote } from "@scope/db";

type Executor = {
  transaction<T>(fn: (tx: TransactionExecutor) => Promise<T>): Promise<T>;
} & TransactionExecutor;

type TransactionExecutor = {
  insert(table: unknown): unknown;
  select(selection?: unknown): unknown;
  update(table: unknown): unknown;
};

type SessionRow = {
  id: string;
  joinCode: string;
  title?: string | null;
  hostUserId?: string;
  status?: SessionSummary["status"];
  lat?: number;
  lng?: number;
  radiusM?: number;
  cuisines?: string[];
  pollDurationSec?: number;
  promoteThreshold?: number;
  pollDeadlineAt?: Date | string | null;
  winnerCandidateId?: string | null;
  createdAt?: Date | string;
};

type MemberRow = {
  id: string;
  sessionId: string;
  userId: string;
  displayName: string;
  image?: string | null;
  isHost: boolean;
  radiusM?: number;
  joinedAt: Date | string;
};

type IdRow = {
  id: string;
};

type CountRow = {
  count: number;
};

type HostRow = {
  isHost: boolean;
};

type AnonymousUserRow = {
  isAnonymous: boolean | null;
};

type DashboardHistoryRow = {
  id: string;
  title: string | null;
  joinCode: string;
  status: DashboardHistoryItem["status"];
  createdAt: Date | string;
  winnerName: string | null;
};

type CandidateTallyRow = {
  id: string;
  promotedAt: Date | string;
  net: number;
};

type CandidateResultRow = RestaurantRow & {
  candidateId: string;
  promotedAt: Date | string;
  up: number;
  down: number;
  net: number;
};

type RestaurantRow = {
  id: string;
  name: string;
  address: string;
  cuisineTags: string[];
  lat: number | null;
  lng: number | null;
  rating: number | null;
  priceLevel: number | null;
  distanceM: number | null;
};

const sessionSummaryColumns = {
  id: lunchSession.id,
  joinCode: lunchSession.joinCode,
  title: lunchSession.title,
  hostUserId: lunchSession.hostUserId,
  status: lunchSession.status,
  lat: lunchSession.lat,
  lng: lunchSession.lng,
  radiusM: lunchSession.radiusM,
  cuisines: lunchSession.cuisines,
  pollDurationSec: lunchSession.pollDurationSec,
  promoteThreshold: lunchSession.promoteThreshold,
  pollDeadlineAt: lunchSession.pollDeadlineAt,
  winnerCandidateId: lunchSession.winnerCandidateId,
  createdAt: lunchSession.createdAt,
};

const restaurantColumns = {
  id: restaurantCache.id,
  name: restaurantCache.name,
  address: restaurantCache.address,
  cuisineTags: restaurantCache.cuisineTags,
  lat: restaurantCache.lat,
  lng: restaurantCache.lng,
  rating: restaurantCache.rating,
  priceLevel: restaurantCache.priceLevel,
  distanceM: restaurantCache.distanceM,
};

export class DrizzleSessionRepo
  implements
    SessionRepo<TransactionExecutor>,
    SwipeRepo<TransactionExecutor>,
    PollRepo<TransactionExecutor>,
    PlacesFetchRepo<TransactionExecutor>,
    UserLinkRepo
{
  constructor(private readonly db: Executor) {}

  withTx<T>(fn: (tx: TransactionExecutor) => Promise<T>): Promise<T> {
    return this.db.transaction(fn);
  }

  async createSession(tx: TransactionExecutor, input: CreateSessionRecord): Promise<void> {
    await insert(tx, lunchSession)
      .values({
        id: input.id,
        joinCode: input.joinCode,
        title: input.title,
        hostUserId: input.hostUserId,
        lat: input.lat,
        lng: input.lng,
        radiusM: input.radiusM,
        cuisines: input.cuisines,
        pollDurationSec: input.pollDurationSec,
        promoteThreshold: input.promoteThreshold,
        createdAt: new Date(input.createdAt),
        updatedAt: new Date(input.createdAt),
      });
  }

  async addMember(tx: TransactionExecutor, input: AddMemberRecord): Promise<void> {
    await insert(tx, sessionMember)
      .values({
        id: input.id,
        sessionId: input.sessionId,
        userId: input.userId,
        displayName: input.displayName,
        isHost: input.isHost,
        joinedAt: new Date(input.joinedAt),
      });
  }

  async getSession(tx: TransactionExecutor, sessionId: string): Promise<SessionSummary | null> {
    const row = await firstRow<SessionRow>(select(tx, sessionSummaryColumns)
      .from(lunchSession)
      .where(eq(lunchSession.id, sessionId))
      .limit(1));
    return row ? sessionSummary(row) : null;
  }

  async getSessionByJoinCode(tx: TransactionExecutor, joinCode: string): Promise<SessionSummary | null> {
    const row = await firstRow<SessionRow>(select(tx, sessionSummaryColumns)
      .from(lunchSession)
      .where(eq(lunchSession.joinCode, joinCode))
      .limit(1));
    return row ? sessionSummary(row) : null;
  }

  async listMembers(tx: TransactionExecutor, sessionId: string): Promise<AddMemberRecord[]> {
    const rows = await queryRows<MemberRow>(select(tx, {
      id: sessionMember.id,
      sessionId: sessionMember.sessionId,
      userId: sessionMember.userId,
      displayName: sessionMember.displayName,
      image: user.image,
      isHost: sessionMember.isHost,
      radiusM: sessionMember.radiusM,
      joinedAt: sessionMember.joinedAt,
    })
      .from(sessionMember)
      .leftJoin(user, eq(user.id, sessionMember.userId))
      .where(eq(sessionMember.sessionId, sessionId)));
    return rows.map(memberRecord);
  }

  async listSessionsForUser(tx: TransactionExecutor, userId: string): Promise<DashboardHistoryItem[]> {
    const rows = await queryRows<DashboardHistoryRow>(select(tx, {
      id: lunchSession.id,
      title: lunchSession.title,
      joinCode: lunchSession.joinCode,
      status: lunchSession.status,
      createdAt: lunchSession.createdAt,
      winnerName: restaurantCache.name,
    })
      .from(lunchSession)
      .leftJoin(sessionMember, eq(sessionMember.sessionId, lunchSession.id))
      .leftJoin(pollCandidate, eq(pollCandidate.id, lunchSession.winnerCandidateId))
      .leftJoin(restaurantCache, eq(restaurantCache.id, pollCandidate.restaurantId))
      .where(eq(sessionMember.userId, userId))
      .orderBy(desc(lunchSession.createdAt)));
    return uniqueById(rows.map(dashboardHistoryItem));
  }

  async getSessionSummary(tx: TransactionExecutor, sessionId: string, userId: string): Promise<DashboardSessionSummary | null> {
    const session = await this.getSession(tx, sessionId);
    if (!session) {
      return null;
    }

    const members = await this.listMembers(tx, sessionId);
    if (!members.some((member) => member.userId === userId)) {
      return null;
    }

    const candidates = await this.listCandidateResults(tx, sessionId);
    const winnerName = candidates.find((candidate) => candidate.id === session.winnerCandidateId)?.restaurant.name ?? null;
    return {
      id: session.id,
      title: session.title ?? null,
      joinCode: session.joinCode,
      status: session.status ?? "lobby",
      winnerName,
      candidates,
      members,
    };
  }

  async insertOutbox(tx: TransactionExecutor, event: OutboxWrite): Promise<string> {
    const row = await firstRow<IdRow>(insert(tx, outboxEvent)
      .values({
        aggregate: event.aggregate,
        aggregateId: event.aggregateId,
        type: event.type,
        payload: event.payload,
      })
      .returning({ id: outboxEvent.id }));
    return requireReturnedId(row, "outbox_event");
  }

  async upsertRestaurants(tx: TransactionExecutor, records: RestaurantCacheRecord[]): Promise<void> {
    for (const record of records) {
      const row = toRestaurantCacheRow(record);
      await insert(tx, restaurantCache)
        .values(row)
        .onConflictDoUpdate({
          target: restaurantCache.id,
          set: row,
        });
    }
  }

  async getRestaurant(tx: TransactionExecutor, restaurantId: string): Promise<Restaurant | null> {
    const row = await firstRow<RestaurantRow>(select(tx, restaurantColumns)
      .from(restaurantCache)
      .where(eq(restaurantCache.id, restaurantId))
      .limit(1));
    return row ? restaurantRecord(row) : null;
  }

  async listDeckRestaurants(tx: TransactionExecutor, sessionId: string, memberId: string, limit: number): Promise<Restaurant[]> {
    const rows = await queryRows<RestaurantRow>(select(tx, restaurantColumns)
      .from(restaurantCache)
      .leftJoin(
        swipe,
        and(eq(swipe.restaurantId, restaurantCache.id), eq(swipe.sessionId, sessionId), eq(swipe.memberId, memberId)),
      )
      .where(isNull(swipe.id))
      .orderBy(desc(restaurantCache.cachedAt))
      .limit(limit));
    return rows.map(restaurantRecord);
  }

  async recordSwipe(
    tx: TransactionExecutor,
    input: { sessionId: string; userId: string; memberId: string; restaurantId: string; decision: "accept" | "reject"; swipedAt: string },
  ): Promise<{ created: boolean }> {
    const rows = await queryRows<IdRow>(insert(tx, swipe)
      .values({
        sessionId: input.sessionId,
        userId: input.userId,
        memberId: input.memberId,
        restaurantId: input.restaurantId,
        decision: input.decision,
        createdAt: new Date(input.swipedAt),
      })
      .onConflictDoNothing({ target: [swipe.sessionId, swipe.memberId, swipe.restaurantId] })
      .returning({ id: swipe.id }));
    return { created: rows.length > 0 };
  }

  async countAccepts(tx: TransactionExecutor, sessionId: string, restaurantId: string): Promise<number> {
    const row = await firstRow<CountRow>(select(tx, { count: count() })
      .from(swipe)
      .where(and(eq(swipe.sessionId, sessionId), eq(swipe.restaurantId, restaurantId), eq(swipe.decision, "accept"))));
    return Number(row?.count ?? 0);
  }

  async isCandidate(tx: TransactionExecutor, sessionId: string, restaurantId: string): Promise<boolean> {
    return (await findCandidateId(tx, sessionId, restaurantId)) !== undefined;
  }

  async addCandidate(
    tx: TransactionExecutor,
    input: { sessionId: string; restaurantId: string; promotedAt: string },
  ): Promise<{ candidateId: string }> {
    const inserted = await firstRow<IdRow>(insert(tx, pollCandidate)
      .values({
        sessionId: input.sessionId,
        restaurantId: input.restaurantId,
        promotedAt: new Date(input.promotedAt),
      })
      .onConflictDoNothing({ target: [pollCandidate.sessionId, pollCandidate.restaurantId] })
      .returning({ id: pollCandidate.id }));

    if (inserted) {
      return { candidateId: inserted.id };
    }

    const existing = await findCandidateId(tx, input.sessionId, input.restaurantId);
    return { candidateId: requireReturnedId(existing, "poll_candidate") };
  }

  async updateMemberRadius(tx: TransactionExecutor, sessionId: string, memberId: string, radiusM: number): Promise<void> {
    await update(tx, sessionMember)
      .set({ radiusM })
      .where(and(eq(sessionMember.sessionId, sessionId), eq(sessionMember.id, memberId)));
  }

  async isHost(tx: TransactionExecutor, sessionId: string, userId: string): Promise<boolean> {
    const row = await firstRow<HostRow>(select(tx, { isHost: sessionMember.isHost })
      .from(sessionMember)
      .where(and(eq(sessionMember.sessionId, sessionId), eq(sessionMember.userId, userId)))
      .limit(1));
    return row?.isHost ?? false;
  }

  async startPoll(tx: TransactionExecutor, sessionId: string, deadlineAt: string): Promise<void> {
    await update(tx, lunchSession)
      .set({ status: "polling", pollDeadlineAt: new Date(deadlineAt), updatedAt: new Date(deadlineAt) })
      .where(eq(lunchSession.id, sessionId));
  }

  async startSwiping(tx: TransactionExecutor, sessionId: string): Promise<void> {
    await update(tx, lunchSession)
      .set({ status: "swiping", updatedAt: new Date() })
      .where(and(eq(lunchSession.id, sessionId), eq(lunchSession.status, "lobby")));
  }

  async upsertVote(
    tx: TransactionExecutor,
    input: { sessionId: string; candidateId: string; userId: string; memberId: string; value: 1 | -1 },
  ): Promise<void> {
    await insert(tx, vote)
      .values(input)
      .onConflictDoUpdate({
        target: [vote.sessionId, vote.candidateId, vote.memberId],
        set: { value: input.value },
      });
  }

  async candidateBelongsToSession(tx: TransactionExecutor, sessionId: string, candidateId: string): Promise<boolean> {
    const row = await firstRow<IdRow>(select(tx, { id: pollCandidate.id })
      .from(pollCandidate)
      .where(and(eq(pollCandidate.id, candidateId), eq(pollCandidate.sessionId, sessionId)))
      .limit(1));
    return row !== undefined;
  }

  async tally(tx: TransactionExecutor, candidateId: string): Promise<Tally> {
    const row = await firstRow<Tally>(select(tx, {
      up: sql<number>`cast(count(*) filter (where ${vote.value} = 1) as int)`,
      down: sql<number>`cast(count(*) filter (where ${vote.value} = -1) as int)`,
      net: sql<number>`cast(coalesce(sum(${vote.value}), 0) as int)`,
    })
      .from(vote)
      .where(eq(vote.candidateId, candidateId)));
    return { up: Number(row?.up ?? 0), down: Number(row?.down ?? 0), net: Number(row?.net ?? 0) };
  }

  async listCandidatesWithTally(tx: TransactionExecutor, sessionId: string): Promise<CandidateTally[]> {
    const rows = await queryRows<CandidateTallyRow>(select(tx, {
      id: pollCandidate.id,
      promotedAt: pollCandidate.promotedAt,
      net: sql<number>`cast(coalesce(sum(${vote.value}), 0) as int)`,
    })
      .from(pollCandidate)
      .leftJoin(vote, eq(vote.candidateId, pollCandidate.id))
      .where(eq(pollCandidate.sessionId, sessionId))
      .groupBy(pollCandidate.id)
      .orderBy(asc(pollCandidate.promotedAt)));

    return rows.map(candidateTally);
  }

  async listCandidateResults(tx: TransactionExecutor, sessionId: string): Promise<Candidate[]> {
    const rows = await queryRows<CandidateResultRow>(select(tx, {
      candidateId: pollCandidate.id,
      promotedAt: pollCandidate.promotedAt,
      ...restaurantColumns,
      up: sql<number>`cast(count(*) filter (where ${vote.value} = 1) as int)`,
      down: sql<number>`cast(count(*) filter (where ${vote.value} = -1) as int)`,
      net: sql<number>`cast(coalesce(sum(${vote.value}), 0) as int)`,
    })
      .from(pollCandidate)
      .leftJoin(restaurantCache, eq(restaurantCache.id, pollCandidate.restaurantId))
      .leftJoin(vote, eq(vote.candidateId, pollCandidate.id))
      .where(eq(pollCandidate.sessionId, sessionId))
      .groupBy(
        pollCandidate.id,
        restaurantCache.id,
        restaurantCache.name,
        restaurantCache.address,
        restaurantCache.cuisineTags,
        restaurantCache.lat,
        restaurantCache.lng,
        restaurantCache.rating,
        restaurantCache.priceLevel,
        restaurantCache.distanceM,
      )
      .orderBy(asc(pollCandidate.promotedAt)));

    return rows.map(candidateResult);
  }

  async closePoll(tx: TransactionExecutor, sessionId: string, winnerCandidateId: string): Promise<boolean> {
    const rows = await update(tx, lunchSession)
      .set({ status: "decided", winnerCandidateId, updatedAt: new Date() })
      .where(and(eq(lunchSession.id, sessionId), eq(lunchSession.status, "polling")))
      .returning({ id: lunchSession.id });
    return rows.length > 0;
  }

  async reassignUserRows(anonymousUserId: string, newUserId: string): Promise<void> {
    await this.withTx(async (tx) => {
      await update(tx, lunchSession)
        .set({ hostUserId: newUserId })
        .where(eq(lunchSession.hostUserId, anonymousUserId));
      await update(tx, sessionMember)
        .set({ userId: newUserId })
        .where(eq(sessionMember.userId, anonymousUserId));
      await update(tx, swipe)
        .set({ userId: newUserId })
        .where(eq(swipe.userId, anonymousUserId));
      await update(tx, vote)
        .set({ userId: newUserId })
        .where(eq(vote.userId, anonymousUserId));
    });
  }

  async isAnonymousUser(userId: string): Promise<boolean> {
    const row = await firstRow<AnonymousUserRow>(select(this.db, { isAnonymous: user.isAnonymous })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1));
    return row?.isAnonymous === true;
  }
}

function insert(tx: TransactionExecutor, table: unknown): InsertBuilder {
  return tx.insert(table) as InsertBuilder;
}

function select(tx: TransactionExecutor, selection?: unknown): SelectBuilder {
  return tx.select(selection) as SelectBuilder;
}

function update(tx: TransactionExecutor, table: unknown): UpdateBuilder {
  return tx.update(table) as UpdateBuilder;
}

function findCandidateId(tx: TransactionExecutor, sessionId: string, restaurantId: string): Promise<IdRow | undefined> {
  return firstRow<IdRow>(select(tx, { id: pollCandidate.id })
    .from(pollCandidate)
    .where(and(eq(pollCandidate.sessionId, sessionId), eq(pollCandidate.restaurantId, restaurantId)))
    .limit(1));
}

interface InsertBuilder {
  values(values: unknown): InsertConflictBuilder;
}

interface InsertConflictBuilder extends PromiseLike<unknown[]> {
  onConflictDoNothing(options?: unknown): InsertReturningBuilder;
  onConflictDoUpdate(options: unknown): InsertReturningBuilder;
  returning(selection?: unknown): Promise<unknown[]>;
}

interface InsertReturningBuilder extends PromiseLike<unknown[]> {
  returning(selection?: unknown): Promise<unknown[]>;
}

interface SelectBuilder {
  from(table: unknown): SelectChain;
}

interface SelectChain extends PromiseLike<unknown[]> {
  where(condition: unknown): SelectChain;
  leftJoin(table: unknown, condition: unknown): SelectChain;
  groupBy(...columns: unknown[]): SelectChain;
  orderBy(...columns: unknown[]): SelectChain;
  limit(count: number): Promise<unknown[]>;
}

interface UpdateBuilder {
  set(values: unknown): { where(condition: unknown): UpdateWhereBuilder };
}

interface UpdateWhereBuilder extends PromiseLike<unknown[]> {
  returning(selection?: unknown): Promise<unknown[]>;
}

async function queryRows<T>(query: PromiseLike<unknown[]>): Promise<T[]> {
  return (await query) as T[];
}

async function firstRow<T>(query: PromiseLike<unknown[]>): Promise<T | undefined> {
  const [row] = await queryRows<T>(query);
  return row;
}

function sessionSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    joinCode: row.joinCode,
    ...(row.title === undefined ? {} : { title: row.title }),
    ...(row.hostUserId === undefined ? {} : { hostUserId: row.hostUserId }),
    ...(row.status === undefined ? {} : { status: row.status }),
    ...(row.lat === undefined ? {} : { lat: row.lat }),
    ...(row.lng === undefined ? {} : { lng: row.lng }),
    ...(row.radiusM === undefined ? {} : { radiusM: row.radiusM }),
    ...(row.cuisines === undefined ? {} : { cuisines: row.cuisines }),
    ...(row.pollDurationSec === undefined ? {} : { pollDurationSec: row.pollDurationSec }),
    ...(row.promoteThreshold === undefined ? {} : { promoteThreshold: row.promoteThreshold }),
    ...(row.pollDeadlineAt === undefined || row.pollDeadlineAt === null ? {} : { pollDeadlineAt: toIso(row.pollDeadlineAt) }),
    ...(row.winnerCandidateId === undefined || row.winnerCandidateId === null ? {} : { winnerCandidateId: row.winnerCandidateId }),
  };
}

function memberRecord(row: MemberRow): AddMemberRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    userId: row.userId,
    displayName: row.displayName,
    ...(row.image === undefined || row.image === null ? {} : { image: row.image }),
    isHost: row.isHost,
    ...(row.radiusM === undefined ? {} : { radiusM: row.radiusM }),
    joinedAt: toIso(row.joinedAt),
  };
}

function dashboardHistoryItem(row: DashboardHistoryRow): DashboardHistoryItem {
  return {
    id: row.id,
    title: row.title,
    joinCode: row.joinCode,
    status: row.status,
    createdAt: toIso(row.createdAt),
    winnerName: row.winnerName,
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function candidateTally(row: CandidateTallyRow): CandidateTally {
  return {
    id: row.id,
    promotedAt: toIso(row.promotedAt),
    net: Number(row.net),
  };
}

function restaurantRecord(row: RestaurantRow): Restaurant {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    cuisineTags: row.cuisineTags,
    ...(row.lat === null ? {} : { lat: row.lat }),
    ...(row.lng === null ? {} : { lng: row.lng }),
    ...(row.rating === null ? {} : { rating: row.rating }),
    ...(row.priceLevel === null ? {} : { priceLevel: row.priceLevel }),
    ...(row.distanceM === null ? {} : { distanceM: row.distanceM }),
  };
}

function candidateResult(row: CandidateResultRow): Candidate {
  return {
    id: row.candidateId,
    restaurant: restaurantRecord(row),
    promotedAt: toIso(row.promotedAt),
    upvotes: Number(row.up ?? 0),
    downvotes: Number(row.down ?? 0),
    netScore: Number(row.net ?? 0),
  };
}

function toRestaurantCacheRow(record: RestaurantCacheRecord): Record<string, unknown> {
  return {
    id: record.restaurant.id,
    name: record.restaurant.name,
    address: record.restaurant.address,
    cuisineTags: record.restaurant.cuisineTags,
    lat: record.restaurant.lat,
    lng: record.restaurant.lng,
    rating: record.restaurant.rating,
    priceLevel: record.restaurant.priceLevel,
    distanceM: record.restaurant.distanceM,
    cachedAt: new Date(record.cachedAt),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function requireReturnedId(row: { id: string } | undefined, table: string): string {
  if (!row) {
    throw new Error(`${table} insert did not return an id`);
  }
  return row.id;
}
