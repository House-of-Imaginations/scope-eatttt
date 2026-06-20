# scope-eatttt Backend (P1) Implementation Plan — Codex lane

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the event-driven backend for the group lunch decider — monorepo foundation, contract/types, DB+outbox, domain core, adapters, oRPC handlers, SSE relay, and worker — so a frontend can drive swipe→poll→winner over typed RPC + live SSE.

**Architecture:** Modular monolith, hexagonal (ports & adapters). Commands/queries over oRPC; every command writes domain row + `outbox_event` in one Postgres transaction. A relay (`LISTEN outbox` on a direct connection) publishes to Redis pub/sub; an SSE gateway fans out to group members. Durable jobs (Places fetch, delayed poll-close) run on BullMQ in a separate worker process.

**Tech Stack:** Turborepo + pnpm · TypeScript strict · Drizzle ORM + drizzle-kit · postgres.js · Better Auth (anon + email/Google) · oRPC + Zod · Redis (ioredis) + BullMQ · SvelteKit adapter-node (server only here) · Vitest · testcontainers · Docker Compose · PgBouncer.

**Owner:** Codex. Frontend (Claude) consumes `packages/contract` types and the SSE endpoint; this plan stops at server + worker.

## Global Constraints

- TypeScript strict everywhere. Node ≥ 22.12.0. pnpm workspaces + Turborepo.
- **Hexagonal:** `packages/core` imports NO vendor SDK — only ports. Vendors live in `packages/adapters`, wired at one composition root from env.
- **Every port ships a Fake adapter.** Core unit tests run against Fakes only (no network, no API spend).
- **Transactional outbox:** every command writes domain row + `outbox_event` in ONE tx. Never publish events from the request path.
- **Two DB connections:** `DATABASE_URL` (PgBouncer transaction mode — all queries + NOTIFY) and `DATABASE_DIRECT_URL` (direct — relay LISTEN + drizzle-kit migrations only).
- **`prepare: false`** on the postgres.js pooled connection (prepared statements break under PgBouncer tx mode).
- Relay uses postgres.js `sql.listen()` on the DIRECT url (auto-reconnect + re-LISTEN). Never raw `pg` for the listener.
- Better Auth OWNS `user`/`session`/`account`/`verification` (generated; do not hand-edit). App tables FK `user.id` ON DELETE CASCADE. App's ephemeral session table is `lunch_session` (avoid colliding with auth `session`).
- Idempotency: UNIQUE constraints on swipe/vote; event consumers dedupe on `outbox_event.id`; BullMQ deterministic `jobId`.
- Not Vercel. Persistent Node host required (SSE/long-lived connections).
- Pinned defaults: promote_threshold=2 · reject-streak expand=5 · radius base=500m, step +500m, cap=3000m · poll timer=5min · Places cache TTL=30min · poll tie-break=earliest promoted_at.
- Commits: semantic format per `COMMIT.md`. NO `Co-authored-by`. Max 7 files/commit.

---

## File Structure

```
package.json · pnpm-workspace.yaml · turbo.json · docker-compose.yml · .env.example
packages/config/        src/env.ts (Zod env), tsconfig.base.json, eslint
packages/contract/      src/schemas/*.ts (Zod), src/router.ts (oRPC contract), src/types.ts, src/index.ts
packages/db/            src/schema/{auth,app,outbox}.ts, src/client.ts (pooled), src/listener.ts (direct),
                        drizzle.config.ts, migrations/ (+ hand-written 0001_outbox_trigger.sql)
packages/core/          src/ports/*.ts, src/domain/{session,swipe,poll}.ts, src/events.ts, src/errors.ts
packages/adapters/      src/places/{google,fake}.ts, src/bus/{redis,inmemory}.ts, src/queue/{bullmq,inline}.ts,
                        src/cache/{redis,memory}.ts, src/auth/betterauth.ts
apps/web/               src/lib/server/{container.ts, auth.ts, orpc.ts, relay.ts, sse.ts},
                        src/routes/api/rpc/[...orpc]/+server.ts, src/routes/api/sessions/[id]/events/+server.ts,
                        src/hooks.server.ts
apps/worker/            src/index.ts, src/jobs/{placesFetch,pollClose}.ts
tests/ (per package, colocated as *.test.ts; integration in packages/db/tests + apps/web/tests)
```

---

## Phase 0 — Foundation (shared; frontend depends on this)

### Task 0.1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `packages/config/tsconfig.base.json`, `packages/config/package.json`

**Interfaces:**
- Produces: workspace graph; `turbo` tasks `build`/`dev`/`check-types`/`test`/`lint`/`db:migrate`; shared tsconfig base.

- [ ] **Step 1: Write root `package.json`**

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

- [ ] **Step 2: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Write `turbo.json`**

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

- [ ] **Step 4: Write `packages/config/tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noUncheckedIndexedAccess": true, "esModuleInterop": true,
    "skipLibCheck": true, "declaration": true, "composite": true
  }
}
```

- [ ] **Step 5: Write `packages/config/package.json`**

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

### Task 0.2: Typed env (`packages/config/src/env.ts`)

**Files:**
- Create: `packages/config/src/env.ts`, `.env.example`
- Test: `packages/config/src/env.test.ts`

**Interfaces:**
- Produces: `loadEnv(): Env` returning `{ DATABASE_URL, DATABASE_DIRECT_URL, REDIS_URL, PLACES_PROVIDER, OCR_PROVIDER, GOOGLE_MAPS_API_KEY?, BETTER_AUTH_SECRET, BETTER_AUTH_URL, POLL_TIMER_MS, PROMOTE_THRESHOLD, REJECT_STREAK, RADIUS_BASE_M, RADIUS_STEP_M, RADIUS_CAP_M, PLACES_CACHE_TTL_S }`. `PLACES_PROVIDER: 'google'|'fake'`, `OCR_PROVIDER: 'mindee'|'fake'`.

