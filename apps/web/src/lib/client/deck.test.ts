import { describe, it, expect, vi } from "vitest";
import type { Restaurant } from "@scope/contract";

// Behaviour-level tests against the SAME in-memory mock the app uses
// (PUBLIC_USE_MOCK=1). load()/decide() exercise the real api transport; a
// session is created first so the mock can resolve swipe.decide. The pure
// deck mechanics (pop / append+dedupe / low flag) are asserted on observable
// state, never on internals.
vi.mock("$env/static/public", () => ({ PUBLIC_USE_MOCK: "1" }));

const { api } = await import("./orpc");
const { createDeck } = await import("./deck.svelte");

const fakeRestaurant = (id: string): Restaurant => ({
  id,
  name: `R ${id}`,
  address: `${id} St`,
  cuisineTags: ["test"],
});

async function freshSession(): Promise<string> {
  const { sessionId } = await api.session.create({ lat: 1, lng: 2, cuisines: [] });
  return sessionId;
}

describe("createDeck", () => {
  it("load() fills the deck from api.swipe.deck", async () => {
    const sessionId = await freshSession();
    const deck = createDeck(sessionId);
    expect(deck.cards).toHaveLength(0);
    await deck.load();
    expect(deck.cards.length).toBeGreaterThan(0);
    // current is the first card of the deck
    expect(deck.current).toEqual(deck.cards[0]);
  });

  it("decide() pops the current card and returns the api result", async () => {
    const sessionId = await freshSession();
    const deck = createDeck(sessionId);
    await deck.load();
    const before = deck.cards.length;
    const first = deck.current!;
    const result = await deck.decide("reject");
    expect(deck.cards).toHaveLength(before - 1);
    // the popped card is gone; the next card is now current
    expect(deck.cards.some((c) => c.id === first.id)).toBe(false);
    expect(deck.current).toEqual(deck.cards[0]);
    expect(result).toHaveProperty("promoted");
  });

  it("decide() is a no-op safe call when the deck is empty", async () => {
    const sessionId = await freshSession();
    const deck = createDeck(sessionId);
    // no load → no current
    const result = await deck.decide("accept");
    expect(deck.cards).toHaveLength(0);
    expect(result).toBeUndefined();
  });

  it("isLow flips at <= 2 cards left", async () => {
    const sessionId = await freshSession();
    const deck = createDeck(sessionId);
    deck.appendReplenished([fakeRestaurant("a"), fakeRestaurant("b"), fakeRestaurant("c")]);
    expect(deck.cards).toHaveLength(3);
    expect(deck.isLow).toBe(false);
    await deck.decide("reject"); // 3 -> 2
    expect(deck.cards).toHaveLength(2);
    expect(deck.isLow).toBe(true);
  });

  it("appendReplenished appends new cards and dedupes by id", async () => {
    const sessionId = await freshSession();
    const deck = createDeck(sessionId);
    deck.appendReplenished([fakeRestaurant("x"), fakeRestaurant("y")]);
    expect(deck.cards.map((c) => c.id)).toEqual(["x", "y"]);
    // overlapping batch: x is a dup, z is new
    deck.appendReplenished([fakeRestaurant("x"), fakeRestaurant("z")]);
    expect(deck.cards.map((c) => c.id)).toEqual(["x", "y", "z"]);
  });

  it("load() merges into existing cards instead of clobbering them", async () => {
    // Guards the deck.replenished race: a concurrent replenish appends cards
    // while load()'s fetch is in flight; load() must not wipe them on resolve.
    const sessionId = await freshSession();
    const deck = createDeck(sessionId);
    deck.appendReplenished([fakeRestaurant("pre-1"), fakeRestaurant("pre-2")]);
    await deck.load();
    // The pre-seeded cards survive the load, and the fetched deck is added.
    expect(deck.cards.some((c) => c.id === "pre-1")).toBe(true);
    expect(deck.cards.some((c) => c.id === "pre-2")).toBe(true);
    expect(deck.cards.length).toBeGreaterThan(2);
  });
});
