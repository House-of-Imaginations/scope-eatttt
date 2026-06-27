# Accounts, Dashboard, Avatars & Rate Limiting — Backend Plan (Codex lane)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend for real accounts — anon→real linking, dashboard history queries, per-session poll options, member avatars, and two-layer rate limiting — on the existing hexagonal/outbox architecture.

**Architecture:** Domain in `packages/core` depends only on ports; concrete vendors are adapters wired at the composition root. Every command writes its domain row + an `outbox_event` row in one transaction. New work reuses these seams: new Drizzle columns + migration, new `SessionRepo` query methods, domain changes threading per-session poll options, a guarded `absorbGuest` reassignment, Better Auth `rateLimit` config backed by a Redis secondary-storage adapter, and `dashboard.*` + `auth.absorbGuest` oRPC handlers.

**Tech Stack:** Turborepo + pnpm, TypeScript, Drizzle (Postgres), oRPC + Zod, Better Auth (anon + email/Google), Redis (secondary storage), Vitest, testcontainers.

**Spec:** `docs/superpowers/specs/2026-06-27-accounts-dashboard-rate-limit-design.md`

## Global Constraints

- **Commit per** `COMMIT.md`: semantic messages (`<type>(<scope>): <subject>`), present tense, no `Co-authored-by`. 1–5 files ideal, 7 max.
- **Never import a vendor SDK from `packages/core`.** Vendors only in `packages/adapters`, wired at the composition root from env.
- **Every port ships a Fake adapter** for offline dev + tests.
- **`prepare: false`** stays on the pooled `postgres.js` connection (PgBouncer transaction mode). New queries go through the pooled `DATABASE_URL`.
- **Migrations** run via drizzle-kit on `DATABASE_DIRECT_URL` (direct, not pooled).
- **Better Auth owns** `user`/`session`/`account`/`verification` — do not hand-edit. App tables FK to `user.id` only.
- **Pinned defaults** become column defaults, not removed: `promote_threshold=2`, poll timer `300`s (5 min).
- **Consumers idempotent** on `outbox_event.id`.

---

## File Structure

- `packages/db/src/schema/app.ts` — add `title`, `poll_duration_sec`, `promote_threshold` columns to `lunch_session`.
- `packages/db/drizzle/` (migrations dir) — new generated migration.
- `packages/contract/src/schemas/session.ts` — extend `CreateSessionInput`; add `SessionSummarySchema`.
- `packages/contract/src/schemas/dashboard.ts` — **create**: dashboard query I/O schemas.
- `packages/contract/src/schemas/auth.ts` — **create**: `AbsorbGuestInput`.
- `packages/contract/src/types.ts` — add `image?` to `Member`.
- `packages/contract/src/events.ts` — add `image?` to the `member.joined` payload schema.
- `packages/contract/src/router.ts` — add `dashboard.*` and `auth.absorbGuest`.
- `packages/core/src/ports/repo.ts` — add `listSessionsForUser`, `getSessionSummary` to `SessionRepo`; add `image?` to `AddMemberRecord`.
- `packages/core/src/domain/session.ts` — thread `promoteThreshold`/`pollDurationSec`/`title`/host `image` through create/join.
- `packages/core/src/domain/poll.ts` — read `pollDurationSec` for the deadline.
- `packages/core/src/domain/swipe.ts` — read `promoteThreshold` for promotion.
- `packages/core/src/domain/dashboard.ts` — **create**: dashboard query handlers.
- `packages/core/src/domain/auth.ts` — **create**: `absorbGuest` command + guards.
- `packages/adapters/src/repo/drizzleRepo.ts` — implement the new `SessionRepo` methods; populate `image` from `user.image` join.
- `packages/adapters/src/repo/fakeRepo.ts` (or the existing in-memory fake) — mirror new methods.
- `packages/adapters/src/auth/betterauth.ts` — add `rateLimit` config + `secondaryStorage` plumbing.
- `packages/adapters/src/cache/redisSecondaryStorage.ts` — **create**: Better Auth `secondaryStorage` over the existing Redis client.
- `apps/web/src/lib/server/container.ts` — wire Redis secondary storage + new handlers.
- `apps/web/src/lib/server/orpc-handlers.*` — implement `dashboard.*` and `auth.absorbGuest` server handlers (follow existing handler file pattern).

