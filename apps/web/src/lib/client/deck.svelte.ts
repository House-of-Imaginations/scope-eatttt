import type { Restaurant } from "@scope/contract";
import { api } from "./orpc";

/** Result of a swipe decision (mirrors api.swipe.decide's resolved shape). */
type DecideResult = Awaited<ReturnType<typeof api.swipe.decide>>;

/** The restaurant shape api.swipe.deck resolves to (Zod-inferred, optionals as `T | undefined`). */
type ApiRestaurant = Awaited<ReturnType<typeof api.swipe.deck>>[number];

/**
 * Normalize an api/Zod restaurant (optionals typed `T | undefined`) into the
 * domain Restaurant (which omits absent optionals under
 * `exactOptionalPropertyTypes`). Same seam as sessionStore's toRestaurant.
 */
function toRestaurant(r: ApiRestaurant): Restaurant {
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

export interface Deck {
  /** Current swipe inventory; first element is the card on top. */
  readonly cards: Restaurant[];
  /** The card on top of the deck, or undefined when empty. */
  readonly current: Restaurant | undefined;
  /** True once the deck runs low (<= 2 left) — drives replenish/expand. */
  readonly isLow: boolean;
  /** Fetch the initial deck for this session. */
  load(): Promise<void>;
  /** Decide on the current card: send to the server, then pop it locally. */
  decide(decision: "accept" | "reject"): Promise<DecideResult | undefined>;
  /** Append replenished cards (from a deck.replenished event), deduped by id. */
  appendReplenished(restaurants: Restaurant[]): void;
}

// A member's deck is LOW at <= 2 cards left (AGENTS.md pinned default), which is
// when the session screen asks the server to replenish/expand the radius.
const LOW_THRESHOLD = 2;

/**
 * Per-member swipe deck. Holds the inventory in `$state`; `current` and `isLow`
 * are `$derived`. Logic is framework-pure (no DOM) so it is testable under
 * Vitest against the same mock transport the app uses.
 */
export function createDeck(sessionId: string): Deck {
  let cards = $state<Restaurant[]>([]);
  const current = $derived(cards[0]);
  const isLow = $derived(cards.length <= LOW_THRESHOLD);

  return {
    get cards() {
      return cards;
    },
    get current() {
      return current;
    },
    get isLow() {
      return isLow;
    },

    async load() {
      const fetched = await api.swipe.deck({ sessionId });
      cards = fetched.map(toRestaurant);
    },

    async decide(decision) {
      const card = current;
      if (!card) return undefined;
      const result = await api.swipe.decide({
        sessionId,
        restaurantId: card.id,
        decision,
        deckLeft: cards.length,
      });
      // Pop the decided card from the top regardless of promotion outcome.
      cards = cards.slice(1);
      return result;
    },

    appendReplenished(restaurants) {
      // ponytail: dedupe with a Set of ids — append only cards not already held.
      const seen = new Set(cards.map((c) => c.id));
      const fresh = restaurants.filter((r) => !seen.has(r.id));
      if (fresh.length > 0) cards = [...cards, ...fresh];
    },
  };
}
