import { randomInt } from "node:crypto";
import type { CreateSessionInput, JoinSessionInput } from "@scope/contract";
import { NotHostError } from "../index";
import type { AddMemberRecord, OutboxWrite, SessionRepo, TransactionContext } from "../ports/repo";

const JOIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JOIN_CODE_LENGTH = 10;

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

export interface StartSwipingResult {
  status: "swiping";
}

export async function createSession<Tx>(
  deps: SessionCommandDeps<Tx>,
  input: CreateSessionInput,
  hostUserId: string,
  hostDisplayName = "Host",
  hostImage?: string,
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
      ...(hostImage === undefined ? {} : { image: hostImage }),
      isHost: true,
      joinedAt: now,
    };

    await deps.repo.createSession(tx, {
      id: sessionId,
      joinCode,
      ...(input.title === undefined ? {} : { title: input.title }),
      hostUserId,
      lat: input.lat,
      lng: input.lng,
      radiusM: input.radiusM,
      cuisines: input.cuisines,
      pollDurationSec: input.pollDurationSec ?? 300,
      promoteThreshold: input.promoteThreshold ?? 2,
      createdAt: now,
    });
    await deps.repo.addMember(tx, member);
    await deps.repo.insertOutbox(tx, memberJoinedEvent(sessionId, member));

    return { sessionId, joinCode, memberId };
  });
}

export async function joinSession<Tx>(
  deps: Omit<SessionCommandDeps<Tx>, "ids"> & {
    ids: Pick<SessionCommandIds, "memberId">;
  },
  input: JoinSessionInput,
  userId: string,
  memberImage?: string,
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
      ...(memberImage === undefined ? {} : { image: memberImage }),
      isHost: false,
      joinedAt: deps.now(),
    };

    await deps.repo.addMember(tx, member);
    await deps.repo.insertOutbox(tx, memberJoinedEvent(session.id, member));

    return { sessionId: session.id, memberId: member.id };
  });
}

export async function startSwiping<Tx>(
  deps: Pick<SessionCommandDeps<Tx>, "repo">,
  sessionId: string,
  hostUserId: string,
): Promise<StartSwipingResult> {
  await deps.repo.withTx(async (tx) => {
    await assertHost(deps.repo, tx, sessionId, hostUserId);
    const session = await deps.repo.getSession(tx, sessionId);

    if (!session) {
      throw new Error("Session not found");
    }
    if (session.status === "swiping") {
      return;
    }
    if ((session.status ?? "lobby") !== "lobby") {
      throw new Error("Session cannot start swiping from current status");
    }

    await deps.repo.startSwiping(tx, sessionId);
    await deps.repo.insertOutbox(tx, sessionStartedEvent(sessionId));
  });

  return { status: "swiping" };
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
        ...(member.image === undefined ? {} : { image: member.image }),
        isHost: member.isHost,
        joinedAt: member.joinedAt,
      },
    },
  };
}

function sessionStartedEvent(sessionId: string): OutboxWrite {
  return {
    aggregate: "session",
    aggregateId: sessionId,
    type: "session.started",
    payload: {},
  };
}

async function assertHost<Tx>(
  repo: SessionRepo<Tx>,
  tx: Tx,
  sessionId: string,
  userId: string,
): Promise<void> {
  if (!(await repo.isHost(tx, sessionId, userId))) {
    throw new NotHostError();
  }
}

function normalizeJoinCode(joinCode: string): string {
  return joinCode
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

function randomJoinCode(): string {
  return Array.from(
    { length: JOIN_CODE_LENGTH },
    () => JOIN_CODE_CHARS[randomInt(JOIN_CODE_CHARS.length)],
  ).join("");
}
