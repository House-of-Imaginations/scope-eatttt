# scope-eatttt Setup / Foundation Plan — shared base (build first)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the shared foundation both the backend (Codex) and frontend (Claude) plans depend on — Turborepo monorepo, typed env, local Docker stack (Postgres + PgBouncer + Redis), Drizzle schema (auth + app + outbox) with the outbox NOTIFY trigger, and the `@scope/contract` type seam.

**Architecture:** Turborepo + pnpm workspaces. `packages/contract` is the type seam both lanes import. `packages/db` holds the Drizzle schema with two connection paths (pooled + direct) and the hand-written outbox trigger. Docker Compose mirrors prod pooling locally so PgBouncer-mode bugs surface early.

**Tech Stack:** Turborepo + pnpm · TypeScript strict · Drizzle ORM + drizzle-kit · postgres.js · Zod · oRPC contract · Docker Compose · PgBouncer · Vitest · testcontainers.

**Owner:** Whoever runs first (recommend Codex, since it's backend-shaped). Both lanes are blocked until this plan's Tasks S1–S6 are green. **Frontend unblocks at S6 (contract).** Backend Phase 1 starts after S6.

## Global Constraints

- TypeScript strict. Node ≥ 22.12.0. pnpm workspaces + Turborepo.
- **Two DB connections:** `DATABASE_URL` (PgBouncer transaction mode — all queries + NOTIFY) and `DATABASE_DIRECT_URL` (direct — relay LISTEN + drizzle-kit migrations only).
- **`prepare: false`** on the postgres.js pooled connection (prepared statements break under PgBouncer tx mode).
- Better Auth OWNS `user`/`session`/`account`/`verification`. App tables FK `user.id` ON DELETE CASCADE. App's ephemeral session table is `lunch_session`.
- Outbox: every command (later plans) writes domain row + `outbox_event` in ONE tx. This plan builds the schema + NOTIFY trigger + partial pending index.
- Pinned defaults (env): promote_threshold=2 · reject-streak=5 · radius base=500/step 500/cap 3000 · poll timer=300000ms · Places cache TTL=1800s.
- Commits: semantic per `COMMIT.md`. NO `Co-authored-by`. Max 7 files/commit.

---

## File Structure

```
package.json · pnpm-workspace.yaml · turbo.json · docker-compose.yml · .env.example
infra/pgbouncer/...
packages/config/   src/env.ts, tsconfig.base.json, package.json
packages/db/       src/schema/{auth,app,outbox}.ts, src/schema/index.ts, src/client.ts, src/listener.ts,
                   drizzle.config.ts, migrations/ (+ hand-written 0001_outbox_trigger.sql), tests/
packages/contract/ src/schemas/*.ts, src/types.ts, src/events.ts, src/router.ts, src/index.ts
```

---

### Task S1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `packages/config/tsconfig.base.json`, `packages/config/package.json`

**Interfaces:**
- Produces: workspace graph; turbo tasks `build`/`dev`/`check-types`/`test`/`lint`/`db:migrate`; shared tsconfig base.

- [ ] **Step 1: Root `package.json`**

```json
{
  "name": "scope-eatttt",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22.12.0" },
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "check-types": "turbo check-types",
    "test": "turbo test",
    "lint": "turbo lint",
    "db:migrate": "turbo db:migrate"
  },
  "devDependencies": { "turbo": "^2.1.0", "typescript": "^5.6.0" }
}
```

- [ ] **Step 2: `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: `turbo.json`**

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".svelte-kit/**"] },
    "dev": { "cache": false, "persistent": true },
    "check-types": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "lint": {},
    "db:migrate": { "cache": false }
  }
}
```

- [ ] **Step 4: `packages/config/tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "esModuleInterop": true,
    "skipLibCheck": true, "declaration": true, "composite": true
  }
}
```

- [ ] **Step 5: `packages/config/package.json`**

```json
{ "name": "@scope/config", "version": "0.0.0", "private": true, "main": "tsconfig.base.json" }
```

- [ ] **Step 6: Install + verify graph**

Run: `pnpm install && pnpm turbo run build --dry=json | head -5`
Expected: turbo resolves the workspace with no task errors.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json packages/config
git commit -m "chore: scaffold turborepo + pnpm workspace"
```

---

### Task S2: Typed env (`packages/config/src/env.ts`)

**Files:**
- Create: `packages/config/src/env.ts`, `.env.example`
- Test: `packages/config/src/env.test.ts`

**Interfaces:**
- Produces: `loadEnv(): Env` / `parseEnv(src)` returning `{ DATABASE_URL, DATABASE_DIRECT_URL, REDIS_URL, PLACES_PROVIDER('google'|'fake'), OCR_PROVIDER('mindee'|'fake'), GOOGLE_MAPS_API_KEY?, BETTER_AUTH_SECRET, BETTER_AUTH_URL, PROMOTE_THRESHOLD, REJECT_STREAK, RADIUS_BASE_M, RADIUS_STEP_M, RADIUS_CAP_M, POLL_TIMER_MS, PLACES_CACHE_TTL_S }` with pinned defaults.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("applies pinned defaults and parses provider enums", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://x", DATABASE_DIRECT_URL: "postgres://y",
      REDIS_URL: "redis://z", BETTER_AUTH_SECRET: "s", BETTER_AUTH_URL: "http://localhost:4321",
      PLACES_PROVIDER: "fake", OCR_PROVIDER: "fake",
    });
    expect(env.PROMOTE_THRESHOLD).toBe(2);
    expect(env.RADIUS_CAP_M).toBe(3000);
    expect(env.POLL_TIMER_MS).toBe(300000);
    expect(env.PLACES_PROVIDER).toBe("fake");
  });
  it("throws on missing required var", () => { expect(() => parseEnv({})).toThrow(); });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @scope/config test`

- [ ] **Step 3: Implement**

```ts
import { z } from "zod";

const Schema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_DIRECT_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url(),
  PLACES_PROVIDER: z.enum(["google", "fake"]).default("fake"),
  OCR_PROVIDER: z.enum(["mindee", "fake"]).default("fake"),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  PROMOTE_THRESHOLD: z.coerce.number().int().default(2),
  REJECT_STREAK: z.coerce.number().int().default(5),
  RADIUS_BASE_M: z.coerce.number().int().default(500),
  RADIUS_STEP_M: z.coerce.number().int().default(500),
  RADIUS_CAP_M: z.coerce.number().int().default(3000),
  POLL_TIMER_MS: z.coerce.number().int().default(300000),
  PLACES_CACHE_TTL_S: z.coerce.number().int().default(1800),
});
export type Env = z.infer<typeof Schema>;
export function parseEnv(src: Record<string, string | undefined>): Env { return Schema.parse(src); }
export function loadEnv(): Env { return parseEnv(process.env); }
```

- [ ] **Step 4: `.env.example`**

```bash
DATABASE_URL=postgres://app:app@localhost:6432/scope_eatttt       # PgBouncer (tx mode)
DATABASE_DIRECT_URL=postgres://app:app@localhost:5432/scope_eatttt # direct (LISTEN + migrations)
REDIS_URL=redis://localhost:6379
BETTER_AUTH_SECRET=change-me
BETTER_AUTH_URL=http://localhost:4321
PLACES_PROVIDER=fake
OCR_PROVIDER=fake
GOOGLE_MAPS_API_KEY=
```

- [ ] **Step 5: Run → pass.**
- [ ] **Step 6: Commit**

```bash
git add packages/config/src/env.ts packages/config/src/env.test.ts .env.example
git commit -m "feat(config): zod-validated env with pinned defaults"
```

---

### Task S3: Docker Compose (Postgres + PgBouncer tx-mode + Redis)

**Files:**
- Create: `docker-compose.yml`, `infra/pgbouncer/` (image env-config; no extra files needed with edoburu image)

**Interfaces:**
- Produces: local stack mirroring prod pooling. Postgres 5432 (direct), PgBouncer 6432 (transaction mode), Redis 6379.

- [ ] **Step 1: `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_USER: app, POSTGRES_PASSWORD: app, POSTGRES_DB: scope_eatttt }
    ports: ["5432:5432"]
    healthcheck: { test: ["CMD","pg_isready","-U","app"], interval: 5s, retries: 10 }
  pgbouncer:
    image: edoburu/pgbouncer:latest
    depends_on: { postgres: { condition: service_healthy } }
    environment:
      DB_HOST: postgres
      DB_USER: app
      DB_PASSWORD: app
      POOL_MODE: transaction
      MAX_PREPARED_STATEMENTS: "0"
      AUTH_TYPE: scram-sha-256
    ports: ["6432:6432"]
  redis:
    image: redis:7
    ports: ["6379:6379"]
```

- [ ] **Step 2: Up + verify both paths**

Run: `docker compose up -d && sleep 5 && pg_isready -h localhost -p 5432 -U app && pg_isready -h localhost -p 6432 -U app`
Expected: both accept connections.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml infra/
git commit -m "chore(infra): local postgres + pgbouncer (tx mode) + redis"
```

---

### Task S4: DB package — schema (auth + app + outbox) + pooled/direct clients

**Files:**
- Create: `packages/db/package.json`, `packages/db/drizzle.config.ts`, `packages/db/src/schema/{auth,app,outbox}.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/client.ts`, `packages/db/src/listener.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/schema/app.test.ts`

**Interfaces:**
- Produces: `db` (pooled drizzle, `prepare:false`), `makeListener()` (direct postgres.js for LISTEN), tables `user, session, account, verification, lunchSession, sessionMember, restaurantCache, swipe, pollCandidate, vote, outboxEvent`.
- Consumes: `@scope/config`.

- [ ] **Step 1: `packages/db/package.json`**

```json
{
  "name": "@scope/db", "version": "0.0.0", "private": true, "type": "module", "main": "src/index.ts",
  "scripts": { "db:generate": "drizzle-kit generate", "db:migrate": "drizzle-kit migrate", "check-types": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "drizzle-orm": "^0.36.0", "postgres": "^3.4.5", "@scope/config": "workspace:*" },
  "devDependencies": { "drizzle-kit": "^0.28.0", "vitest": "^2.1.0", "typescript": "^5.6.0" }
}
```

- [ ] **Step 2: `schema/auth.ts`** (matches Better Auth generated tables — `user` incl. `isAnonymous` + `displayName`; `session`, `account`, `verification`)

```ts
import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  isAnonymous: boolean("is_anonymous").default(false),
  displayName: text("display_name"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(), providerId: text("provider_id").notNull(),
  accessToken: text("access_token"), refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"), idToken: text("id_token"), password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(), value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(), updatedAt: timestamp("updated_at").defaultNow(),
});
```

> Reconcile against `better-auth generate` output during backend auth task; treat the generated output as authoritative if it drifts.

- [ ] **Step 3: `schema/app.ts`** (all FK `user.id` cascade)

```ts
import { pgTable, text, integer, doublePrecision, timestamp, primaryKey, unique } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const lunchSession = pgTable("lunch_session", {
  id: text("id").primaryKey(),
  joinCode: text("join_code").notNull().unique(),
  hostUserId: text("host_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("lobby"),
  centerLat: doublePrecision("center_lat").notNull(),
  centerLng: doublePrecision("center_lng").notNull(),
  baseRadiusM: integer("base_radius_m").notNull().default(500),
  cuisines: text("cuisines").array().notNull().default([]),
  winnerCandidateId: text("winner_candidate_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});
export const sessionMember = pgTable("session_member", {
  sessionId: text("session_id").notNull().references(() => lunchSession.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  radiusM: integer("radius_m").notNull().default(500),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.sessionId, t.userId] }) }));
export const restaurantCache = pgTable("restaurant_cache", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(), providerPlaceId: text("provider_place_id").notNull(),
  name: text("name").notNull(),
  lat: doublePrecision("lat").notNull(), lng: doublePrecision("lng").notNull(),
  cuisines: text("cuisines").array().notNull().default([]),
  priceLevel: integer("price_level"), rating: doublePrecision("rating"),
  photoRef: text("photo_ref"), address: text("address"),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
}, (t) => ({ uq: unique().on(t.provider, t.providerPlaceId) }));
export const swipe = pgTable("swipe", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => lunchSession.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  restaurantId: text("restaurant_id").notNull().references(() => restaurantCache.id),
  decision: text("decision").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ uq: unique().on(t.sessionId, t.userId, t.restaurantId) }));
