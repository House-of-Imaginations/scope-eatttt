# Backend Handoff — accounts, dashboard, avatars, rate limiting

**From:** Frontend lane (Claude) · **To:** Backend lane (Codex) · **Date:** 2026-06-27

**Why:** New round adds real accounts + the surfaces around them. Per `AGENTS.md` lane split, **backend builds the domain/contract/adapters/db**; frontend builds the SvelteKit UI on top. The frontend plan is **blocked on your contract types** for most tasks — build this first.

**Read first:**
- Spec: `docs/superpowers/specs/2026-06-27-accounts-dashboard-rate-limit-design.md`
- Your plan: `docs/superpowers/plans/2026-06-27-accounts-dashboard-backend.md` (12 tasks, TDD, full code in each step)

**Execute the plan task-by-task.** This doc is the orientation + the non-obvious gotchas; the plan is the spec of record.

---

## What you're building (12 tasks)

1. **DB columns** — `lunch_session.title`, `.poll_duration_sec` (default 300), `.promote_threshold` (default 2). Migration via drizzle-kit on `DATABASE_DIRECT_URL`.
2. **Contract schemas** — extend `CreateSessionInput` (3 optional fields); add `Member.image?`, `member.joined` payload `image`; create `schemas/dashboard.ts` + `schemas/auth.ts`.
3. **Router** — `dashboard.history`, `dashboard.session`, `auth.absorbGuest`.
4. **Domain: session** — thread poll options + host `image` through create/join.
5. **Domain: swipe/poll** — read per-session `promoteThreshold` / `pollDurationSec` instead of the pinned constants.
6. **Domain: absorbGuest** — guarded reassignment command.
7. **Domain: dashboard** — `listHistory`, `getSessionSummary` (member/host-gated, null on miss).
8. **Drizzle repo** — implement new query methods + join `user.image` into `SessionState.members`.
9. **Redis secondary-storage adapter** for Better Auth.
10. **Better Auth `rateLimit` config** (Layer 1, `/api/auth/*`).
11. **oRPC handlers** for `dashboard.*` + `auth.absorbGuest`.
12. **testcontainers** integration over real Postgres.

---

## Critical gotchas (these will silently break things)

1. **Rate-limit storage = Redis `secondary-storage`, NOT `"database"`.** The `"database"` mode wants Better Auth's own Kysely `migrate` / a `rateLimit` Drizzle table — extra surface and friction under PgBouncer. We chose Redis (already a dependency, multi-instance safe). Task 9 builds the adapter; Task 10 wires `storage: "secondary-storage"` + `secondaryStorage`.

2. **Credential limit = 10/min/IP** (user decision), not Better Auth's default 3/10s. Set `customRules["/sign-in/email"]` and `["/sign-up/email"]` to `{ window: 60, max: 10 }`. `/get-session` must be `false` (exempt) — it's called on every page load.

3. **Proxy IP header.** Behind Railway/Fly, set `advanced.ipAddress.ipAddressHeaders` to the single trusted header the proxy sets. Without it the limiter keys on the load-balancer IP and limits all users as one. Same header the frontend Layer-2 hook will trust.

4. **`prepare: false` stays.** New repo queries go through the pooled `DATABASE_URL`; no `.prepare()`. PgBouncer transaction mode breaks prepared statements.

5. **`absorbGuest` guards are the security boundary.** A client passes `anonUserId` — never trust it blindly. Reassign ONLY if `anonUserId !== realUserId` AND the anon user still `isAnonymous === true`. The existing `reassignUserRows` is `userId`-scoped, so a forged id can't steal a real user's rows, but the `isAnonymous` check stops absorbing an already-real account. Test all three branches (plan Task 6).

6. **Avatar is NOT a `session_member` column.** Read `user.image` via `leftJoin(user, eq(sessionMember.userId, user.id))` when building members. A photo change then reflects everywhere with no membership sync. Guests have `user.image = null` → frontend renders initials.

7. **Anon→real linking has two paths.** Signup auto-fires the anonymous plugin's `onLinkAccount` → `reassignUserRows` (already wired in `betterauth.ts:41-47`). Login-into-existing does NOT — that's the whole reason `auth.absorbGuest` exists. Don't assume signup needs `absorbGuest` (it doesn't) or that login auto-links (it doesn't).

8. **Pinned defaults become column defaults, not deletions.** `promote_threshold=2`, poll timer `300`s stay the defaults (AGENTS.md). Existing anonymous `/` create omits the new fields → falls back to defaults → zero behaviour change. Verify the legacy `CreateSessionInput` shape still parses (plan Task 2 test).

---

## Verify before you start

- Confirm the exact name of the user-row reassignment method in `packages/core/src/ports/repo.ts` — the spec/plan call it `UserLinkRepo.reassignUserRows(fromUserId, toUserId)` (matches `betterauth.ts:85`). If it differs, the plan's Task 6 import must match. Add `isAnonymousUser(userId)` to the same port (Task 6 covers it).
- Confirm whether a Fake/in-memory repo exists alongside `drizzleRepo.ts` (AGENTS.md says every port ships a Fake). Mirror new methods there (plan Task 8) so domain tests + offline dev stay green.
- Check the existing oRPC server-handler file name under `apps/web/src/lib/server/` (the swiping handoff referenced `orpc.ts`); follow that pattern for `dashboard.*`/`auth.absorbGuest` (plan Task 11).

## Skills to load per task

`drizzle-orm-patterns` + `postgres-best-practices` (T1, T8, T12) · `orpc-patterns` (T2, T3, T11) · `superpowers:test-driven-development` (T4–T7) · `bullmq-specialist` for Redis client patterns (T9) · `context7-cli` → Better Auth docs (T6, T9, T10; rate-limit page already summarized in the spec) · `playwright-testing` for the testcontainers harness (T12).

---

## What unblocks the frontend (build order)

Frontend tasks **T3 (login/signup), T5 (dashboard), T6 (header+avatars), T8 (join)** need your **contract types merged** — specifically backend **Task 2 (schemas) + Task 3 (router) + Task 11 (live handlers)**. Frontend T1/T4/T7 are independent and may run in parallel. **Land Tasks 1–3 early** even ahead of the domain/adapter work so the frontend type-checks against the real contract.

## New env flags (add to `packages/config` + `.env.example`)

- `RATE_LIMIT_ENABLED` — gates both rate-limit layers; default on in prod, off in dev (Better Auth disables RL in dev by default anyway).
- Trusted proxy IP header value (or a `TRUSTED_IP_HEADER` var) for `ipAddressHeaders`.
- `PUBLIC_GOOGLE_ENABLED` is frontend-only (hides the Google button) but should mirror whether `GOOGLE_CLIENT_ID`/`SECRET` are set — keep them consistent.

## Commits

Per `COMMIT.md`: `<type>(<scope>): <subject>`, present tense, no `Co-authored-by`, 1–5 files ideal. The plan's per-task commit messages already follow this.