---

## Task 1: Add poll-option columns to `lunch_session`

**Skills:** `drizzle-orm-patterns`, `postgres-best-practices`

**Files:**
- Modify: `packages/db/src/schema/app.ts:7-27` (the `lunchSession` table)
- Migration: generated into `packages/db/drizzle/`

**Interfaces:**
- Produces: `lunchSession.title: text | null`, `lunchSession.pollDurationSec: integer` (default 300), `lunchSession.promoteThreshold: integer` (default 2).

- [ ] **Step 1: Add the columns.** In `lunchSession`, after `cuisines`:

```ts
title: text("title"),
pollDurationSec: integer("poll_duration_sec").notNull().default(300),
promoteThreshold: integer("promote_threshold").notNull().default(2),
```

- [ ] **Step 2: Generate the migration.**

Run: `pnpm --filter @scope/db drizzle-kit generate` (or the repo's `db:generate` script)
Expected: a new SQL file in `packages/db/drizzle/` adding three columns with defaults.

- [ ] **Step 3: Apply against a scratch DB to confirm it runs.**

Run: `pnpm db:migrate` (uses `DATABASE_DIRECT_URL`)
Expected: migration applies; `\d lunch_session` shows the three new columns. Existing rows backfill to defaults (300 / 2 / null).

- [ ] **Step 4: Commit.**

```bash
git add packages/db/src/schema/app.ts packages/db/drizzle
git commit -m "feat(db): add per-session poll options to lunch_session"
```

---

## Task 2: Extend `CreateSessionInput` + add dashboard/auth contract schemas

**Skills:** `orpc-patterns`

**Files:**
- Modify: `packages/contract/src/schemas/session.ts`
- Modify: `packages/contract/src/types.ts:17-23` (`Member`)
- Modify: `packages/contract/src/events.ts` (member.joined payload)
- Create: `packages/contract/src/schemas/dashboard.ts`
- Create: `packages/contract/src/schemas/auth.ts`
- Test: `packages/contract/test/schemas.test.ts` (create if absent)

**Interfaces:**
- Produces:
  - `CreateSessionInput` gains `title?: string (max 60)`, `pollDurationSec?: 60|180|300|600`, `promoteThreshold?: int 1..5`.
  - `Member.image?: string`.
  - `DashboardHistoryItem = { id: string; title: string | null; joinCode: string; status: SessionStatus; createdAt: string; winnerName: string | null }`.
  - `SessionSummarySchema` → `{ id, title, joinCode, status, winnerName, candidates: Array<{ id, restaurant, netScore }>, members: Member[] }`.
  - `AbsorbGuestInput = { anonUserId: string }`.

- [ ] **Step 1: Write the failing test.** In `packages/contract/test/schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CreateSessionInput } from "../src/schemas/session";
import { AbsorbGuestInput } from "../src/schemas/auth";

describe("CreateSessionInput poll options", () => {
  it("accepts optional title, pollDurationSec, promoteThreshold", () => {
    const r = CreateSessionInput.parse({
      lat: 1, lng: 2, cuisines: ["Thai"], radiusM: 500,
      title: "Friday lunch", pollDurationSec: 180, promoteThreshold: 3,
    });
    expect(r.title).toBe("Friday lunch");
    expect(r.promoteThreshold).toBe(3);
  });
  it("still accepts the legacy shape with no options", () => {
    expect(() => CreateSessionInput.parse({ lat: 1, lng: 2, cuisines: ["Thai"], radiusM: 500 })).not.toThrow();
  });
  it("rejects promoteThreshold out of range", () => {
    expect(() => CreateSessionInput.parse({ lat: 1, lng: 2, cuisines: ["Thai"], radiusM: 500, promoteThreshold: 99 })).toThrow();
  });
});

describe("AbsorbGuestInput", () => {
  it("requires a non-empty anonUserId", () => {
    expect(() => AbsorbGuestInput.parse({ anonUserId: "" })).toThrow();
    expect(AbsorbGuestInput.parse({ anonUserId: "u1" }).anonUserId).toBe("u1");
  });
});
```

- [ ] **Step 2: Run, verify it fails.**

Run: `pnpm --filter @scope/contract test -- schemas`
Expected: FAIL — `AbsorbGuestInput`/new fields not defined.

- [ ] **Step 3: Extend `CreateSessionInput`.** Add to the existing object schema:

```ts
title: z.string().trim().min(1).max(60).optional(),
pollDurationSec: z.union([z.literal(60), z.literal(180), z.literal(300), z.literal(600)]).optional(),
promoteThreshold: z.number().int().min(1).max(5).optional(),
```

- [ ] **Step 4: Add `image?` to `Member`** (`types.ts`): add `image?: string;`. In `events.ts`, the `member.joined` payload's `member` object gains `image: z.string().optional()`.

- [ ] **Step 5: Create `schemas/auth.ts`.**

```ts
import { z } from "zod";
export const AbsorbGuestInput = z.object({ anonUserId: z.string().min(1) });
export type AbsorbGuestInput = z.infer<typeof AbsorbGuestInput>;
```

- [ ] **Step 6: Create `schemas/dashboard.ts`.**

```ts
import { z } from "zod";
import { CandidateSchema } from "../events";
import { SessionStateSchema } from "./session"; // for Member + status reuse

export const DashboardHistoryItem = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  joinCode: z.string(),
  status: z.enum(["lobby", "swiping", "polling", "decided", "closed"]),
  createdAt: z.string().datetime(),
  winnerName: z.string().nullable(),
});
export const DashboardHistory = z.array(DashboardHistoryItem);

export const SessionSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  joinCode: z.string(),
  status: z.enum(["lobby", "swiping", "polling", "decided", "closed"]),
  winnerName: z.string().nullable(),
  candidates: z.array(z.object({
    id: z.string().uuid(),
    restaurant: CandidateSchema.shape.restaurant,
    netScore: z.number().int(),
  })),
  members: SessionStateSchema.shape.members,
});
export type DashboardHistoryItem = z.infer<typeof DashboardHistoryItem>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
```

- [ ] **Step 7: Run the test, verify pass.**

Run: `pnpm --filter @scope/contract test -- schemas`
Expected: PASS.

- [ ] **Step 8: Commit.**

```bash
git add packages/contract/src packages/contract/test
git commit -m "feat(contract): add poll options, dashboard + auth schemas"
```

---

## Task 3: Add `dashboard.*` and `auth.absorbGuest` to the router

**Skills:** `orpc-patterns`

**Files:**
- Modify: `packages/contract/src/router.ts`
- Test: `packages/contract/test/router.test.ts` (extend or create)

**Interfaces:**
- Consumes: `DashboardHistory`, `SessionSummarySchema`, `AbsorbGuestInput`, `SessionIdInput`.
- Produces router procedures:
  - `dashboard.history` → input `z.object({})` → output `DashboardHistory`.
  - `dashboard.session` → input `SessionIdInput` → output `SessionSummarySchema.nullable()`.
  - `auth.absorbGuest` → input `AbsorbGuestInput` → output `z.object({ reassigned: z.boolean() })`.

- [ ] **Step 1: Write the failing test.**

```ts
import { describe, expect, it } from "vitest";
import { contract } from "../src/router";
describe("router additions", () => {
  it("exposes dashboard + auth groups", () => {
    expect(contract.dashboard.history).toBeDefined();
    expect(contract.dashboard.session).toBeDefined();
    expect(contract.auth.absorbGuest).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter @scope/contract test -- router` → FAIL.

- [ ] **Step 3: Add to the contract object.** Import the new schemas, then:

```ts
dashboard: {
  history: oc.input(z.object({})).output(DashboardHistory),
  session: oc.input(SessionIdInput).output(SessionSummarySchema.nullable()),
},
auth: {
  absorbGuest: oc.input(AbsorbGuestInput).output(z.object({ reassigned: z.boolean() })),
},
```

- [ ] **Step 4: Run, verify pass + types build.**

Run: `pnpm --filter @scope/contract test -- router && pnpm --filter @scope/contract build`
Expected: PASS, clean build (consumers get the new types).

- [ ] **Step 5: Commit.**

```bash
git add packages/contract/src/router.ts packages/contract/test
git commit -m "feat(contract): expose dashboard queries and absorbGuest"
```

---

## Task 4: Thread per-session poll options + host avatar through the domain

**Skills:** `superpowers:test-driven-development`

**Files:**
- Modify: `packages/core/src/ports/repo.ts` (`AddMemberRecord` gains `image?`; `CreateSessionRecord` gains `title?`, `pollDurationSec`, `promoteThreshold`)
- Modify: `packages/core/src/domain/session.ts`
- Test: `packages/core/test/session.test.ts` (extend existing)

**Interfaces:**
- Consumes: extended `CreateSessionInput` (Task 2).
- Produces: `createSession` persists `title`, `pollDurationSec`, `promoteThreshold` (falling back to 300/2 when absent) and accepts an optional `hostImage`; `member.joined` event payload carries `image`.

- [ ] **Step 1: Write the failing test.** Add to `session.test.ts`: create a session with `pollDurationSec: 180, promoteThreshold: 3, title: "X"` against the Fake repo; assert the persisted session record carries those values; assert the `member.joined` outbox payload includes `image` when a host image is supplied.

```ts
it("persists poll options and host image", async () => {
  const { repo, captured } = makeFakeDeps(); // existing helper
  await createSession(deps, { lat: 1, lng: 2, cuisines: ["Thai"], radiusM: 500, pollDurationSec: 180, promoteThreshold: 3, title: "X" }, "host-1", "Alice", "http://img");
  const s = repo.lastCreatedSession();
  expect(s.pollDurationSec).toBe(180);
  expect(s.promoteThreshold).toBe(3);
  expect(s.title).toBe("X");
  expect(captured.memberJoined.member.image).toBe("http://img");
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter @scope/core test -- session` → FAIL.

- [ ] **Step 3: Update `repo.ts` types.** `AddMemberRecord` gains `image?: string`. The create-session repo record type gains `title?: string`, `pollDurationSec: number`, `promoteThreshold: number`.

- [ ] **Step 4: Update `createSession`.** Add a `hostImage?: string` param after `hostDisplayName`. Pass `title: input.title`, `pollDurationSec: input.pollDurationSec ?? 300`, `promoteThreshold: input.promoteThreshold ?? 2` into `repo.createSession`, and `image: hostImage` into the member + `memberJoinedEvent`. Update `joinSession` to accept + pass an optional `image` too.

- [ ] **Step 5: Update `memberJoinedEvent`** to include `image: member.image` in the payload.

- [ ] **Step 6: Run, verify pass.** `pnpm --filter @scope/core test -- session` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/core/src/ports/repo.ts packages/core/src/domain/session.ts packages/core/test/session.test.ts
git commit -m "feat(core): thread poll options and member image through session"
```

---

## Task 5: Use per-session `promoteThreshold` and `pollDurationSec`

**Skills:** `superpowers:test-driven-development`

**Files:**
- Modify: `packages/core/src/domain/swipe.ts` (promotion uses `session.promoteThreshold`)
- Modify: `packages/core/src/domain/poll.ts` (deadline uses `session.pollDurationSec`)
- Test: `packages/core/test/swipe.test.ts`, `packages/core/test/poll.test.ts` (extend)

**Interfaces:**
- Consumes: session records now carrying `promoteThreshold`, `pollDurationSec` (Task 4).
- Produces: promotion fires at the session's threshold; poll deadline = `now + pollDurationSec`.

- [ ] **Step 1: Write failing tests.** Swipe: a session with `promoteThreshold: 3` does NOT promote on the 2nd accept but DOES on the 3rd. Poll: opening a poll on a session with `pollDurationSec: 180` sets `pollDeadlineAt = now + 180s`.

- [ ] **Step 2: Run, verify fail.** `pnpm --filter @scope/core test -- swipe poll` → FAIL (still using constants).

- [ ] **Step 3: Replace the constants.** In `swipe.ts`, read `session.promoteThreshold` instead of the hard-coded `2`. In `poll.ts`, compute the deadline from `session.pollDurationSec` instead of the hard-coded 5-minute value. Fetch the session record where the handler doesn't already have it.

- [ ] **Step 4: Run, verify pass.** `pnpm --filter @scope/core test -- swipe poll` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/domain/swipe.ts packages/core/src/domain/poll.ts packages/core/test
git commit -m "feat(core): honor per-session promote threshold and poll duration"
```

---

## Task 6: `absorbGuest` domain command + guards

**Skills:** `superpowers:test-driven-development`, `context7-cli` (Better Auth reference if needed)

**Files:**
- Create: `packages/core/src/domain/auth.ts`
- Modify: `packages/core/src/ports/repo.ts` (`UserLinkRepo` — confirm `reassignUserRows(fromUserId, toUserId)` exists; add `isAnonymousUser(userId): Promise<boolean>` if not present)
- Test: `packages/core/test/auth.test.ts`

**Interfaces:**
- Consumes: `UserLinkRepo.reassignUserRows`, `UserLinkRepo.isAnonymousUser`.
- Produces: `absorbGuest(deps, { anonUserId }, realUserId): Promise<{ reassigned: boolean }>`.

- [ ] **Step 1: Write the failing test.** Cases: (a) `anonUserId === realUserId` → no reassign, `{ reassigned: false }`; (b) `anonUserId` is not anonymous → no reassign, `false`; (c) valid anon + distinct real → calls `reassignUserRows(anon, real)`, returns `true`.

```ts
it("reassigns only a distinct, still-anonymous guest", async () => {
  const repo = makeFakeUserLinks({ anon: true });
  expect(await absorbGuest({ repo }, { anonUserId: "anon-1" }, "real-1")).toEqual({ reassigned: true });
  expect(repo.calls).toContainEqual(["anon-1", "real-1"]);
});
it("refuses when ids match or guest is not anonymous", async () => {
  expect(await absorbGuest({ repo: makeFakeUserLinks({ anon: true }) }, { anonUserId: "x" }, "x")).toEqual({ reassigned: false });
  expect(await absorbGuest({ repo: makeFakeUserLinks({ anon: false }) }, { anonUserId: "anon-1" }, "real-1")).toEqual({ reassigned: false });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter @scope/core test -- auth` → FAIL.

- [ ] **Step 3: Implement.**

```ts
import type { UserLinkRepo } from "../ports/repo";
import type { AbsorbGuestInput } from "@scope/contract";

export async function absorbGuest(
  deps: { repo: Pick<UserLinkRepo, "reassignUserRows" | "isAnonymousUser"> },
  input: AbsorbGuestInput,
  realUserId: string,
): Promise<{ reassigned: boolean }> {
  if (!input.anonUserId || input.anonUserId === realUserId) return { reassigned: false };
  if (!(await deps.repo.isAnonymousUser(input.anonUserId))) return { reassigned: false };
  await deps.repo.reassignUserRows(input.anonUserId, realUserId);
  return { reassigned: true };
}
```

- [ ] **Step 4: Run, verify pass.** `pnpm --filter @scope/core test -- auth` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/domain/auth.ts packages/core/src/ports/repo.ts packages/core/test/auth.test.ts
git commit -m "feat(core): add guarded absorbGuest command"
```

---

## Task 7: Dashboard query handlers (domain)

**Skills:** `superpowers:test-driven-development`

**Files:**
- Create: `packages/core/src/domain/dashboard.ts`
- Modify: `packages/core/src/ports/repo.ts` (add `listSessionsForUser`, `getSessionSummary`)
- Test: `packages/core/test/dashboard.test.ts`

**Interfaces:**
- Consumes: `SessionRepo.listSessionsForUser(userId): Promise<DashboardHistoryItem[]>`, `SessionRepo.getSessionSummary(sessionId): Promise<SessionSummary | null>`, and a membership check.
- Produces:
  - `listHistory(deps, userId): Promise<DashboardHistoryItem[]>`.
  - `getSessionSummary(deps, sessionId, userId): Promise<SessionSummary | null>` — returns `null` if the user is not host/member (no existence leak).

- [ ] **Step 1: Write the failing test.** `getSessionSummary` returns `null` when the requesting user is neither host nor member; returns the summary when they are. `listHistory` passes the userId through to the repo and returns its result.

- [ ] **Step 2: Run, verify fail.** `pnpm --filter @scope/core test -- dashboard` → FAIL.

- [ ] **Step 3: Implement** the two handlers; `getSessionSummary` first checks `repo.isMember(sessionId, userId) || repo.isHost(...)` and returns `null` on miss before fetching the summary.

- [ ] **Step 4: Run, verify pass.** `pnpm --filter @scope/core test -- dashboard` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/domain/dashboard.ts packages/core/src/ports/repo.ts packages/core/test/dashboard.test.ts
git commit -m "feat(core): add dashboard history and summary queries"
```

---

## Task 8: Drizzle repo — implement new methods + avatar join

**Skills:** `drizzle-orm-patterns`, `postgres-best-practices`

**Files:**
- Modify: `packages/adapters/src/repo/drizzleRepo.ts`
- Modify: `packages/adapters/src/repo/drizzleRepo.test.ts`
- Modify: the in-memory/fake repo so domain tests + offline dev keep working.

**Interfaces:**
- Consumes: schema columns from Task 1; `user.image` from the auth schema.
- Produces: concrete `createSession` (persists new columns), `addMember` (persists nothing new — image is not stored on `session_member`), `listSessionsForUser`, `getSessionSummary`, `isAnonymousUser`, and `SessionState.members[].image` populated by joining `session_member.user_id → user.image`.

- [ ] **Step 1: Write the failing test** (against the existing drizzle repo test harness): insert a host with `user.image = 'http://x'`, build session state, assert `members[0].image === 'http://x'`; insert two sessions for a user and assert `listSessionsForUser` returns both newest-first with `winnerName` resolved for a decided one.

- [ ] **Step 2: Run, verify fail.** `pnpm --filter @scope/adapters test -- drizzleRepo` → FAIL.

- [ ] **Step 3: Implement.**
  - `createSession`: include `title`, `pollDurationSec`, `promoteThreshold` in the insert.
  - State/members builder: `leftJoin(user, eq(sessionMember.userId, user.id))`, select `user.image`, map into `Member.image`.
  - `listSessionsForUser(userId)`: sessions where `hostUserId = userId` OR an exists-subquery on `session_member`; left-join winner candidate → `restaurant_cache` for `winnerName`; order by `createdAt desc`.
  - `getSessionSummary(sessionId)`: session row + candidates with net scores (reuse the existing vote-aggregation query) + members; `winnerName` resolved.
  - `isAnonymousUser(userId)`: `select isAnonymous from user where id = ?`.
  - Keep `prepare: false` semantics (no `.prepare()` calls).

- [ ] **Step 4: Run, verify pass.** `pnpm --filter @scope/adapters test -- drizzleRepo` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/adapters/src/repo
git commit -m "feat(adapters): implement dashboard queries and member avatar join"
```

---

## Task 9: Redis secondary-storage adapter for Better Auth

**Skills:** `bullmq-specialist` (Redis client patterns), `context7-cli` (Better Auth secondary-storage reference)

**Files:**
- Create: `packages/adapters/src/cache/redisSecondaryStorage.ts`
- Test: `packages/adapters/src/cache/redisSecondaryStorage.test.ts`

**Interfaces:**
- Consumes: the existing Redis client (the same one used by pub/sub + BullMQ).
- Produces: `createRedisSecondaryStorage(redis): SecondaryStorage` implementing Better Auth's `{ get(key), set(key, value, ttlSeconds?), delete(key) }`.

- [ ] **Step 1: Write the failing test** (use an in-memory Redis mock or `ioredis-mock`): `set` then `get` round-trips; `set` with ttl issues an `EX`/`PEXPIRE`; `delete` removes.

- [ ] **Step 2: Run, verify fail.** `pnpm --filter @scope/adapters test -- redisSecondaryStorage` → FAIL.

- [ ] **Step 3: Implement.**

```ts
import type { Redis } from "ioredis";
export interface SecondaryStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
}
export function createRedisSecondaryStorage(redis: Redis): SecondaryStorage {
  return {
    get: (k) => redis.get(k),
    set: async (k, v, ttl) => { ttl ? await redis.set(k, v, "EX", ttl) : await redis.set(k, v); },
    delete: async (k) => { await redis.del(k); },
  };
}
```

- [ ] **Step 4: Run, verify pass.** `pnpm --filter @scope/adapters test -- redisSecondaryStorage` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/adapters/src/cache/redisSecondaryStorage.ts packages/adapters/src/cache/redisSecondaryStorage.test.ts
git commit -m "feat(adapters): add redis secondary storage for better auth"
```