- [ ] **Step 1: Write the failing test**

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
  it("throws on missing required var", () => {
    expect(() => parseEnv({})).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm --filter @scope/config test`
Expected: FAIL — `parseEnv` not exported.

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
export function parseEnv(src: Record<string, string | undefined>): Env {
  return Schema.parse(src);
}
export function loadEnv(): Env { return parseEnv(process.env); }
```

- [ ] **Step 4: Write `.env.example`**

```bash
DATABASE_URL=postgres://app:app@localhost:6432/scope_eatttt   # PgBouncer (tx mode)
DATABASE_DIRECT_URL=postgres://app:app@localhost:5432/scope_eatttt  # direct (LISTEN + migrations)
REDIS_URL=redis://localhost:6379
BETTER_AUTH_SECRET=change-me
BETTER_AUTH_URL=http://localhost:4321
PLACES_PROVIDER=fake
OCR_PROVIDER=fake
GOOGLE_MAPS_API_KEY=
```

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @scope/config test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/config/src/env.ts packages/config/src/env.test.ts .env.example
git commit -m "feat(config): zod-validated env with pinned defaults"
```

---

### Task 0.3: Docker Compose (Postgres + PgBouncer tx-mode + Redis + bull-board)

**Files:**
- Create: `docker-compose.yml`, `infra/pgbouncer/pgbouncer.ini`, `infra/pgbouncer/userlist.txt`

**Interfaces:**
- Produces: local stack mirroring prod pooling. Postgres on 5432 (direct), PgBouncer on 6432 (transaction mode), Redis on 6379.

- [ ] **Step 1: Write `docker-compose.yml`**

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

- [ ] **Step 2: Bring it up + verify both connection paths**

Run: `docker compose up -d && sleep 5 && pg_isready -h localhost -p 5432 -U app && pg_isready -h localhost -p 6432 -U app`
Expected: both report accepting connections.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml infra/
git commit -m "chore(infra): local postgres + pgbouncer (tx mode) + redis"
```

---

### Task 0.4: DB package — Better Auth schema + app schema + outbox

**Files:**
- Create: `packages/db/package.json`, `packages/db/drizzle.config.ts`, `packages/db/src/schema/{auth,app,outbox}.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/client.ts`, `packages/db/src/listener.ts`
- Test: `packages/db/src/schema/app.test.ts`

**Interfaces:**
- Produces: `db` (pooled drizzle client, `prepare:false`), `makeListener()` (direct postgres.js for LISTEN), and table objects `user, session, account, verification, lunchSession, sessionMember, restaurantCache, swipe, pollCandidate, vote, outboxEvent`.
- Consumes: `@scope/config` env.

- [ ] **Step 1: `packages/db/package.json`**

```json
{
  "name": "@scope/db", "version": "0.0.0", "private": true, "type": "module",
  "main": "src/index.ts",
  "scripts": { "db:generate": "drizzle-kit generate", "db:migrate": "drizzle-kit migrate", "check-types": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "drizzle-orm": "^0.36.0", "postgres": "^3.4.5", "@scope/config": "workspace:*" },
  "devDependencies": { "drizzle-kit": "^0.28.0", "vitest": "^2.1.0", "typescript": "^5.6.0" }
}
```

- [ ] **Step 2: Auth schema (matches Better Auth generated tables; `packages/db/src/schema/auth.ts`)**

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
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"), refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"), idToken: text("id_token"), password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});
```

> Note: after wiring Better Auth (Task 1.x) run `pnpm --filter @scope/db exec better-auth generate` to confirm this matches; reconcile any drift toward the generated output.

- [ ] **Step 3: App schema (`packages/db/src/schema/app.ts`)**

```ts
import { pgTable, text, integer, doublePrecision, timestamp, primaryKey, unique } from "drizzle-orm/pg-core";
import { user } from "./auth";

