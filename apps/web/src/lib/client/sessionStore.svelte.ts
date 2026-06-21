import type { AppEvent, Candidate, Restaurant, SessionState } from "@scope/contract";
import { api } from "./orpc";
import { createSse, type SseConnection } from "./sse";

/** The restaurant payload carried by a restaurant.promoted event. */
type EventRestaurant = Extract<AppEvent, { type: "restaurant.promoted" }>["restaurant"];

/**
 * Normalize an event's restaurant payload into the domain Restaurant type.
 * AppEvent is Zod-inferred (optional numerics are `number | undefined`); the
 * domain Restaurant interface omits the explicit `undefined` under
 * `exactOptionalPropertyTypes`. Drop absent optional keys so the value
 * structurally satisfies Restaurant without a cast.
 */
function toRestaurant(r: EventRestaurant): Restaurant {
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    cuisineTags: r.cuisineTags,
    ...(r.lat !== undefined ? { lat: r.lat } : {}),
    ...(r.lng !== undefined ? { lng: r.lng } : {}),
    ...(r.rating !== undefined ? { rating: r.rating } : {}),
    ...(r.priceLevel !== undefined ? { priceLevel: r.priceLevel } : {}),
    ...(r.distanceM !== undefined ? { distanceM: r.distanceM } : {}),
  };
}

/**
 * Fresh, empty session state. Geo/host fields are placeholders until the first
 * snapshot/event populates them; the reducer only fills what events carry.
 */
export function initialState(id: string, joinCode: string): SessionState {
  return {
    id,
    joinCode,
    status: "lobby",
    hostUserId: "",
    lat: 0,
    lng: 0,
    radiusM: 0,
    cuisines: [],
    members: [],
    candidates: [],
  };
}

/**
 * Pure, exhaustive reducer. Returns a NEW SessionState; never mutates `state`.
 * No Date.now/Math.random — output depends only on (state, event).
 */
export function reduce(state: SessionState, event: AppEvent): SessionState {
  switch (event.type) {
    case "member.joined": {
      // Idempotent: a member is identified by userId, not the event/member id.
      if (state.members.some((m) => m.userId === event.member.userId)) return state;
      return { ...state, members: [...state.members, event.member] };
    }

    case "restaurant.promoted": {
      // Idempotent on candidateId — replaying a promotion must not duplicate.
      if (state.candidates.some((c) => c.id === event.candidateId)) return state;
      const candidate: Candidate = {
        id: event.candidateId,
        restaurant: toRestaurant(event.restaurant),
        promotedAt: event.promotedAt,
        upvotes: 0,
        downvotes: 0,
        netScore: 0,
      };
      return {
        ...state,
        // A promotion implies swiping has begun; only advance out of lobby.
        status: state.status === "lobby" ? "swiping" : state.status,
        candidates: [...state.candidates, candidate],
      };
    }

    case "vote.cast": {
      // Replace the candidate's tally from the authoritative event payload.
      // No-op if we have not seen that candidate yet.
      const idx = state.candidates.findIndex((c) => c.id === event.candidateId);
      if (idx === -1) return state;
      const next = [...state.candidates];
      next[idx] = {
        ...next[idx]!,
        upvotes: event.tally.upvotes,
        downvotes: event.tally.downvotes,
        netScore: event.tally.netScore,
      };
      return { ...state, candidates: next };
    }

    case "poll.opened":
      return { ...state, status: "polling", pollDeadlineAt: event.deadlineAt };

    case "poll.closed":
      return { ...state, status: "decided", winnerCandidateId: event.winnerCandidateId };

    case "deck.replenished":
      // No-op on SessionState: a replenished deck is per-user swipe inventory
      // owned by the deck store (F1.3), not part of shared session state.
      // Consumed here only to keep the union exhaustive.
      return state;

    case "prompt.broaden":
      // Radius only ever grows; ignore a stale/smaller broaden suggestion.
      if (event.nextRadiusM <= state.radiusM) return state;
      return { ...state, radiusM: event.nextRadiusM };

    default: {
      // Exhaustiveness guard: a new AppEvent variant fails to compile here.
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/**
 * Store-level helper: apply an event once. `seen` tracks event ids so a
 * replayed/duplicate delivery (same event.id) is never applied twice.
 */
export function applyEvent(state: SessionState, event: AppEvent, seen: Set<string>): SessionState {
  if (seen.has(event.id)) return state;
  seen.add(event.id);
  return reduce(state, event);
}

export interface SessionStore {
  readonly state: SessionState;
  readonly connected: boolean;
  readonly lastEventId: string | null;
  connect(): void;
  disconnect(): void;
}

/**
 * Runes-based session store. Holds SessionState in `$state`, wires the SSE
 * connection on connect(), reduces each incoming event into new state, and
 * dedupes by event id while tracking Last-Event-ID for replay on reconnect.
 */
// ponytail: two fixed backoff steps, no jitter lib — YAGNI.
const BACKOFF_MS = [1000, 3000] as const;

export function createSessionStore(sessionId: string, joinCode: string): SessionStore {
  let state = $state<SessionState>(initialState(sessionId, joinCode));
  let connected = $state(false);
  let lastEventId = $state<string | null>(null);
  const seenIds = new Set<string>();
  let connection: SseConnection | null = null;
  // ponytail: tracks attempt index into BACKOFF_MS; caps at last entry.
  let retryAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function openConnection() {
    connection = createSse(sessionId, {
      onOpen: () => {
        connected = true;
        retryAttempt = 0;
        // On reconnect (not first open): replay events since last seen id.
        if (lastEventId !== null) {
          void api.session
            .eventsSince({ sessionId, afterEventId: lastEventId })
            .then((events) => {
              for (const ev of events) {
                state = applyEvent(state, ev, seenIds);
              }
            });
        }
      },
      onError: () => {
        connected = false;
        connection = null;
        if (stopped) return;
        // ponytail: simple fixed-step backoff, cap at last entry.
        const delay = BACKOFF_MS[Math.min(retryAttempt, BACKOFF_MS.length - 1)]!;
        retryAttempt += 1;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (!stopped) openConnection();
        }, delay);
      },
      onEvent: (event) => {
        state = applyEvent(state, event, seenIds);
        lastEventId = event.id;
      },
    });
  }

  return {
    get state() {
      return state;
    },
    get connected() {
      return connected;
    },
    get lastEventId() {
      return lastEventId;
    },
    connect() {
      if (connection || retryTimer) return;
      stopped = false;
      openConnection();
    },
    disconnect() {
      stopped = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      connection?.close();
      connection = null;
      connected = false;
    },
  };
}