---

## Task 10: Better Auth `rateLimit` config (Layer 1)

**Skills:** `context7-cli` (Better Auth rate-limit docs — already fetched into the spec)

**Files:**
- Modify: `packages/adapters/src/auth/betterauth.ts:20-50` (the `createAuth` options)
- Modify: `apps/web/src/lib/server/auth.ts` / `container.ts` to pass the Redis secondary storage in.
- Modify: `packages/config` env schema if a `RATE_LIMIT_ENABLED` flag is added.
- Test: `apps/web/tests/auth.test.ts` (extend) or a focused config test.

**Interfaces:**
- Consumes: `createRedisSecondaryStorage` (Task 9).
- Produces: Better Auth configured with `rateLimit` + `secondaryStorage`; `customRules` on credential paths at 10/min.

- [ ] **Step 1: Write the failing test.** Assert the constructed auth options include `rateLimit.enabled`, `rateLimit.storage === "secondary-storage"`, and `customRules["/sign-in/email"].max === 10`. (Test the options factory, not a live server.)

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web test -- auth` → FAIL.

- [ ] **Step 3: Implement.** Add to `betterAuth({...})`:

```ts
secondaryStorage: options.secondaryStorage, // wired from container
rateLimit: {
  enabled: options.rateLimitEnabled ?? true,
  window: 60,
  max: 100,
  storage: "secondary-storage",
  customRules: {
    "/sign-in/email":     { window: 60, max: 10 },
    "/sign-up/email":     { window: 60, max: 10 },
    "/sign-in/anonymous": { window: 60, max: 10 },
    "/get-session": false,
  },
},
advanced: {
  ipAddress: { ipAddressHeaders: [options.trustedIpHeader ?? "x-forwarded-for"] },
},
```

Thread `secondaryStorage`, `rateLimitEnabled`, `trustedIpHeader` through `CreateAuthOptions` and `createAuthOptionsFromEnv`. Default `rateLimitEnabled` to `env.NODE_ENV === "production"` unless `RATE_LIMIT_ENABLED` overrides.

- [ ] **Step 4: Run, verify pass.** `pnpm --filter web test -- auth` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/adapters/src/auth/betterauth.ts apps/web/src/lib/server packages/config
git commit -m "feat(auth): rate-limit auth endpoints via redis secondary storage"
```