export const lunchSession = pgTable("lunch_session", {
  id: text("id").primaryKey(),
  joinCode: text("join_code").notNull().unique(),
  hostUserId: text("host_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("lobby"), // lobby|swiping|polling|decided|closed
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
  role: text("role").notNull().default("member"), // host|member
  radiusM: integer("radius_m").notNull().default(500),
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
}, (t) => ({ pk: primaryKey({ columns: [t.sessionId, t.userId] }) }));
export const restaurantCache = pgTable("restaurant_cache", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  providerPlaceId: text("provider_place_id").notNull(),
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
  decision: text("decision").notNull(), // accept|reject
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
  value: integer("value").notNull(), // +1 | -1
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({ uq: unique().on(t.sessionId, t.candidateId, t.userId) }));
```

- [ ] **Step 4: Outbox schema (`packages/db/src/schema/outbox.ts`)**

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

- [ ] **Step 5: `schema/index.ts` re-export**

```ts
export * from "./auth"; export * from "./app"; export * from "./outbox";
```

- [ ] **Step 6: Pooled client (`packages/db/src/client.ts`)**

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

- [ ] **Step 7: Direct listener factory (`packages/db/src/listener.ts`)**

```ts
import postgres from "postgres";
import { loadEnv } from "@scope/config";

export function makeListener() {
  const env = loadEnv();
  // DIRECT connection — required: PgBouncer tx mode breaks LISTEN
  return postgres(env.DATABASE_DIRECT_URL, { prepare: false, max: 1 });
}
```

- [ ] **Step 8: `drizzle.config.ts` (migrations use DIRECT url)**

```ts
import { defineConfig } from "drizzle-kit";
import { loadEnv } from "@scope/config";
const env = loadEnv();
export default defineConfig({
  schema: "./src/schema/*.ts", out: "./migrations", dialect: "postgresql",
  dbCredentials: { url: env.DATABASE_DIRECT_URL },
});
```

- [ ] **Step 9: Schema smoke test (no DB needed)**

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

- [ ] **Step 10: Run + commit (split into ≤7 file commits)**

Run: `pnpm --filter @scope/db test`
Expected: PASS.

```bash
git add packages/db/package.json packages/db/drizzle.config.ts packages/db/src/schema packages/db/src/client.ts packages/db/src/listener.ts packages/db/src/index.ts
git commit -m "feat(db): drizzle schema (auth+app+outbox) with pooled + direct clients"
git add packages/db/src/schema/app.test.ts
git commit -m "test(db): schema export smoke test"
```

---

### Task 0.5: Hand-written outbox migration (NOTIFY trigger + partial index)

**Files:**
- Create: `packages/db/migrations/0001_outbox_trigger.sql` (manual, runs after generated migration)
- Test: `packages/db/tests/outbox-trigger.test.ts` (testcontainers integration)

**Interfaces:**
- Produces: `AFTER INSERT` trigger on `outbox_event` that `NOTIFY outbox` with the row id; partial index `WHERE dispatched_at IS NULL`.

- [ ] **Step 1: Generate base migration from schema**

Run: `pnpm --filter @scope/db db:generate`
Expected: a `0000_*.sql` created in `migrations/`.

- [ ] **Step 2: Write the manual migration `0001_outbox_trigger.sql`**

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

- [ ] **Step 3: Write integration test (testcontainers)**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";

let pg: StartedPostgreSqlContainer; let sql: ReturnType<typeof postgres>;
beforeAll(async () => {
  pg = await new PostgreSqlContainer("postgres:16").start();
  sql = postgres(pg.getConnectionUri(), { prepare: false, max: 2 });
  // apply migrations (run drizzle-kit migrate against this uri, or inline the two SQL files)
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

- [ ] **Step 4: Run + verify**

Run: `pnpm --filter @scope/db test outbox-trigger`
Expected: PASS (NOTIFY received).

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations packages/db/tests/outbox-trigger.test.ts
git commit -m "feat(db): outbox NOTIFY trigger + partial pending index"
```

---

### Task 0.6: Contract package — Zod schemas + oRPC contract + domain types

**Files:**
- Create: `packages/contract/package.json`, `packages/contract/src/schemas/*.ts`, `packages/contract/src/types.ts`, `packages/contract/src/router.ts`, `packages/contract/src/events.ts`, `packages/contract/src/index.ts`
- Test: `packages/contract/src/schemas/schemas.test.ts`

**Interfaces:**
- Produces (frontend + backend both import these):
  - Types: `Restaurant`, `SessionState`, `Candidate`, `Member`, `Decision='accept'|'reject'`.
  - Zod inputs: `CreateSessionInput`, `JoinSessionInput`, `SwipeInput`, `VoteInput`, etc.
  - oRPC `contract` (the router shape) — implemented by backend in Task 2.x, typed-consumed by frontend.
  - SSE event union `AppEvent` (discriminated on `type`).

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@scope/contract", "version": "0.0.0", "private": true, "type": "module",
  "main": "src/index.ts",
  "scripts": { "check-types": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@orpc/contract": "^1.0.0", "zod": "^3.23.0" },
  "devDependencies": { "vitest": "^2.1.0", "typescript": "^5.6.0" }
}
```

- [ ] **Step 2: Domain types (`src/types.ts`)**

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

- [ ] **Step 3: Zod input schemas (`src/schemas/session.ts`, `swipe.ts`, `poll.ts`)**

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
export const SwipeInput = z.object({
  sessionId: z.string(), restaurantId: z.string(), decision: z.enum(["accept","reject"]),
});
export const BroadenInput = z.object({ sessionId: z.string(), addCuisines: z.array(z.string()).optional() });
```
```ts
// poll.ts
import { z } from "zod";
export const VoteInput = z.object({ sessionId: z.string(), candidateId: z.string(), value: z.union([z.literal(1), z.literal(-1)]) });
```

- [ ] **Step 4: SSE event union (`src/events.ts`)**

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

- [ ] **Step 5: oRPC contract (`src/router.ts`)**

```ts
import { oc } from "@orpc/contract";
import { z } from "zod";
import { CreateSessionInput, JoinSessionInput, SessionIdInput } from "./schemas/session";
import { SwipeInput, BroadenInput } from "./schemas/swipe";
import { VoteInput } from "./schemas/poll";
// Output schemas kept light here; mirror SessionState/Candidate from types.ts
export const contract = {
  session: {
    create: oc.input(CreateSessionInput).output(z.object({ sessionId: z.string(), joinCode: z.string() })),
    join: oc.input(JoinSessionInput).output(z.object({ sessionId: z.string() })),
    get: oc.input(SessionIdInput).output(z.any()),       // SessionState
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

> Note: replace `z.any()` outputs with explicit Zod mirrors of `SessionState`/`Candidate`/`Restaurant` once stable. Tracked in Task 2.6.

- [ ] **Step 6: `index.ts`**

```ts
export * from "./types"; export * from "./events"; export * from "./router";
export * as schemas from "./schemas/session";
```

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

Run: `pnpm --filter @scope/contract test`
Expected: PASS.

```bash
git add packages/contract
git commit -m "feat(contract): zod schemas, orpc contract, sse event union, shared types"
```

**>>> FRONTEND UNBLOCKED HERE:** after Task 0.6, the frontend plan can start (it imports `@scope/contract` types + mocks handlers).

---

## Phase 1 — Domain core + ports + adapters

### Task 1.1: Ports (`packages/core/src/ports/*.ts`)

**Files:**
- Create: `packages/core/package.json`, `packages/core/src/ports/{places,bus,queue,cache,auth}.ts`, `packages/core/src/errors.ts`
- Test: none (interfaces only).

**Interfaces:**
- Produces:
  - `PlacesProvider { searchNearby(q: NearbyQuery): Promise<Restaurant[]> }`, `NearbyQuery = { lat; lng; radiusM; cuisines: string[]; limit: number }`
  - `EventBus { publish(channel: string, ev: AppEvent & { id: string }): Promise<void>; subscribe(channel: string, cb: (ev) => void): Promise<() => void> }`
  - `JobQueue { enqueue(name, data, opts?): Promise<void>; process(name, handler): void }`
  - `Cache { get<T>(k): Promise<T|null>; set<T>(k, v, ttlS): Promise<void> }`
  - `AuthProvider { getUser(headers): Promise<{ id: string; displayName: string; isAnonymous: boolean } | null> }`
  - errors: `SessionClosedError`, `NotHostError`, `NotMemberError`, `ProviderError`.

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@scope/core", "version": "0.0.0", "private": true, "type": "module", "main": "src/index.ts",
  "scripts": { "check-types": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@scope/contract": "workspace:*" },
  "devDependencies": { "vitest": "^2.1.0", "typescript": "^5.6.0" }
}
```

- [ ] **Step 2: Write ports** (one file each, signatures above). Example `places.ts`:

```ts
import type { Restaurant } from "@scope/contract";
export interface NearbyQuery { lat: number; lng: number; radiusM: number; cuisines: string[]; limit: number; }
export interface PlacesProvider { searchNearby(q: NearbyQuery): Promise<Restaurant[]>; }
```

- [ ] **Step 3: Errors (`errors.ts`)**

```ts
export class DomainError extends Error { constructor(public code: string, msg: string) { super(msg); } }
export class SessionClosedError extends DomainError { constructor(){ super("SESSION_CLOSED","session closed"); } }
export class NotHostError extends DomainError { constructor(){ super("NOT_HOST","host only"); } }
export class NotMemberError extends DomainError { constructor(){ super("NOT_MEMBER","not a member"); } }
export class ProviderError extends DomainError { constructor(m="provider unavailable"){ super("UNAVAILABLE",m); } }
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/package.json packages/core/src/ports packages/core/src/errors.ts
git commit -m "feat(core): ports (places/bus/queue/cache/auth) + domain errors"
```

---

### Task 1.2: Fake adapters (`packages/core/src/testing/*.ts`)

**Files:**
- Create: `packages/core/src/testing/{fakePlaces,inMemoryBus,inlineQueue,memoryCache}.ts`
- Test: `packages/core/src/testing/fakes.test.ts`

**Interfaces:**
- Produces: `FakePlaces` (returns N deterministic restaurants), `InMemoryBus` (publish→synchronous local subscribers, records published events), `InlineQueue` (runs handlers immediately), `MemoryCache` (Map + ttl ignored). Used by all core tests + offline dev.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { InMemoryBus } from "./inMemoryBus";
describe("InMemoryBus", () => {
  it("delivers published events to channel subscribers", async () => {
    const bus = new InMemoryBus(); const got: any[] = [];
    await bus.subscribe("session:s1", (e) => got.push(e));
    await bus.publish("session:s1", { id:"e1", type:"prompt.broaden" } as any);
    expect(got).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @scope/core test` → FAIL.

- [ ] **Step 3: Implement fakes.** `inMemoryBus.ts`:

```ts
import type { EventBus } from "../ports/bus";
export class InMemoryBus implements EventBus {
  published: { channel: string; ev: any }[] = [];
  private subs = new Map<string, Set<(e:any)=>void>>();
  async publish(channel: string, ev: any) { this.published.push({channel,ev}); this.subs.get(channel)?.forEach(cb=>cb(ev)); }
  async subscribe(channel: string, cb: (e:any)=>void) {
    const set = this.subs.get(channel) ?? new Set(); set.add(cb); this.subs.set(channel,set);
    return () => set.delete(cb);
  }
}
```
`fakePlaces.ts` returns deterministic list sized to `q.limit`; `inlineQueue.ts` stores handlers and runs on enqueue; `memoryCache.ts` Map-backed.

- [ ] **Step 4: Run → pass.** `pnpm --filter @scope/core test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/testing
git commit -m "feat(core): fake adapters (places/bus/queue/cache) for tests + offline dev"
```

---

### Task 1.3: Session domain service (create/join + outbox event)

**Files:**
- Create: `packages/core/src/domain/session.ts`
- Test: `packages/core/src/domain/session.test.ts`

**Interfaces:**
- Consumes: a `Repo` port (DB operations) + `EventBus`. Define `SessionRepo` in `ports/repo.ts` with methods used here: `createSession`, `addMember`, `getSession`, `listMembers`, and `appendOutbox(tx, event)` — but since outbox must be same-tx, expose `withTx(fn)` and `insertOutbox`. Keep DB-specific impl in `packages/db` adapter (Task 2.1); core depends only on the `SessionRepo` interface.
- Produces: `createSession(input, hostUserId)`, `joinSession(input, userId)` returning ids; each emits an `outbox` event via repo within the tx.

- [ ] **Step 1: Define `SessionRepo` port**

```ts
// ports/repo.ts
import type { AppEvent } from "@scope/contract";
export interface OutboxWrite { aggregate: string; aggregateId: string; type: AppEvent["type"]; payload: unknown; }
export interface Tx { /* opaque handle */ }
export interface SessionRepo {
  withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  insertOutbox(tx: Tx, e: OutboxWrite): Promise<string>; // returns event id
  createSession(tx: Tx, data: { id:string; joinCode:string; hostUserId:string; centerLat:number; centerLng:number; baseRadiusM:number; cuisines:string[]; expiresAt:Date }): Promise<void>;
  addMember(tx: Tx, m: { sessionId:string; userId:string; role:"host"|"member"; radiusM:number; displayName:string }): Promise<void>;
  getSessionStatus(sessionId: string): Promise<string | null>;
}
```

- [ ] **Step 2: Failing test (against fakes + a fake repo)**

```ts
import { describe, it, expect } from "vitest";
import { createSession } from "./session";
import { makeFakeRepo } from "../testing/fakeRepo"; // simple in-memory SessionRepo
describe("createSession", () => {
  it("creates session, adds host as member, emits member.joined in same tx", async () => {
    const repo = makeFakeRepo();
    const r = await createSession({ centerLat:1, centerLng:2, cuisines:["sushi"] }, "u1", { repo, radiusBaseM:500, ttlMs:3_600_000, genId:()=>"id", genCode:()=>"ABCD" });
    expect(r.joinCode).toBe("ABCD");
    expect(repo.outbox.map(o=>o.type)).toContain("member.joined");
    expect(repo.members[0]).toMatchObject({ role:"host" });
  });
});
```

- [ ] **Step 3: Run → fail.**

- [ ] **Step 4: Implement `session.ts`** (createSession + joinSession; both wrap `repo.withTx`, write domain rows + `insertOutbox`). Include `makeFakeRepo` in testing/.

- [ ] **Step 5: Run → pass.**

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/domain/session.ts packages/core/src/ports/repo.ts packages/core/src/testing/fakeRepo.ts packages/core/src/domain/session.test.ts
git commit -m "feat(core): session domain (create/join) with same-tx outbox"
```

