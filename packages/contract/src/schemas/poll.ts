import { z } from "zod";
import { SessionIdInput } from "./session";

export const StartPollInput = SessionIdInput.extend({
  timerMs: z.number().int().positive().default(300000),
});

export const VoteInput = SessionIdInput.extend({
  candidateId: z.string().uuid(),
  value: z.union([z.literal(1), z.literal(-1)]),
});

export const ClosePollInput = SessionIdInput;

export type StartPollInput = z.infer<typeof StartPollInput>;
export type VoteInput = z.infer<typeof VoteInput>;
export type ClosePollInput = z.infer<typeof ClosePollInput>;
