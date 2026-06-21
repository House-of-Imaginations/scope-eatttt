import { z } from "zod";

export const RestaurantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  address: z.string().min(1),
  cuisineTags: z.array(z.string()),
  lat: z.number().optional(),
  lng: z.number().optional(),
  rating: z.number().min(0).max(5).optional(),
  priceLevel: z.number().int().min(0).max(4).optional(),
  distanceM: z.number().nonnegative().optional(),
});

export const CandidateSchema = z.object({
  id: z.string().uuid(),
  restaurant: RestaurantSchema,
  promotedAt: z.string().datetime(),
  upvotes: z.number().int().nonnegative(),
  downvotes: z.number().int().nonnegative(),
  netScore: z.number().int(),
});

export const MemberSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  displayName: z.string().min(1),
  isHost: z.boolean(),
  joinedAt: z.string().datetime(),
});

const BaseEvent = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  occurredAt: z.string().datetime(),
});

export const AppEventSchema = z.discriminatedUnion("type", [
  BaseEvent.extend({
    type: z.literal("member.joined"),
    member: MemberSchema,
  }),
  BaseEvent.extend({
    type: z.literal("restaurant.promoted"),
    candidateId: z.string().uuid(),
    restaurant: RestaurantSchema,
    promotedAt: z.string().datetime(),
  }),
  BaseEvent.extend({
    type: z.literal("vote.cast"),
    candidateId: z.string().uuid(),
    userId: z.string().min(1),
    value: z.union([z.literal(1), z.literal(-1)]),
    tally: z.object({
      upvotes: z.number().int().nonnegative(),
      downvotes: z.number().int().nonnegative(),
      netScore: z.number().int(),
    }),
  }),
  BaseEvent.extend({
    type: z.literal("poll.opened"),
    deadlineAt: z.string().datetime(),
  }),
  BaseEvent.extend({
    type: z.literal("poll.closed"),
    winnerCandidateId: z.string().uuid(),
  }),
  BaseEvent.extend({
    type: z.literal("deck.replenished"),
    userId: z.string().min(1),
    restaurants: z.array(RestaurantSchema),
  }),
  BaseEvent.extend({
    type: z.literal("prompt.broaden"),
    userId: z.string().min(1),
    nextRadiusM: z.number().int().positive(),
  }),
]);

export type AppEvent = z.infer<typeof AppEventSchema>;