---

## Task 11: Wire `dashboard.*` + `auth.absorbGuest` server handlers

**Skills:** `orpc-patterns`, `sveltekit-data-flow`

**Files:**
- Modify: the oRPC server-handler module under `apps/web/src/lib/server/` (follow the existing `session.*`/`poll.*` handler pattern).
- Modify: `apps/web/src/lib/server/container.ts` (provide repo + auth to the new handlers).
- Test: `apps/web/tests/orpc.test.ts` (extend).

**Interfaces:**
- Consumes: domain `listHistory`, `getSessionSummary`, `absorbGuest`; `AuthProvider.requireUser`.
- Produces: live `dashboard.history`, `dashboard.session`, `auth.absorbGuest` endpoints.

- [ ] **Step 1: Write the failing test.** `dashboard.history` for a user returns their sessions; for an anonymous/no user it throws/redirects (unauthorized). `auth.absorbGuest` calls the domain command with the session's real userId. `dashboard.session` returns `null` for a non-member.

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web test -- orpc` → FAIL.

- [ ] **Step 3: Implement handlers.**
  - `dashboard.history`: `const u = await auth.requireUser(headers); if (u.isAnonymous) throw unauthorized; return listHistory({ repo }, u.id);`
  - `dashboard.session`: resolve user, return `getSessionSummary({ repo }, input.sessionId, u.id)`.
  - `auth.absorbGuest`: `const u = await auth.requireUser(headers); return absorbGuest({ repo: userLinks }, input, u.id);`

- [ ] **Step 4: Run, verify pass.** `pnpm --filter web test -- orpc` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/lib/server apps/web/tests/orpc.test.ts
git commit -m "feat(web): wire dashboard and absorbGuest handlers"
```

