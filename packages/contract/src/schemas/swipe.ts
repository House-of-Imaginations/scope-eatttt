import { z } from "zod";
import { MemberScopedSessionInput } from "./session";

export const SwipeInput = MemberScopedSessionInput.extend({
  restaurantId: z.string().min(1),
  decision: z.enum(["accept", "reject"]),
  deckLeft: z.number().int().nonnegative().optional(),
});

export const BroadenInput = MemberScopedSessionInput.extend({
  userId: z.string().min(1),
  stepM: z.number().int().positive().default(500),
});

export const DeckInput = MemberScopedSessionInput.extend({
  limit: z.number().int().positive().max(50).default(10),
});

export type SwipeInput = z.infer<typeof SwipeInput>;
export type BroadenInput = z.infer<typeof BroadenInput>;
export type DeckInput = z.infer<typeof DeckInput>;