export const pollCandidate = pgTable("poll_candidate", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => lunchSession.id, { onDelete: "cascade" }),
  restaurantId: text("restaurant_id").notNull().references(() => restaurantCache.id),
  promotedAt: timestamp("promoted_at").notNull().defaultNow(),
}, (t) => ({ uq: unique().on(t.sessionId, t.restaurantId) }));
export const vote = pgTable("vote", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => lunchSession.id, { onDelete: "cascade" }),
  candidateId: text("candidate_id").notNull().references(() => pollCandidate.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  value: integer("value").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ uq: unique().on(t.sessionId, t.candidateId, t.userId) }));
```

- [ ] **Step 4: `schema/outbox.ts`**

```ts
import { pgTable, uuid, text, jsonb, timestamp, integer } from "drizzle-orm/pg-core";
export const outboxEvent = pgTable("outbox_event", {
  id: uuid("id").primaryKey().defaultRandom(),
  aggregate: text("aggregate").notNull(),
  aggregateId: text("aggregate_id").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  dispatchedAt: timestamp("dispatched_at"),
  attempts: integer("attempts").notNull().default(0),
});
```

- [ ] **Step 5: `schema/index.ts`** → `export * from "./auth"; export * from "./app"; export * from "./outbox";`

- [ ] **Step 6: Pooled client `src/client.ts`**

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { loadEnv } from "@scope/config";
import * as schema from "./schema";
const env = loadEnv();
const sql = postgres(env.DATABASE_URL, { prepare: false }); // PgBouncer tx mode
export const db = drizzle(sql, { schema });
export { schema };
```

