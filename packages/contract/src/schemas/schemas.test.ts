import { describe, expect, it } from "vitest";
import { AppEventSchema } from "../events";
import { ClosePollInput, StartPollInput, VoteInput } from "./poll";
import { CreateSessionInput, JoinSessionInput, SessionIdInput, SessionSummarySchema } from "./session";
import { BroadenInput, SwipeInput } from "./swipe";

describe("contract schemas", () => {
  it("validates session inputs", () => {
    expect(
      CreateSessionInput.parse({
        lat: -37.8136,
        lng: 144.9631,
        cuisines: ["thai", "japanese"],
      }),
    ).toMatchObject({ radiusM: 500 });

    expect(JoinSessionInput.parse({ joinCode: "abc123", displayName: "Ada" })).toEqual({
      joinCode: "ABC123",
      displayName: "Ada",
    });

    expect(SessionIdInput.safeParse({ sessionId: "not-a-uuid" }).success).toBe(false);
  });

  it("validates swipe and poll inputs", () => {
    expect(SwipeInput.parse({
      sessionId: crypto.randomUUID(),
      restaurantId: "place-1",
      decision: "accept",
    }).decision).toBe("accept");

    expect(BroadenInput.parse({ sessionId: crypto.randomUUID(), userId: "user-1" }).stepM).toBe(500);
    expect(StartPollInput.parse({ sessionId: crypto.randomUUID() }).timerMs).toBe(300000);
    expect(ClosePollInput.parse({ sessionId: crypto.randomUUID() })).toHaveProperty("sessionId");
    expect(VoteInput.parse({ sessionId: crypto.randomUUID(), candidateId: crypto.randomUUID(), value: 1 }).value).toBe(1);
  });

  it("validates the SSE app event discriminated union", () => {
    expect(
      AppEventSchema.parse({
        id: crypto.randomUUID(),
        sessionId: crypto.randomUUID(),
        type: "restaurant.promoted",
        occurredAt: new Date().toISOString(),
        candidateId: crypto.randomUUID(),
        restaurant: {
          id: "place-1",
          name: "Noodle House",
          address: "1 Main St",
          cuisineTags: ["thai"],
          rating: 4.5,
          priceLevel: 2,
          distanceM: 320,
        },
        promotedAt: new Date().toISOString(),
      }).type,
    ).toBe("restaurant.promoted");
  });

  it("validates session summary output", () => {
    expect(
      SessionSummarySchema.parse({
        id: crypto.randomUUID(),
        joinCode: "JOIN01",
        status: "swiping",
      }),
    ).toMatchObject({ status: "swiping" });
  });
});
