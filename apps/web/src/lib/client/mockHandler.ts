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
type SessionIdIn = { sessionId: string };
type SwipeIn = { sessionId: string; restaurantId: string; decision: "accept" | "reject"; deckLeft?: number };
type DeckIn = { sessionId: string; limit?: number };
type BroadenIn = { sessionId: string; userId: string; stepM?: number };
type StartPollIn = { sessionId: string; timerMs?: number };
type VoteIn = { sessionId: string; candidateId: string; value: 1 | -1 };
type ClosePollIn = { sessionId: string };

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

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  const hex = _idCounter.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

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

export interface MockApi {
  session: {
    create(input: CreateIn): Promise<{ sessionId: string; joinCode: string }>;
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

// ── Factory ───────────────────────────────────────────────────────────────────

export function makeMockApi(): MockApi {
  const sessions = new Map<string, SessionRow>();
  // joinCode -> sessionId
  const codeIndex = new Map<string, string>();
  const accepts: AcceptsMap = new Map();
  // votes[candidateId] = Map<userId, value>
  const votes = new Map<string, Map<string, 1 | -1>>();

  // Tracks "current acting user" per session for swipe.decide calls.
  // On create: host is "user-host". On join: next swipe comes from the new member.
  const nextSwipeUser = new Map<string, string>();

  function getSession(sessionId: string): SessionRow {
    const s = sessions.get(sessionId);
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
        const sessionId = nextId();
        const joinCode = makeJoinCode();
        const hostUserId = "user-host";
        const hostMember: Member = {
          id: nextId(),
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
        sessions.set(sessionId, row);
        codeIndex.set(joinCode.toUpperCase(), sessionId);
        nextSwipeUser.set(sessionId, hostUserId);
        return { sessionId, joinCode };
      },

      async join(input) {
        const code = input.joinCode.toUpperCase();
        // ponytail: create-on-join for unknown codes — a joiner is usually on a
        // different device than the host, so the session won't exist in this
        // page's in-memory mock. Synthesize a lobby session so /join/<code> works
        // standalone (real backend looks the code up in Postgres).
        let sessionId = codeIndex.get(code);
        if (!sessionId) {
          sessionId = nextId();
          const hostUserId = "user-host";
          sessions.set(sessionId, {
            id: sessionId,
            joinCode: code,
            status: "lobby",
            hostUserId,
            lat: 0,
            lng: 0,
            radiusM: 500,
            cuisines: [],
            members: [{ id: nextId(), userId: hostUserId, displayName: "Host", isHost: true, joinedAt: nowIso() }],
            candidates: [],
            pollDeadlineAt: undefined,
            winnerCandidateId: undefined,
            events: [],
          });
          codeIndex.set(code, sessionId);
          nextSwipeUser.set(sessionId, hostUserId);
        }
        const row = getSession(sessionId);
        const memberId = nextId();
        const userId = `user-${memberId}`;
        const member: Member = {
          id: memberId,
          userId,
          displayName: input.displayName,
          isHost: false,
          joinedAt: nowIso(),
        };
        row.members.push(member);
        nextSwipeUser.set(sessionId, userId);
        row.events.push({
          id: nextId(),
          sessionId,
          occurredAt: nowIso(),
          type: "member.joined",
          member,
        });
        return { sessionId, memberId };
      },

      async startSwiping(input) {
        const row = getSession(input.sessionId);
        if (row.status === "lobby") {
          row.status = "swiping";
          row.events.push({
            id: nextId(),
            sessionId: input.sessionId,
            occurredAt: nowIso(),
            type: "session.started",
          });
        }
        return { status: "swiping" };
      },

      async state(input) {
        const row = sessions.get(input.sessionId);
        if (!row) return null;
        const state: SessionState = {
          id: row.id,
          joinCode: row.joinCode,
          status: row.status,
          hostUserId: row.hostUserId,
          viewerIsHost: true,
          lat: row.lat,
          lng: row.lng,
          radiusM: row.radiusM,
          cuisines: row.cuisines,
          members: row.members,
          candidates: row.candidates,
          ...(row.pollDeadlineAt !== undefined ? { pollDeadlineAt: row.pollDeadlineAt } : {}),
          ...(row.winnerCandidateId !== undefined ? { winnerCandidateId: row.winnerCandidateId } : {}),
        };
        return state;
      },

      async eventsSince(input) {
        const row = sessions.get(input.sessionId);
        if (!row) return [];
        if (!input.afterEventId) return row.events;
        const idx = row.events.findIndex((e) => e.id === input.afterEventId);
        return idx === -1 ? row.events : row.events.slice(idx + 1);
      },
    },

    swipe: {
      async decide(input) {
        const row = getSession(input.sessionId);
        const userId = nextSwipeUser.get(input.sessionId) ?? row.hostUserId;

        if (input.decision === "reject") {
          return { promoted: false };
        }

        if (!accepts.has(input.restaurantId)) {
          accepts.set(input.restaurantId, new Set());
        }
        const acceptSet = accepts.get(input.restaurantId)!;
        acceptSet.add(userId);

        // Rotate to next member for subsequent calls
        const members = row.members;
        const curIdx = members.findIndex((m) => m.userId === userId);
        const nextIdx = (curIdx + 1) % members.length;
        nextSwipeUser.set(input.sessionId, members[nextIdx]!.userId);

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
            id: nextId(),
            restaurant,
            promotedAt: nowIso(),
            upvotes: 0,
            downvotes: 0,
            netScore: 0,
          };
          row.candidates.push(candidate);
          votes.set(candidate.id, new Map());
          row.events.push({
            id: nextId(),
            sessionId: input.sessionId,
            occurredAt: nowIso(),
            type: "restaurant.promoted",
            candidateId: candidate.id,
            restaurant,
            promotedAt: candidate.promotedAt,
          });
          return { promoted: true, candidate };
        }

        return { promoted: false };
      },

      async deck(input) {
        const limit = input.limit ?? 10;
        return FIXTURE_RESTAURANTS.slice(0, limit);
      },

      async broaden(input) {
        const row = getSession(input.sessionId);
        const step = input.stepM ?? 500;
        row.radiusM = row.radiusM + step;
        return { radiusM: row.radiusM, restaurants: FIXTURE_RESTAURANTS };
      },
    },