- [ ] **Step 7: Direct listener `src/listener.ts`**

```ts
import postgres from "postgres";
import { loadEnv } from "@scope/config";
export function makeListener() {
  const env = loadEnv();
  return postgres(env.DATABASE_DIRECT_URL, { prepare: false, max: 1 }); // DIRECT — LISTEN needs it
}
```

- [ ] **Step 8: `drizzle.config.ts` (migrations on DIRECT url)**

```ts
import { defineConfig } from "drizzle-kit";
import { loadEnv } from "@scope/config";
const env = loadEnv();
export default defineConfig({
  schema: "./src/schema/*.ts", out: "./migrations", dialect: "postgresql",
  dbCredentials: { url: env.DATABASE_DIRECT_URL },
});
```

- [ ] **Step 9: `src/index.ts`** → `export * from "./client"; export * from "./listener"; export * from "./schema";`

- [ ] **Step 10: Schema smoke test**

```ts
import { describe, it, expect } from "vitest";
import * as schema from "./index";
describe("app schema", () => {
  it("exports all tables incl. outbox and lunch_session", () => {
    for (const t of ["user","lunchSession","sessionMember","swipe","pollCandidate","vote","outboxEvent"])
      expect(schema).toHaveProperty(t);
  });
});
```

- [ ] **Step 11: Run + commit (≤7 files/commit)**

