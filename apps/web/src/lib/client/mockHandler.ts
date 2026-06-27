import type {
  Restaurant,
  Candidate,
  SessionState,
  Member,
  AppEvent,
} from "@scope/contract";
// Input types: use the schema .parse() parameter type so defaulted fields are optional
// (matching real oRPC behaviour where callers omit fields that have Zod defaults)
type CreateIn = { lat: number; lng: number; cuisines?: string[]; radiusM?: number };
type JoinIn = { joinCode: string; displayName: string };
type SessionIdIn = { sessionId: string; memberId?: string };
type SwipeIn = SessionIdIn & { restaurantId: string; decision: "accept" | "reject"; deckLeft?: number };
type DeckIn = SessionIdIn & { limit?: number };
type BroadenIn = SessionIdIn & { userId: string; stepM?: number };
type StartPollIn = SessionIdIn & { timerMs?: number };
type VoteIn = SessionIdIn & { candidateId: string; value: 1 | -1 };
type ClosePollIn = SessionIdIn;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FIXTURE_RESTAURANTS: Restaurant[] = [
  { id: "r1", name: "Sakura Ramen", address: "1 Main St", cuisineTags: ["japanese", "ramen"], lat: 1, lng: 2, rating: 4.5, priceLevel: 2, distanceM: 300 },
  { id: "r2", name: "Taco Loco", address: "2 Main St", cuisineTags: ["mexican", "tacos"], lat: 1.001, lng: 2.001, rating: 4.2, priceLevel: 1, distanceM: 400 },
  { id: "r3", name: "Pizza Roma", address: "3 Main St", cuisineTags: ["italian", "pizza"], lat: 1.002, lng: 2.002, rating: 4.0, priceLevel: 2, distanceM: 450 },
  { id: "r4", name: "Burger Joint", address: "4 Main St", cuisineTags: ["american", "burgers"], lat: 1.003, lng: 2.003, rating: 3.9, priceLevel: 1, distanceM: 500 },
  { id: "r5", name: "Thai Palace", address: "5 Main St", cuisineTags: ["thai"], lat: 1.004, lng: 2.004, rating: 4.3, priceLevel: 2, distanceM: 350 },
  { id: "r6", name: "Dim Sum House", address: "6 Main St", cuisineTags: ["chinese", "dim-sum"], lat: 1.005, lng: 2.005, rating: 4.6, priceLevel: 2, distanceM: 420 },
  { id: "r7", name: "Le Bistro", address: "7 Main St", cuisineTags: ["french"], lat: 1.006, lng: 2.006, rating: 4.4, priceLevel: 3, distanceM: 480 },
  { id: "r8", name: "Kebab King", address: "8 Main St", cuisineTags: ["turkish", "kebab"], lat: 1.007, lng: 2.007, rating: 4.1, priceLevel: 1, distanceM: 390 },
  { id: "r9", name: "Sushi Zen", address: "9 Main St", cuisineTags: ["japanese", "sushi"], lat: 1.008, lng: 2.008, rating: 4.7, priceLevel: 3, distanceM: 460 },
  { id: "r10", name: "Veggie Garden", address: "10 Main St", cuisineTags: ["vegetarian", "vegan"], lat: 1.009, lng: 2.009, rating: 4.0, priceLevel: 2, distanceM: 370 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function makeJoinCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const PROMOTE_THRESHOLD = 2;

// ── Internal state types ──────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  joinCode: string;
  status: SessionState["status"];
  hostUserId: string;
  lat: number;
  lng: number;
  radiusM: number;
  cuisines: string[];
  members: Member[];
  candidates: Candidate[];
  pollDeadlineAt: string | undefined;
  winnerCandidateId: string | undefined;
  events: AppEvent[];
}

// accepts[restaurantId] = Set of userIds that accepted
type AcceptsMap = Map<string, Set<string>>;
type VotesMap = Map<string, Map<string, 1 | -1>>;

interface MockState {
  idCounter: number;
  sessions: Map<string, SessionRow>;
  codeIndex: Map<string, string>;
  accepts: AcceptsMap;
  votes: VotesMap;
  nextSwipeUser: Map<string, string>;
}

export interface MockApi {
  session: {
    create(input: CreateIn): Promise<{ sessionId: string; joinCode: string; memberId: string }>;
    join(input: JoinIn): Promise<{ sessionId: string; memberId: string }>;
    startSwiping(input: SessionIdIn): Promise<{ status: "swiping" }>;
    state(input: SessionIdIn): Promise<SessionState | null>;
    eventsSince(input: SessionIdIn & { afterEventId?: string }): Promise<AppEvent[]>;
  };
  swipe: {
    decide(input: SwipeIn): Promise<{ promoted: boolean; candidate?: Candidate }>;
    deck(input: DeckIn): Promise<Restaurant[]>;
    broaden(input: BroadenIn): Promise<{ radiusM: number; restaurants: Restaurant[] }>;
  };
  poll: {
    start(input: StartPollIn): Promise<{ deadlineAt: string }>;
    results(input: SessionIdIn): Promise<Candidate[]>;
    vote(input: VoteIn): Promise<{ candidateId: string; netScore: number }>;
    close(input: ClosePollIn): Promise<{ winnerCandidateId: string }>;
  };
}

const MOCK_STATE_KEY = "scope-eatttt:mock-state:v1";
const MOCK_EVENT_KEY = "scope-eatttt:mock-event:v1";
const MOCK_EVENT_CHANNEL = "scope-eatttt:mock-events";
const MOCK_FAIL_POLL_START_KEY = "scope-eatttt:mock-fail-poll-start";
const MOCK_USER_PREFIX = "scope-eatttt:mock-user:";

let memoryState = emptyState();

function emptyState(): MockState {
  return {
    idCounter: 0,
    sessions: new Map(),
    codeIndex: new Map(),
    accepts: new Map(),
    votes: new Map(),
    nextSwipeUser: new Map(),
  };
}

function hasBrowserStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function loadState(): MockState {
  if (!hasBrowserStorage()) return memoryState;
  const raw = window.localStorage.getItem(MOCK_STATE_KEY);
  if (!raw) return emptyState();
  try {
    return deserializeState(JSON.parse(raw) as SerializedMockState);
  } catch {
    return emptyState();
  }
}

function saveState(state: MockState): void {
  memoryState = state;
  if (hasBrowserStorage()) {
    window.localStorage.setItem(MOCK_STATE_KEY, JSON.stringify(serializeState(state)));
  }
}

function nextId(state: MockState): string {
  state.idCounter += 1;
  const hex = state.idCounter.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

function getCurrentUserId(state: MockState, sessionId: string, row: SessionRow): string {
  if (typeof window !== "undefined" && typeof window.sessionStorage !== "undefined") {
    return window.sessionStorage.getItem(`${MOCK_USER_PREFIX}${sessionId}`) ?? row.hostUserId;
  }
  return state.nextSwipeUser.get(sessionId) ?? row.hostUserId;
}

function getCurrentMemberId(state: MockState, input: SessionIdIn, row: SessionRow): string {
  if (input.memberId) return input.memberId;
  const userId = getCurrentUserId(state, input.sessionId, row);
  return row.members.find((member) => member.userId === userId)?.id ?? row.members[0]!.id;
}

function setCurrentUserId(state: MockState, sessionId: string, userId: string): void {
  state.nextSwipeUser.set(sessionId, userId);
  if (typeof window !== "undefined" && typeof window.sessionStorage !== "undefined") {
    window.sessionStorage.setItem(`${MOCK_USER_PREFIX}${sessionId}`, userId);
  }
}

function shouldRotateUsers(): boolean {
  return typeof window === "undefined" || typeof window.sessionStorage === "undefined";
}

function publishMockEvent(event: AppEvent): void {
  if (!hasBrowserStorage()) return;
  const packet = JSON.stringify({ id: `${Date.now()}:${Math.random()}`, event });
  window.localStorage.setItem(MOCK_EVENT_KEY, packet);
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel(MOCK_EVENT_CHANNEL);
    channel.postMessage(event);
    channel.close();
  }
}

export function subscribeMockEvents(sessionId: string, onEvent: (event: AppEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const receive = (event: AppEvent) => {
    if (event.sessionId === sessionId) onEvent(event);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== MOCK_EVENT_KEY || !event.newValue) return;
    try {
      receive((JSON.parse(event.newValue) as { event: AppEvent }).event);
    } catch {
      // ponytail: ignore malformed mock packets; real SSE path owns validation.
    }
  };
  window.addEventListener("storage", onStorage);

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(MOCK_EVENT_CHANNEL);
    channel.onmessage = (message: MessageEvent<AppEvent>) => receive(message.data);
  }

  return () => {
    window.removeEventListener("storage", onStorage);
    channel?.close();
  };
}

