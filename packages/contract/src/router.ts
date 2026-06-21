import { oc } from "@orpc/contract";
import { z } from "zod";
import { AppEventSchema, CandidateSchema, RestaurantSchema } from "./events";
import { ClosePollInput, StartPollInput, VoteInput } from "./schemas/poll";
import { CreateSessionInput, JoinSessionInput, SessionIdInput, SessionStateSchema } from "./schemas/session";
import { BroadenInput, SwipeInput } from "./schemas/swipe";
import { DeckInput } from "./schemas/swipe";

export const contract = {
  session: {
    create: oc.input(CreateSessionInput).output(z.object({ sessionId: z.string().uuid(), joinCode: z.string() })),
    join: oc.input(JoinSessionInput).output(z.object({ sessionId: z.string().uuid(), memberId: z.string().uuid() })),
    startSwiping: oc.input(SessionIdInput).output(z.object({ status: z.literal("swiping") })),
    state: oc.input(SessionIdInput).output(SessionStateSchema.nullable()),
    eventsSince: oc.input(SessionIdInput.extend({ afterEventId: z.string().uuid().optional() })).output(z.array(AppEventSchema)),
  },
  swipe: {
    decide: oc.input(SwipeInput).output(z.object({ promoted: z.boolean(), candidate: CandidateSchema.optional() })),
    deck: oc.input(DeckInput).output(z.array(RestaurantSchema)),
    broaden: oc.input(BroadenInput).output(z.object({ radiusM: z.number().int().positive(), restaurants: z.array(RestaurantSchema) })),
  },
  poll: {
    start: oc.input(StartPollInput).output(z.object({ deadlineAt: z.string().datetime() })),
    results: oc.input(SessionIdInput).output(z.array(CandidateSchema)),
    vote: oc.input(VoteInput).output(z.object({ candidateId: z.string().uuid(), netScore: z.number().int() })),
    close: oc.input(ClosePollInput).output(z.object({ winnerCandidateId: z.string().uuid() })),
  },
};

export type Contract = typeof contract;
