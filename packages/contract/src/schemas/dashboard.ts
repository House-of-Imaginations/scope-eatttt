import { z } from "zod";
import { CandidateSchema, MemberSchema } from "../events";
import { SessionSummarySchema } from "./session";

export const DashboardHistoryItem = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  joinCode: z.string(),
  status: SessionSummarySchema.shape.status.unwrap(),
  createdAt: z.string().datetime(),
  winnerName: z.string().nullable(),
});

export const DashboardHistory = z.array(DashboardHistoryItem);

export const DashboardSessionSummary = SessionSummarySchema.extend({
  title: z.string().nullable(),
  status: SessionSummarySchema.shape.status.unwrap(),
  winnerName: z.string().nullable(),
  candidates: z.array(CandidateSchema),
  members: z.array(MemberSchema),
});

export type DashboardHistoryItem = z.infer<typeof DashboardHistoryItem>;
export type DashboardHistory = z.infer<typeof DashboardHistory>;
export type DashboardSessionSummary = z.infer<typeof DashboardSessionSummary>;
