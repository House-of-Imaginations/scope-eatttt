import type { AppEvent, Restaurant, SessionState } from "@scope/contract";

export interface TransactionContext {
  txId?: string;
}

export interface OutboxWrite {
  aggregate: "session" | "restaurant" | "poll";
  aggregateId: string;
  type: AppEvent["type"];
  payload: unknown;
}

export interface CreateSessionRecord {
  id: string;
  joinCode: string;
  hostUserId: string;
  lat: number;
  lng: number;
  radiusM: number;
  cuisines: string[];
  createdAt: string;
}

export interface AddMemberRecord {
  id: string;
  sessionId: string;
  userId: string;
  displayName: string;
  isHost: boolean;
  joinedAt: string;
  radiusM?: number;
}

export interface SessionSummary {
  id: string;
  joinCode: string;
  hostUserId?: string;
  status?: SessionState["status"];
  lat?: number;
  lng?: number;
  radiusM?: number;
  cuisines?: string[];
  pollDeadlineAt?: string;
  winnerCandidateId?: string;
}

export interface SessionRepo<Tx = TransactionContext> {
  withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  createSession(tx: Tx, input: CreateSessionRecord): Promise<void>;
  addMember(tx: Tx, input: AddMemberRecord): Promise<void>;
  getSession(tx: Tx, sessionId: string): Promise<SessionSummary | null>;
  getSessionByJoinCode(tx: Tx, joinCode: string): Promise<SessionSummary | null>;
  listMembers(tx: Tx, sessionId: string): Promise<AddMemberRecord[]>;
  isHost(tx: Tx, sessionId: string, userId: string): Promise<boolean>;
  startSwiping(tx: Tx, sessionId: string): Promise<void>;
  insertOutbox(tx: Tx, event: OutboxWrite): Promise<string>;
}

export interface RestaurantCacheRecord {
  restaurant: Restaurant;
  cachedAt: string;
}

export interface PlacesFetchRepo<Tx = TransactionContext> {
  withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  upsertRestaurants(tx: Tx, records: RestaurantCacheRecord[]): Promise<void>;
  insertOutbox(tx: Tx, event: OutboxWrite): Promise<string>;
}

export interface UserLinkRepo {
  reassignUserRows(anonymousUserId: string, newUserId: string): Promise<void>;
}