---

### Task 1.4: Swipe domain — promote rule + radius/streak

**Files:**
- Create: `packages/core/src/domain/swipe.ts`
- Test: `packages/core/src/domain/swipe.test.ts`

**Interfaces:**
- Consumes: extend `SessionRepo` with `recordSwipe(tx, ...)` (UNIQUE-safe upsert), `countAccepts(tx, sessionId, restaurantId)`, `isCandidate(tx, sessionId, restaurantId)`, `addCandidate(tx, ...)`, plus a `StreakStore` port (`incr`, `reset`, `get`) backed by Cache/Redis; `updateMemberRadius(tx, sessionId, userId, radiusM)`.
- Produces: `decideSwipe(input, userId, deps): Promise<{ promoted: boolean }>` and `evaluateRadius(streak, deckLeft, member, cfg): { newRadiusM?: number; broaden?: boolean }` (pure, fully unit-tested).

- [ ] **Step 1: Failing tests (pure rule + promote)**

```ts
import { describe, it, expect } from "vitest";
import { evaluateRadius } from "./swipe";
const cfg = { base:500, step:500, cap:3000, streakTrigger:5 };
describe("evaluateRadius", () => {
  it("expands radius when streak hits trigger", () => {
    expect(evaluateRadius(5, 4, { radiusM:500 }, cfg)).toEqual({ newRadiusM:1000 });
  });
  it("expands when deck low", () => {
    expect(evaluateRadius(1, 2, { radiusM:500 }, cfg)).toEqual({ newRadiusM:1000 });
  });
  it("prompts broaden at cap and dry", () => {
    expect(evaluateRadius(6, 1, { radiusM:3000 }, cfg)).toEqual({ broaden:true });
  });
  it("no-op otherwise", () => {
    expect(evaluateRadius(1, 9, { radiusM:500 }, cfg)).toEqual({});
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement `evaluateRadius` (pure) + `decideSwipe`** (records swipe in tx; if accept and `countAccepts >= threshold` and `!isCandidate` → addCandidate + insertOutbox `restaurant.promoted`; manage streak via StreakStore; return promoted bool). The radius-expansion side-effects (enqueue places.fetch, emit deck.replenished) are triggered here by enqueuing a job — but keep `decideSwipe` returning a typed `effects` list the caller acts on, OR inject `JobQueue` + `EventBus`. Use injected deps.

- [ ] **Step 4: Add promote integration-ish test with fakeRepo** (two distinct users accept same restaurant → second returns promoted:true, outbox has one `restaurant.promoted`).

- [ ] **Step 5: Run → pass.**

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/domain/swipe.ts packages/core/src/domain/swipe.test.ts packages/core/src/ports/repo.ts
git commit -m "feat(core): swipe domain — promote threshold + radius/streak rules"
```