---

## Task 12: Integration test — dashboard over real Postgres

**Skills:** `playwright-testing` (testcontainers harness), `postgres-best-practices`

**Files:**
- Modify: `apps/web/tests/container.test.ts` (extend the existing testcontainers suite).

**Interfaces:**
- Consumes: the full stack (migrated DB + repo + handlers).

- [ ] **Step 1: Write the test.** Spin Postgres via testcontainers, run migrations, seed a host user + a decided session with a winner, call `listSessionsForUser` / `getSessionSummary`; assert the new columns migrate cleanly and `winnerName` resolves. Seed a second user and assert `getSessionSummary` returns `null` for the non-member.

- [ ] **Step 2: Run, verify pass.** `pnpm --filter web test -- container`
Expected: PASS. (First run pulls the Postgres image.)

- [ ] **Step 3: Commit.**

```bash
git add apps/web/tests/container.test.ts
git commit -m "test(web): cover dashboard queries over real postgres"
```

---

## Self-Review (backend)

- **Spec coverage:** Auth UI backend (rate-limit cfg T10, absorbGuest T6/T11) ✓; dashboard (T2/T3/T7/T8/T11/T12) ✓; poll options (T1/T2/T4/T5) ✓; avatars (T2/T4/T8) ✓; rate limiting Layer 1 (T9/T10) ✓. **Layer 2 (site-wide SvelteKit hook) is frontend-plan** (it lives in `apps/web` hooks/UI lane) — noted there.
- **Placeholders:** none; all steps carry concrete code/commands.
- **Type consistency:** `Member.image?`, `AddMemberRecord.image?`, `DashboardHistoryItem`, `SessionSummary`, `absorbGuest(...) → { reassigned }`, `createRedisSecondaryStorage` used consistently across tasks.
- **Note:** confirm `UserLinkRepo.reassignUserRows` exact name in `repo.ts` before T6; add `isAnonymousUser` there if missing (T6 covers it).