interface SerializedMockState {
  idCounter: number;
  sessions: [string, SessionRow][];
  codeIndex: [string, string][];
  accepts: [string, string[]][];
  votes: [string, [string, 1 | -1][]][];
  nextSwipeUser: [string, string][];
}

function serializeState(state: MockState): SerializedMockState {
  return {
    idCounter: state.idCounter,
    sessions: [...state.sessions.entries()],
    codeIndex: [...state.codeIndex.entries()],
    accepts: [...state.accepts.entries()].map(([key, value]) => [key, [...value]]),
    votes: [...state.votes.entries()].map(([key, value]) => [key, [...value.entries()]]),
    nextSwipeUser: [...state.nextSwipeUser.entries()],
  };
}

function deserializeState(raw: SerializedMockState): MockState {
  return {
    idCounter: raw.idCounter ?? 0,
    sessions: new Map(raw.sessions ?? []),
    codeIndex: new Map(raw.codeIndex ?? []),
    accepts: new Map((raw.accepts ?? []).map(([key, value]) => [key, new Set(value)])),
    votes: new Map((raw.votes ?? []).map(([key, value]) => [key, new Map(value)])),
    nextSwipeUser: new Map(raw.nextSwipeUser ?? []),
  };
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function makeMockApi(): MockApi {
  function getSession(sessionId: string): SessionRow {
    const state = loadState();
    const s = state.sessions.get(sessionId);
    if (!s) throw new Error(`Session ${sessionId} not found`);
    return s;
  }

  function getRestaurantById(id: string): Restaurant {
    const r = FIXTURE_RESTAURANTS.find((x) => x.id === id);
    if (r) return r;
    return {
      id,
      name: `Restaurant ${id}`,
      address: `${id} Street`,
      cuisineTags: ["misc"],
    };
  }

  return {
    session: {
      async create(input) {
        const state = loadState();
        const sessionId = nextId(state);
        const joinCode = makeJoinCode();
        const hostUserId = "user-host";
        const hostMember: Member = {
          id: nextId(state),
          userId: hostUserId,
          displayName: "Host",
          isHost: true,
          joinedAt: nowIso(),
        };
        const row: SessionRow = {
          id: sessionId,
          joinCode,
          status: "lobby",
          hostUserId,
          lat: input.lat,
          lng: input.lng,
          radiusM: input.radiusM ?? 500,
          cuisines: input.cuisines ?? [],
          members: [hostMember],
          candidates: [],
          pollDeadlineAt: undefined,
          winnerCandidateId: undefined,
          events: [],
        };
        state.sessions.set(sessionId, row);
        state.codeIndex.set(joinCode.toUpperCase(), sessionId);
        setCurrentUserId(state, sessionId, hostUserId);
        saveState(state);
        return { sessionId, joinCode, memberId: hostMember.id };
      },

      async join(input) {
        const state = loadState();
        const code = input.joinCode.toUpperCase();
        // ponytail: create-on-join for unknown codes — a joiner is usually on a
        // different device than the host, so the session won't exist in this
        // page's in-memory mock. Synthesize a lobby session so /join/<code> works
        // standalone (real backend looks the code up in Postgres).
        let sessionId = state.codeIndex.get(code);
        if (!sessionId) {
          sessionId = nextId(state);
          const hostUserId = "user-host";
          state.sessions.set(sessionId, {
            id: sessionId,
            joinCode: code,
            status: "lobby",
            hostUserId,
            lat: 0,
            lng: 0,
            radiusM: 500,
            cuisines: [],
            members: [{ id: nextId(state), userId: hostUserId, displayName: "Host", isHost: true, joinedAt: nowIso() }],
            candidates: [],
            pollDeadlineAt: undefined,
            winnerCandidateId: undefined,
            events: [],
          });
          state.codeIndex.set(code, sessionId);
          state.nextSwipeUser.set(sessionId, hostUserId);
        }
        const row = state.sessions.get(sessionId)!;
        const memberId = nextId(state);
        const userId = `user-${memberId}`;
        const member: Member = {
          id: memberId,
          userId,
          displayName: input.displayName,
          isHost: false,
          joinedAt: nowIso(),
        };
        row.members.push(member);
        setCurrentUserId(state, sessionId, userId);
        const event: AppEvent = {
          id: nextId(state),
          sessionId,
          occurredAt: nowIso(),
          type: "member.joined",
          member,
        };
        row.events.push(event);
        saveState(state);
        publishMockEvent(event);
        return { sessionId, memberId };
      },

      async startSwiping(input) {
        const state = loadState();
        const row = state.sessions.get(input.sessionId);
        if (!row) throw new Error(`Session ${input.sessionId} not found`);
        if (row.status === "lobby") {
          row.status = "swiping";
          const event: AppEvent = {
            id: nextId(state),
            sessionId: input.sessionId,
            occurredAt: nowIso(),
            type: "session.started",
          };
          row.events.push(event);
          saveState(state);
          publishMockEvent(event);
        }
        return { status: "swiping" };
      },

      async state(input) {
        const mockState = loadState();
        const row = mockState.sessions.get(input.sessionId);
        if (!row) return null;
        const member = input.memberId
          ? row.members.find((candidate) => candidate.id === input.memberId)
          : undefined;
        const userId = member?.userId ?? getCurrentUserId(mockState, input.sessionId, row);
        const sessionState: SessionState = {
          id: row.id,
          joinCode: row.joinCode,
          status: row.status,
          hostUserId: row.hostUserId,
          viewerIsHost: row.hostUserId === userId,
          lat: row.lat,
          lng: row.lng,
          radiusM: row.radiusM,
          cuisines: row.cuisines,
          members: row.members,
          candidates: row.candidates,
          ...(row.pollDeadlineAt !== undefined ? { pollDeadlineAt: row.pollDeadlineAt } : {}),
          ...(row.winnerCandidateId !== undefined ? { winnerCandidateId: row.winnerCandidateId } : {}),
        };
        return sessionState;
      },

      async eventsSince(input) {
        const state = loadState();
        const row = state.sessions.get(input.sessionId);
        if (!row) return [];
        if (!input.afterEventId) return row.events;
        const idx = row.events.findIndex((e) => e.id === input.afterEventId);
        return idx === -1 ? row.events : row.events.slice(idx + 1);
      },
    },

    swipe: {
      async decide(input) {
        const state = loadState();
        const row = state.sessions.get(input.sessionId);
        if (!row) throw new Error(`Session ${input.sessionId} not found`);
        const memberId = getCurrentMemberId(state, input, row);
        const userId = row.members.find((member) => member.id === memberId)?.userId ?? getCurrentUserId(state, input.sessionId, row);

        if (input.decision === "reject") {
          return { promoted: false };
        }

        const acceptKey = `${input.sessionId}:${input.restaurantId}`;
        if (!state.accepts.has(acceptKey)) {
          state.accepts.set(acceptKey, new Set());
        }
        const acceptSet = state.accepts.get(acceptKey)!;
        acceptSet.add(memberId);

        if (shouldRotateUsers()) {
          const members = row.members;
          const curIdx = members.findIndex((m) => m.userId === userId);
          const nextIdx = (curIdx + 1) % members.length;
          state.nextSwipeUser.set(input.sessionId, members[nextIdx]!.userId);
        }

        if (acceptSet.size >= PROMOTE_THRESHOLD) {
          // Already promoted?
          const existing = row.candidates.find(
            (c) => c.restaurant.id === input.restaurantId
          );
          if (existing) {
            return { promoted: false, candidate: existing };
          }
          const restaurant = getRestaurantById(input.restaurantId);
          const candidate: Candidate = {
            id: nextId(state),
            restaurant,
            promotedAt: nowIso(),
            upvotes: 0,
            downvotes: 0,
            netScore: 0,
          };
          row.candidates.push(candidate);
          state.votes.set(candidate.id, new Map());
          const event: AppEvent = {
            id: nextId(state),
            sessionId: input.sessionId,
            occurredAt: nowIso(),
            type: "restaurant.promoted",
            candidateId: candidate.id,
            restaurant,
            promotedAt: candidate.promotedAt,
          };
          row.events.push(event);
          saveState(state);
          publishMockEvent(event);
          return { promoted: true, candidate };
        }

        saveState(state);
        return { promoted: false };
      },

      async deck(input) {
        const limit = input.limit ?? 10;
        return FIXTURE_RESTAURANTS.slice(0, limit);
      },

      async broaden(input) {
        const state = loadState();
        const row = state.sessions.get(input.sessionId);
        if (!row) throw new Error(`Session ${input.sessionId} not found`);
        const step = input.stepM ?? 500;
        row.radiusM = row.radiusM + step;
        saveState(state);
        return { radiusM: row.radiusM, restaurants: FIXTURE_RESTAURANTS };
      },
    },

    poll: {
      async start(input) {
        if (typeof window !== "undefined" && typeof window.sessionStorage !== "undefined") {
          const forcedError = window.sessionStorage.getItem(MOCK_FAIL_POLL_START_KEY);
          if (forcedError) {
            window.sessionStorage.removeItem(MOCK_FAIL_POLL_START_KEY);
            throw new Error(forcedError);
          }
        }
        const state = loadState();
        const row = state.sessions.get(input.sessionId);
        if (!row) throw new Error(`Session ${input.sessionId} not found`);
        const timerMs = input.timerMs ?? 300_000;
        const deadlineAt = new Date(Date.now() + timerMs).toISOString();
        row.pollDeadlineAt = deadlineAt;
        row.status = "polling";
        const event: AppEvent = {
          id: nextId(state),
          sessionId: input.sessionId,
          occurredAt: nowIso(),
          type: "poll.opened",
          deadlineAt,
        };
        row.events.push(event);
        saveState(state);
        publishMockEvent(event);
        return { deadlineAt };
      },

      async results(input) {
        const row = getSession(input.sessionId);
        return row.candidates;
      },

      async vote(input) {
        const state = loadState();
        const row = state.sessions.get(input.sessionId);
        if (!row) throw new Error(`Session ${input.sessionId} not found`);
        const cand = row.candidates.find((c) => c.id === input.candidateId);
        if (!cand) throw new Error(`Candidate ${input.candidateId} not found`);

        const memberId = getCurrentMemberId(state, input, row);
        const userId = row.members.find((member) => member.id === memberId)?.userId ?? getCurrentUserId(state, input.sessionId, row);
        if (!state.votes.has(input.candidateId)) {
          state.votes.set(input.candidateId, new Map());
        }
        const voteMap = state.votes.get(input.candidateId)!;
        const prev = voteMap.get(memberId);
        if (prev === 1) cand.upvotes -= 1;
        else if (prev === -1) cand.downvotes -= 1;
        voteMap.set(memberId, input.value);
        if (input.value === 1) cand.upvotes += 1;
        else cand.downvotes += 1;
        cand.netScore = cand.upvotes - cand.downvotes;

        const event: AppEvent = {
          id: nextId(state),
          sessionId: input.sessionId,
          occurredAt: nowIso(),
          type: "vote.cast",
          candidateId: input.candidateId,
          userId,
          value: input.value,
          tally: {
            upvotes: cand.upvotes,
            downvotes: cand.downvotes,
            netScore: cand.netScore,
          },
        };
        row.events.push(event);
        saveState(state);
        publishMockEvent(event);

        return { candidateId: input.candidateId, netScore: cand.netScore };
      },

      async close(input) {
        const state = loadState();
        const row = state.sessions.get(input.sessionId);
        if (!row) throw new Error(`Session ${input.sessionId} not found`);
        if (row.candidates.length === 0) {
          throw new Error("No candidates to close poll with");
        }
        const winner = row.candidates.reduce((best, c) =>
          c.netScore > best.netScore ? c : best
        );
        row.winnerCandidateId = winner.id;
        row.status = "decided";
        const event: AppEvent = {
          id: nextId(state),
          sessionId: input.sessionId,
          occurredAt: nowIso(),
          type: "poll.closed",
          winnerCandidateId: winner.id,
        };
        row.events.push(event);
        saveState(state);
        publishMockEvent(event);
        return { winnerCandidateId: winner.id };
      },
    },
  };
}