---

### Task 1.5: Poll domain — vote tally + winner calc

**Files:**
- Create: `packages/core/src/domain/poll.ts`
- Test: `packages/core/src/domain/poll.test.ts`

**Interfaces:**
- Consumes: repo `startPoll(tx, sessionId, deadline)`, `upsertVote(tx, ...)`, `tally(tx, candidateId): {up,down,net}`, `listCandidatesWithTally(sessionId)`, `closePoll(tx, sessionId, winnerId)`, `getCandidatesPromotedAt(sessionId)`.
- Produces: `startPoll(sessionId, hostUserId, deps): { deadline }` (host-guarded, emits `poll.opened`, enqueues delayed `poll.close`), `castVote(input, userId, deps): {up,down,net}` (upsert + `vote.cast`), `computeWinner(candidates): string` (pure: max net, tie→earliest promotedAt), `closePoll(sessionId, deps): { winnerCandidateId }` (idempotent on status=decided, emits `poll.closed`).

- [ ] **Step 1: Failing pure-winner test**

```ts
import { describe, it, expect } from "vitest";
import { computeWinner } from "./poll";
describe("computeWinner", () => {
  it("picks max net", () => {
    expect(computeWinner([{id:"a",net:2,promotedAt:2},{id:"b",net:5,promotedAt:9}])).toBe("b");
  });
  it("breaks tie by earliest promotedAt", () => {
    expect(computeWinner([{id:"a",net:3,promotedAt:9},{id:"b",net:3,promotedAt:2}])).toBe("b");
  });
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement poll.ts** (computeWinner pure; startPoll/castVote/closePoll with deps, host guard via repo role check, idempotent close).
- [ ] **Step 4: Add castVote test** (upsert changes value, tally reflects, outbox `vote.cast`).
- [ ] **Step 5: Run → pass.**
- [ ] **Step 6: Commit**

```bash
git add packages/core/src/domain/poll.ts packages/core/src/domain/poll.test.ts packages/core/src/ports/repo.ts
git commit -m "feat(core): poll domain — tally, vote upsert, winner calc, idempotent close"
```

---

### Task 1.6: Real adapters — Google Places, Redis bus, BullMQ queue, Redis cache

**Files:**
- Create: `packages/adapters/package.json`, `packages/adapters/src/places/google.ts`, `packages/adapters/src/bus/redis.ts`, `packages/adapters/src/queue/bullmq.ts`, `packages/adapters/src/cache/redis.ts`, `packages/adapters/src/auth/betterauth.ts`
- Test: `packages/adapters/src/places/google.test.ts` (mapping test, mocked fetch), `packages/adapters/src/contract.test.ts` (each real adapter passes the same port suite as its Fake — run Redis ones against testcontainers Redis)

**Interfaces:**
- Produces concrete implementations of every port. `GooglePlaces` maps Places (New) `searchNearby` JSON → `Restaurant[]` with field mask; respects `Cache` (key `geohash6:radius:cuisines`, TTL from env). `RedisBus` = ioredis pub/sub. `BullQueue` = BullMQ with deterministic jobIds. `RedisCache` = ioredis get/setex.

- [ ] **Step 1: Failing mapping test for GooglePlaces (mock fetch)**

```ts
import { describe, it, expect, vi } from "vitest";
import { GooglePlaces } from "./google";
describe("GooglePlaces.searchNearby", () => {
  it("maps places JSON to domain Restaurant and applies field mask", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok:true, json: async () => ({ places: [
      { id:"p1", displayName:{text:"Sushi Co"}, location:{latitude:1,longitude:2}, types:["sushi_restaurant"], rating:4.5, priceLevel:"PRICE_LEVEL_MODERATE" }
    ]})});
    const p = new GooglePlaces({ apiKey:"k", cache: new (await import("@scope/core/testing")).MemoryCache(), ttlS:1800, fetch: fetchMock as any });
    const r = await p.searchNearby({ lat:1, lng:2, radiusM:500, cuisines:["sushi"], limit:5 });
    expect(r[0]).toMatchObject({ id:"p1", name:"Sushi Co", lat:1, lng:2 });
    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers["X-Goog-FieldMask"]).toContain("places.displayName");
  });
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement adapters.** GooglePlaces: POST `places:searchNearby`, header `X-Goog-Api-Key` + `X-Goog-FieldMask: places.id,places.displayName,places.location,places.types,places.rating,places.priceLevel`, map priceLevel enum→int, wrap non-ok into `ProviderError`, cache-aside via injected `Cache`. RedisBus/BullQueue/RedisCache via ioredis/bullmq.
- [ ] **Step 4: Port contract test** — run the same assertion suite the Fakes pass; Redis-backed ones use `@testcontainers/redis`.
- [ ] **Step 5: Run → pass.**
- [ ] **Step 6: Commit (split adapters across ≤7-file commits)**