Run: `pnpm --filter @scope/db test` → PASS.

```bash
git add packages/db/package.json packages/db/drizzle.config.ts packages/db/src/schema packages/db/src/client.ts packages/db/src/listener.ts packages/db/src/index.ts
git commit -m "feat(db): drizzle schema (auth+app+outbox) with pooled + direct clients"
git add packages/db/src/schema/app.test.ts
git commit -m "test(db): schema export smoke test"
```

---

### Task S5: Outbox migration — NOTIFY trigger + partial pending index

**Files:**
- Create: `packages/db/migrations/0001_outbox_trigger.sql`
- Test: `packages/db/tests/outbox-trigger.test.ts` (testcontainers)

**Interfaces:**
- Produces: `AFTER INSERT` trigger on `outbox_event` that `pg_notify('outbox', id)`; partial index `WHERE dispatched_at IS NULL`.

- [ ] **Step 1: Generate base migration**

Run: `pnpm --filter @scope/db db:generate`
Expected: `0000_*.sql` created.

- [ ] **Step 2: Manual `0001_outbox_trigger.sql`**

```sql
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox_event (created_at) WHERE dispatched_at IS NULL;

CREATE OR REPLACE FUNCTION notify_outbox() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('outbox', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS outbox_notify ON outbox_event;
CREATE TRIGGER outbox_notify AFTER INSERT ON outbox_event
  FOR EACH ROW EXECUTE FUNCTION notify_outbox();
```