    poll: {
      async start(input) {
        const row = getSession(input.sessionId);
        const timerMs = input.timerMs ?? 300_000;
        const deadlineAt = new Date(Date.now() + timerMs).toISOString();
        row.pollDeadlineAt = deadlineAt;
        row.status = "polling";
        row.events.push({
          id: nextId(),
          sessionId: input.sessionId,
          occurredAt: nowIso(),
          type: "poll.opened",
          deadlineAt,
        });
        return { deadlineAt };
      },

      async results(input) {
        const row = getSession(input.sessionId);
        return row.candidates;
      },

      async vote(input) {
        const row = getSession(input.sessionId);
        const cand = row.candidates.find((c) => c.id === input.candidateId);
        if (!cand) throw new Error(`Candidate ${input.candidateId} not found`);

        const userId = nextSwipeUser.get(input.sessionId) ?? row.hostUserId;
        if (!votes.has(input.candidateId)) {
          votes.set(input.candidateId, new Map());
        }
        const voteMap = votes.get(input.candidateId)!;
        const prev = voteMap.get(userId);
        if (prev === 1) cand.upvotes -= 1;
        else if (prev === -1) cand.downvotes -= 1;
        voteMap.set(userId, input.value);
        if (input.value === 1) cand.upvotes += 1;
        else cand.downvotes += 1;
        cand.netScore = cand.upvotes - cand.downvotes;

        row.events.push({
          id: nextId(),
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
        });

        return { candidateId: input.candidateId, netScore: cand.netScore };
      },

      async close(input) {
        const row = getSession(input.sessionId);
        if (row.candidates.length === 0) {
          throw new Error("No candidates to close poll with");
        }
        const winner = row.candidates.reduce((best, c) =>
          c.netScore > best.netScore ? c : best
        );
        row.winnerCandidateId = winner.id;
        row.status = "decided";
        row.events.push({
          id: nextId(),
          sessionId: input.sessionId,
          occurredAt: nowIso(),
          type: "poll.closed",
          winnerCandidateId: winner.id,
        });
        return { winnerCandidateId: winner.id };
      },
    },
  };
}