```bash
git add packages/adapters/package.json packages/adapters/src/places packages/adapters/src/cache
git commit -m "feat(adapters): google places (field-masked, cache-aside) + redis cache"
git add packages/adapters/src/bus packages/adapters/src/queue
git commit -m "feat(adapters): redis pub/sub bus + bullmq queue"
```

---

## Phase 2 — Wiring: DB repo, Better Auth, oRPC server, relay, SSE, worker

### Task 2.1: DB-backed `SessionRepo` (`packages/adapters/src/repo/drizzleRepo.ts`)

**Files:**
- Create: `packages/adapters/src/repo/drizzleRepo.ts`
- Test: `packages/adapters/src/repo/drizzleRepo.test.ts` (testcontainers Postgres + migrations)

**Interfaces:**
- Produces: `DrizzleSessionRepo implements SessionRepo` — `withTx` uses `db.transaction`, `insertOutbox` inserts into `outbox_event` returning id, all domain ops via drizzle. **The same-tx guarantee lives here.**

- [ ] **Step 1: Failing integration test** — `withTx` writes a lunch_session row + an outbox_event row atomically; rollback on throw leaves neither.

```ts
it("rolls back domain + outbox together on error", async () => {
  const repo = new DrizzleSessionRepo(db);
  await expect(repo.withTx(async (tx) => {
    await repo.createSession(tx, { id:"s1", joinCode:"AAAA", hostUserId:"u1", centerLat:1, centerLng:2, baseRadiusM:500, cuisines:[], expiresAt:new Date(Date.now()+1e6) });
    await repo.insertOutbox(tx, { aggregate:"session", aggregateId:"s1", type:"member.joined", payload:{} });
    throw new Error("boom");
  })).rejects.toThrow();
  const rows = await db.select().from(schema.lunchSession);
  expect(rows).toHaveLength(0);
});
```
(requires seeding a `user` row `u1` first.)

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement `DrizzleSessionRepo`** covering every method the domain needs (Tasks 1.3–1.5).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/repo packages/adapters/src/repo/drizzleRepo.test.ts
git commit -m "feat(adapters): drizzle SessionRepo with same-tx domain+outbox writes"
```

---

### Task 2.2: Better Auth wiring + AuthProvider adapter

**Files:**
- Create: `apps/web/package.json` (SvelteKit app), `apps/web/src/lib/server/auth.ts`, `packages/adapters/src/auth/betterauth.ts`, `apps/web/src/hooks.server.ts`
- Test: `apps/web/tests/auth.test.ts` (anon session creation; getUser maps to domain identity)

**Interfaces:**
- Produces: configured `auth` (Better Auth, drizzleAdapter, anonymous plugin + email/Google, `user.additionalFields.displayName`), `BetterAuthProvider implements AuthProvider`, and `hooks.server.ts` populating `event.locals.user/session` per the documented manual pattern.

- [ ] **Step 1: Configure Better Auth** (`auth.ts`): drizzle adapter over `@scope/db`, plugins `anonymous()`, email/password + Google, `user: { additionalFields: { displayName: { type:"string", required:false } } }`. Set `onLinkAccount` stub that calls a repo method to re-point app rows (P1: re-point `session_member`, `swipe`, `vote`).

- [ ] **Step 2: Generate + reconcile schema**

Run: `pnpm --filter web exec better-auth generate`
Expected: confirms `user/session/account/verification` match `packages/db/src/schema/auth.ts`; reconcile drift.

- [ ] **Step 3: `hooks.server.ts` (manual locals population — documented gotcha)**

```ts
import { auth } from "$lib/server/auth";
import { svelteKitHandler } from "better-auth/svelte-kit";
export async function handle({ event, resolve }) {
  const s = await auth.api.getSession({ headers: event.request.headers });
  event.locals.user = s?.user ?? null; event.locals.session = s?.session ?? null;
  return svelteKitHandler({ event, resolve, auth });
}
```

- [ ] **Step 4: `BetterAuthProvider`** maps `auth.api.getSession` → `{ id, displayName, isAnonymous }`.

- [ ] **Step 5: Test** anon sign-in yields a user with `isAnonymous:true`; getUser returns mapped identity.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/src/lib/server/auth.ts apps/web/src/hooks.server.ts packages/adapters/src/auth/betterauth.ts apps/web/tests/auth.test.ts
git commit -m "feat(auth): better-auth (anon+email/google) + AuthProvider adapter + sveltekit hook"
```