- [ ] **Step 3: Integration test (testcontainers)**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";

let pg: StartedPostgreSqlContainer; let sql: ReturnType<typeof postgres>;
beforeAll(async () => {
  pg = await new PostgreSqlContainer("postgres:16").start();
  sql = postgres(pg.getConnectionUri(), { prepare: false, max: 2 });
  // apply both migration files (0000 generated + 0001 manual) against this uri
}, 120_000);
afterAll(async () => { await sql.end(); await pg.stop(); });

describe("outbox NOTIFY trigger", () => {
  it("fires pg_notify('outbox', id) on insert", async () => {
    const received: string[] = [];
    await sql.listen("outbox", (payload) => received.push(payload));
    const [row] = await sql`INSERT INTO outbox_event (aggregate, aggregate_id, type, payload)
                            VALUES ('session','s1','member.joined','{}'::jsonb) RETURNING id`;
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toContain(row.id);
  });
});
```

- [ ] **Step 4: Run → PASS.** `pnpm --filter @scope/db test outbox-trigger`
- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations packages/db/tests/outbox-trigger.test.ts
git commit -m "feat(db): outbox NOTIFY trigger + partial pending index"
```

---

### Task S6: Contract package — Zod schemas + oRPC contract + types + event union

**Files:**
- Create: `packages/contract/package.json`, `packages/contract/src/types.ts`, `packages/contract/src/events.ts`, `packages/contract/src/schemas/{session,swipe,poll}.ts`, `packages/contract/src/router.ts`, `packages/contract/src/index.ts`
- Test: `packages/contract/src/schemas/schemas.test.ts`

**Interfaces:**
- Produces (BOTH lanes import these): types `Restaurant`, `SessionState`, `Candidate`, `Member`, `Decision`, `SessionStatus`; Zod inputs `CreateSessionInput`, `JoinSessionInput`, `SessionIdInput`, `SwipeInput`, `BroadenInput`, `VoteInput`; oRPC `contract` (`Contract` type); SSE `AppEvent` discriminated union.

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@scope/contract", "version": "0.0.0", "private": true, "type": "module", "main": "src/index.ts",
  "scripts": { "check-types": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@orpc/contract": "^1.0.0", "zod": "^3.23.0" },
  "devDependencies": { "vitest": "^2.1.0", "typescript": "^5.6.0" }
}
```

- [ ] **Step 2: `types.ts`**

```ts
export type Decision = "accept" | "reject";
export type SessionStatus = "lobby" | "swiping" | "polling" | "decided" | "closed";
export interface Restaurant {
  id: string; name: string; lat: number; lng: number;
  cuisines: string[]; priceLevel?: number; rating?: number; photoRef?: string; address?: string;
}
export interface Member { userId: string; displayName: string; role: "host" | "member"; }
export interface Candidate { id: string; restaurant: Restaurant; up: number; down: number; net: number; }
export interface SessionState {
  id: string; joinCode: string; status: SessionStatus;
  members: Member[]; candidates: Candidate[]; winnerCandidateId?: string; deadline?: string;
}
```

- [ ] **Step 3: `events.ts`**

```ts
import type { Candidate, Member, Restaurant } from "./types";
export type AppEvent =
  | { type: "member.joined"; member: Member }
  | { type: "restaurant.promoted"; candidate: Candidate }
  | { type: "vote.cast"; candidateId: string; up: number; down: number; net: number }
  | { type: "poll.opened"; deadline: string; candidates: Candidate[] }
  | { type: "poll.closed"; winnerCandidateId: string }
  | { type: "deck.replenished"; restaurants: Restaurant[] }
  | { type: "prompt.broaden" };
