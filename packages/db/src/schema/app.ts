import { boolean, index, integer, pgEnum, pgTable, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const sessionStatus = pgEnum("session_status", ["lobby", "swiping", "polling", "decided", "closed"]);
export const swipeDecision = pgEnum("swipe_decision", ["accept", "reject"]);

export const lunchSession = pgTable(
  "lunch_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    joinCode: text("join_code").notNull().unique(),
    hostUserId: text("host_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    status: sessionStatus("status").notNull().default("lobby"),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    radiusM: integer("radius_m").notNull().default(500),
    cuisines: text("cuisines").array().notNull().default([]),
    pollDeadlineAt: timestamp("poll_deadline_at", { withTimezone: true }),
    winnerCandidateId: uuid("winner_candidate_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    joinCodeIdx: uniqueIndex("lunch_session_join_code_idx").on(table.joinCode),
    hostIdx: index("lunch_session_host_idx").on(table.hostUserId),
  }),
);

export const sessionMember = pgTable(
  "session_member",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => lunchSession.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    isHost: boolean("is_host").notNull().default(false),
    radiusM: integer("radius_m").notNull().default(500),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sessionUserUnique: uniqueIndex("session_member_session_user_idx").on(table.sessionId, table.userId),
    sessionIdx: index("session_member_session_idx").on(table.sessionId),
  }),
);

export const swipe = pgTable(
  "swipe",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => lunchSession.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    restaurantId: text("restaurant_id").notNull(),
    decision: swipeDecision("decision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    swipeUnique: uniqueIndex("swipe_session_user_restaurant_idx").on(table.sessionId, table.userId, table.restaurantId),
    restaurantIdx: index("swipe_session_restaurant_idx").on(table.sessionId, table.restaurantId),
  }),
);

export const restaurantCache = pgTable(
  "restaurant_cache",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    address: text("address").notNull(),
    cuisineTags: text("cuisine_tags").array().notNull().default([]),
    lat: real("lat"),
    lng: real("lng"),
    rating: real("rating"),
    priceLevel: integer("price_level"),
    distanceM: integer("distance_m"),
    cachedAt: timestamp("cached_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    cachedAtIdx: index("restaurant_cache_cached_at_idx").on(table.cachedAt),
  }),
);

export const pollCandidate = pgTable(
  "poll_candidate",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => lunchSession.id, { onDelete: "cascade" }),
    restaurantId: text("restaurant_id").notNull().references(() => restaurantCache.id, { onDelete: "restrict" }),
    promotedAt: timestamp("promoted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    candidateUnique: uniqueIndex("poll_candidate_session_restaurant_idx").on(table.sessionId, table.restaurantId),
  }),
);

export const vote = pgTable(
  "vote",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => lunchSession.id, { onDelete: "cascade" }),
    candidateId: uuid("candidate_id").notNull().references(() => pollCandidate.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    value: integer("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    voteUnique: uniqueIndex("vote_session_candidate_user_idx").on(table.sessionId, table.candidateId, table.userId),
    sessionCandidateIdx: index("vote_session_candidate_idx").on(table.sessionId, table.candidateId),
  }),
);