---

### Task 2.3: Composition root (`apps/web/src/lib/server/container.ts`)

**Files:**
- Create: `apps/web/src/lib/server/container.ts`
- Test: `apps/web/tests/container.test.ts`

**Interfaces:**
- Produces: `buildContainer(env)` returning `{ repo, bus, queue, cache, places, auth }` with adapters selected by `env.PLACES_PROVIDER`/etc. Single place that imports vendor adapters. Domain services receive these.

- [ ] **Step 1: Test** — with `PLACES_PROVIDER=fake`, container.places is FakePlaces; with `google`, GooglePlaces.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement `buildContainer`** (switch on env; construct Redis/BullMQ from `REDIS_URL`, DrizzleSessionRepo from `db`).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/container.ts apps/web/tests/container.test.ts
git commit -m "feat(web): composition root wiring adapters from env"
```

---

### Task 2.4: oRPC server handlers (`apps/web/src/lib/server/orpc.ts` + route)

**Files:**
- Create: `apps/web/src/lib/server/orpc.ts`, `apps/web/src/routes/api/rpc/[...orpc]/+server.ts`
- Test: `apps/web/tests/orpc.test.ts`

**Interfaces:**
- Consumes: `contract` (Task 0.6), domain services (1.3–1.5), container (2.3), auth (2.2).
- Produces: oRPC implementation of every contract procedure; middleware injecting `ctx.user`; guards `requireMember`/`requireHost`; SvelteKit GET/POST handler.

- [ ] **Step 1: Test** — calling `session.create` then `session.join` with the in-process oRPC client returns ids; `swipe.decide` without membership throws `NOT_MEMBER`.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement handlers** mapping each procedure to a domain call with deps from container; middleware reads `event.locals.user`; map `DomainError.code` → oRPC error codes.
- [ ] **Step 4: Mount route** (`createServerHandler(contract, impl)` exporting GET+POST per oRPC SvelteKit adapter).
- [ ] **Step 5: Run → pass.**
- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/orpc.ts "apps/web/src/routes/api/rpc/[...orpc]/+server.ts" apps/web/tests/orpc.test.ts
git commit -m "feat(web): orpc handlers + auth middleware + member/host guards"
```

---

### Task 2.5: Outbox relay (`apps/web/src/lib/server/relay.ts`)