```

- [ ] **Step 4: `schemas/*.ts`**

```ts
// session.ts
import { z } from "zod";
export const CreateSessionInput = z.object({
  centerLat: z.number(), centerLng: z.number(),
  cuisines: z.array(z.string()).default([]), radiusM: z.number().int().positive().optional(),
});
export const JoinSessionInput = z.object({ joinCode: z.string().min(4), displayName: z.string().min(1).max(40) });
export const SessionIdInput = z.object({ sessionId: z.string() });
```
```ts
// swipe.ts
import { z } from "zod";
export const SwipeInput = z.object({ sessionId: z.string(), restaurantId: z.string(), decision: z.enum(["accept","reject"]) });
export const BroadenInput = z.object({ sessionId: z.string(), addCuisines: z.array(z.string()).optional() });
```
```ts
// poll.ts
import { z } from "zod";
export const VoteInput = z.object({ sessionId: z.string(), candidateId: z.string(), value: z.union([z.literal(1), z.literal(-1)]) });
```

- [ ] **Step 5: `router.ts`**

```ts
import { oc } from "@orpc/contract";
import { z } from "zod";
import { CreateSessionInput, JoinSessionInput, SessionIdInput } from "./schemas/session";
import { SwipeInput, BroadenInput } from "./schemas/swipe";
import { VoteInput } from "./schemas/poll";
export const contract = {
  session: {
    create: oc.input(CreateSessionInput).output(z.object({ sessionId: z.string(), joinCode: z.string() })),
    join: oc.input(JoinSessionInput).output(z.object({ sessionId: z.string() })),
    get: oc.input(SessionIdInput).output(z.any()),       // SessionState (mirror later)
    startPoll: oc.input(SessionIdInput).output(z.object({ deadline: z.string() })),
    end: oc.input(SessionIdInput).output(z.object({ winnerCandidateId: z.string() })),
  },
  swipe: {
    decide: oc.input(SwipeInput).output(z.object({ promoted: z.boolean() })),
    deck: oc.input(SessionIdInput).output(z.array(z.any())),  // Restaurant[]
    broaden: oc.input(BroadenInput).output(z.object({ radiusM: z.number() })),
  },
  poll: {
    vote: oc.input(VoteInput).output(z.object({ up: z.number(), down: z.number(), net: z.number() })),
    results: oc.input(SessionIdInput).output(z.array(z.any())), // Candidate[]
  },
};
export type Contract = typeof contract;
```

> `z.any()` outputs are mirrored to explicit `SessionState`/`Candidate`/`Restaurant` Zod schemas later (backend SSE task), once shape is stable.

- [ ] **Step 6: `index.ts`** → `export * from "./types"; export * from "./events"; export * from "./router"; export * from "./schemas/session"; export * from "./schemas/swipe"; export * from "./schemas/poll";`

- [ ] **Step 7: Schema test**

```ts
import { describe, it, expect } from "vitest";
import { SwipeInput } from "./swipe";
describe("SwipeInput", () => {
  it("rejects bad decision", () => { expect(SwipeInput.safeParse({ sessionId:"s", restaurantId:"r", decision:"maybe" }).success).toBe(false); });
  it("accepts valid", () => { expect(SwipeInput.safeParse({ sessionId:"s", restaurantId:"r", decision:"accept" }).success).toBe(true); });
});
```

- [ ] **Step 8: Run + commit**

Run: `pnpm --filter @scope/contract test` → PASS.

```bash
git add packages/contract
git commit -m "feat(contract): zod schemas, orpc contract, sse event union, shared types"
```

---

## Done = both lanes unblocked

- **Frontend (Claude)** can start at **S6** (imports `@scope/contract`).
- **Backend (Codex)** Phase 1 starts after **S6** (domain core imports contract types + uses db schema).

## Self-Review (done)

- **Coverage:** monorepo(S1), env(S2), docker/pgbouncer(S3), schema auth+app+outbox + pooled/direct clients(S4), outbox trigger+index(S5), contract/types/events(S6). All foundation items from spec §4/§5/§8/§9 + type seam §7.
- **Gotchas enforced:** `prepare:false` (S4 client), two connections (S2/S4), migrations on direct url (S4 drizzle.config), `lunch_session` naming (S4), outbox same-tx capability via schema+trigger (S4/S5).
- **Type consistency:** `AppEvent`, `SessionState`, `Candidate`, `Restaurant`, contract inputs all single-sourced in S6 and reused by backend/frontend plans verbatim. Table names in S4 match backend repo task expectations.

---

## Execution Handoff

Setup plan complete. Run this first (recommend Codex). Then backend Phase 1 and frontend F0 proceed in parallel.
