import { z } from "zod";
import { CandidateSchema, MemberSchema } from "../events";

export const SessionStatusSchema = z.enum(["lobby", "swiping", "polling", "decided", "closed"]);

export const SessionIdInput = z.object({
  sessionId: z.string().uuid(),
});

export const MemberScopedSessionInput = SessionIdInput.extend({
  memberId: z.string().uuid().optional(),
});

export const SessionSummarySchema = z.object({
  id: z.string().uuid(),
  joinCode: z.string().min(4).max(12),
  hostUserId: z.string().min(1).optional(),
  status: SessionStatusSchema.optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  radiusM: z.number().int().positive().optional(),
  cuisines: z.array(z.string()).optional(),
  pollDeadlineAt: z.string().datetime().optional(),
  winnerCandidateId: z.string().uuid().optional(),
});

export const SessionStateSchema = z.object({
  id: z.string().uuid(),
  joinCode: z.string().min(4).max(12),
  status: SessionStatusSchema,
  hostUserId: z.string().min(1),
  viewerIsHost: z.boolean(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().positive(),
  cuisines: z.array(z.string()),
  members: z.array(MemberSchema),
  candidates: z.array(CandidateSchema),
  pollDeadlineAt: z.string().datetime().optional(),
  winnerCandidateId: z.string().uuid().optional(),
});

export const CreateSessionInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  cuisines: z.array(z.string().min(1)).default([]),
  radiusM: z.number().int().positive().default(500),
});

export const JoinSessionInput = z.object({
  joinCode: z.string().min(4).max(12).transform((value) => value.toUpperCase()),
  displayName: z.string().min(1).max(80),
});

export type CreateSessionInput = z.infer<typeof CreateSessionInput>;
export type JoinSessionInput = z.infer<typeof JoinSessionInput>;
export type SessionIdInput = z.infer<typeof SessionIdInput>;
export type MemberScopedSessionInput = z.infer<typeof MemberScopedSessionInput>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