**Files:**
- Create: `apps/web/src/lib/server/relay.ts`
- Test: `apps/web/tests/relay.test.ts` (testcontainers Postgres + Redis)

**Interfaces:**
- Consumes: `makeListener()` (direct DB), `EventBus`, `db`.
- Produces: `startRelay({ listener, bus, db })` — `LISTEN outbox`; on notify, load pending row(s), `bus.publish('session:'+aggregateId, {id,type,...payload})`, set `dispatched_at`. On startup, drain any pending rows (crash recovery). Fallback: 1s poll loop if listener disconnects beyond retries.

- [ ] **Step 1: Integration test** — insert an outbox_event → relay publishes to `session:{id}` channel on RedisBus → assert a subscriber receives `{id,type}`; `dispatched_at` set.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement relay** (postgres.js `sql.listen('outbox', cb)` on direct url; idempotent dispatch guarded by `dispatched_at IS NULL`; startup drain).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/relay.ts apps/web/tests/relay.test.ts
git commit -m "feat(web): outbox relay — LISTEN(direct)->redis publish, at-least-once + startup drain"
```

---

### Task 2.6: SSE gateway (`apps/web/src/routes/api/sessions/[id]/events/+server.ts`)

**Files:**
- Create: `apps/web/src/lib/server/sse.ts`, `apps/web/src/routes/api/sessions/[id]/events/+server.ts`
- Test: `apps/web/tests/sse.test.ts`

**Interfaces:**
- Consumes: `EventBus.subscribe`, `db` (for `Last-Event-ID` replay from outbox).
- Produces: GET handler returning a `ReadableStream` (SSE). Subscribes `session:{id}`, writes `id:`+`data:` frames, 25s heartbeat. On connect with `Last-Event-ID`, first replays outbox rows for that aggregateId after that id, then live.

- [ ] **Step 1: Test** — open stream (mocked), publish an event on the bus → frame appears with matching `data`. With `Last-Event-ID`, missed rows replay first.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** SSE stream + replay + heartbeat + cleanup (unsubscribe on cancel). Also replace remaining `z.any()` contract outputs (Task 0.6 note) with explicit Zod mirrors here, since SessionState shape is now stable.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/sse.ts "apps/web/src/routes/api/sessions/[id]/events/+server.ts" apps/web/tests/sse.test.ts
git commit -m "feat(web): SSE gateway with Last-Event-ID replay + heartbeat"
```

---

### Task 2.7: Worker — places.fetch + delayed poll.close

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/src/index.ts`, `apps/worker/src/jobs/{placesFetch,pollClose}.ts`
- Test: `apps/worker/tests/jobs.test.ts`

**Interfaces:**
- Consumes: container (places, repo, bus, queue).
- Produces: BullMQ worker processing `places.fetch` (call PlacesProvider → upsert restaurant_cache → emit `deck.replenished` via outbox) and `poll.close` (compute winner via poll domain → close → outbox `poll.closed`). Deterministic jobIds.

- [ ] **Step 1: Test poll.close job** — given candidates with tallies, job writes winner + emits `poll.closed`; running twice is a no-op (status=decided guard).
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement jobs + worker bootstrap** (`buildContainer` then `queue.process(name, handler)`).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit**

```bash
git add apps/worker
git commit -m "feat(worker): places.fetch + delayed poll.close jobs"
```

---

### Task 2.8: End-to-end backend integration (no UI)

**Files:**
- Create: `apps/web/tests/e2e-backend.test.ts` (testcontainers Postgres+Redis, real relay + SSE + worker)

**Interfaces:**
- Consumes: everything.

- [ ] **Step 1: Test the full happy path** via oRPC + SSE:
  1. host `session.create` → join code
  2. two members `session.join`
  3. members `swipe.decide` same restaurant (2 accepts) → SSE `restaurant.promoted` received by all
  4. host `session.startPoll` → SSE `poll.opened`
  5. members `poll.vote` → SSE `vote.cast` tallies
  6. force `poll.close` job → SSE `poll.closed` with correct winner
- [ ] **Step 2: Run → iterate until green.**

Run: `pnpm --filter web test e2e-backend`
Expected: PASS — events arrive over SSE in order; winner correct.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e-backend.test.ts
git commit -m "test(web): backend e2e — swipe->promote->poll->vote->winner over SSE"
```

---

## Self-Review (done)

- **Spec coverage:** monorepo(0.1), env(0.2), docker/pgbouncer(0.3), auth+app+outbox schema(0.4), outbox trigger(0.5), contract/types/events(0.6), ports(1.1), fakes(1.2), session(1.3), swipe+radius(1.4), poll+winner(1.5), real adapters+Places field-mask+cache(1.6), drizzle repo same-tx(2.1), better-auth+anon+AuthProvider(2.2), container(2.3), oRPC+guards(2.4), relay LISTEN-direct(2.5), SSE+replay(2.6), worker jobs(2.7), backend e2e(2.8). All §4–§11 backend items mapped. Bill-split(§ P2) intentionally excluded.
- **Gotchas enforced:** `prepare:false` (0.4/client), two connections (0.2/0.4/2.5), postgres.js listen on direct (0.4/2.5), field mask (1.6), no-Vercel host noted in spec, OCR out of scope.
- **Type consistency:** `SessionRepo` extended additively across 1.3–1.5; `AppEvent` union single source (0.6) used by relay/sse/worker; `Restaurant`/`Candidate`/`SessionState` from contract throughout.

---

## Execution Handoff

Backend plan complete. Frontend plan is separate (next file). Execution options offered after both plans are written.
