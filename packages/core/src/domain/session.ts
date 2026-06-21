import type { CreateSessionInput, JoinSessionInput } from "@scope/contract";
import type { AddMemberRecord, OutboxWrite, SessionRepo, TransactionContext } from "../ports/repo";

export interface SessionCommandIds {
  sessionId?: () => string;
  memberId: () => string;
  joinCode?: () => string;
}

export interface SessionCommandDeps<Tx = TransactionContext> {
  repo: SessionRepo<Tx>;
  ids: SessionCommandIds;
  now: () => string;
}

export interface CreateSessionResult {
  sessionId: string;
  joinCode: string;
  memberId: string;
}

export interface JoinSessionResult {
  sessionId: string;
  memberId: string;
}

export async function createSession<Tx>(
  deps: SessionCommandDeps<Tx>,
  input: CreateSessionInput,
  hostUserId: string,
  hostDisplayName = "Host",
): Promise<CreateSessionResult> {
  return deps.repo.withTx(async (tx) => {
    const sessionId = deps.ids.sessionId?.() ?? crypto.randomUUID();
    const memberId = deps.ids.memberId();
    const joinCode = normalizeJoinCode(deps.ids.joinCode?.() ?? randomJoinCode());
    const now = deps.now();
    const member: AddMemberRecord = {
      id: memberId,
      sessionId,
      userId: hostUserId,
      displayName: hostDisplayName,
      isHost: true,
      joinedAt: now,
    };

    await deps.repo.createSession(tx, {
      id: sessionId,
      joinCode,
      hostUserId,
      lat: input.lat,
      lng: input.lng,
      radiusM: input.radiusM,
      cuisines: input.cuisines,
      createdAt: now,
    });
    await deps.repo.addMember(tx, member);
    await deps.repo.insertOutbox(tx, memberJoinedEvent(sessionId, member));

    return { sessionId, joinCode, memberId };
  });
}

export async function joinSession<Tx>(
  deps: Omit<SessionCommandDeps<Tx>, "ids"> & { ids: Pick<SessionCommandIds, "memberId"> },
  input: JoinSessionInput,
  userId: string,
): Promise<JoinSessionResult> {
  return deps.repo.withTx(async (tx) => {
    const joinCode = normalizeJoinCode(input.joinCode);
    const session = await deps.repo.getSessionByJoinCode(tx, joinCode);

    if (!session) {
      throw new Error("Session not found");
    }

    const member: AddMemberRecord = {
      id: deps.ids.memberId(),
      sessionId: session.id,
      userId,
      displayName: input.displayName,
      isHost: false,
      joinedAt: deps.now(),
    };

    await deps.repo.addMember(tx, member);
    await deps.repo.insertOutbox(tx, memberJoinedEvent(session.id, member));

    return { sessionId: session.id, memberId: member.id };
  });
}

function memberJoinedEvent(sessionId: string, member: AddMemberRecord): OutboxWrite {
  return {
    aggregate: "session",
    aggregateId: sessionId,
    type: "member.joined",
    payload: {
      member: {
        id: member.id,
        userId: member.userId,
        displayName: member.displayName,
        isHost: member.isHost,
        joinedAt: member.joinedAt,
      },
    },
  };
}

function normalizeJoinCode(joinCode: string): string {
  return joinCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function randomJoinCode(): string {
  return Math.random().toString(36).slice(2, 8);
}
