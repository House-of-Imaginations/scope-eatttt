# Backend Handoff — accounts dashboard backend + security fixes

**From:** Codex backend/security lane · **To:** Claude Code · **Date:** 2026-06-28

**Why:** The accounts/dashboard/rate-limit backend is implemented, then a backend security review found and fixed several real issues in that work. This handoff is the orientation for Claude to review, continue, or ship the branch without re-discovering the implementation and security context.

**Read first:**
- Prior handoff: `docs/superpowers/handoffs/2026-06-27-backend-accounts-dashboard-handoff.md`
- Spec: `docs/superpowers/specs/2026-06-27-accounts-dashboard-rate-limit-design.md`
- Plan: `docs/superpowers/plans/2026-06-27-accounts-dashboard-backend.md`

---

## Backend implementation added

1. **Contract surface**
   - Added account/dashboard schemas and router entries for `dashboard.history` and `dashboard.session`.
   - Extended session/member schemas for dashboard state, member images, session title, poll duration, and promote threshold.
   - Removed public `auth.absorbGuest` again during the security pass; keep guest migration on Better Auth linking only.

2. **DB + migration**
   - Added `lunch_session.title`, `poll_duration_sec`, and `promote_threshold`.
   - Migration: `packages/db/migrations/0003_mute_slapstick.sql`.
   - Schema/tests updated in `packages/db/src/schema/app.ts` and `app.test.ts`.

3. **Core domain**
   - Added account/dashboard seams in `packages/core/src/domain/dashboard.ts` and `auth.ts`.
   - Added repo/auth port methods needed for dashboard history/session summaries and user reassignment.
   - Threaded host/member image, session title, poll duration, and promote threshold through session creation and state.
   - Swipe/poll now read per-session thresholds/durations instead of only global pinned defaults.

4. **Adapters**
   - `DrizzleSessionRepo` now backs dashboard history/session summaries, joins `user.image` for members, and supports user-row reassignment helpers.
   - Added `RedisSecondaryStorage` for Better Auth rate-limit storage.
   - Added SQL/testcontainers coverage for dashboard queries and Redis secondary storage tests.

5. **Web backend wiring**
   - Better Auth now supports Redis `secondaryStorage`, rate-limit custom rules, optional Google provider config, and anonymous-link row migration.
   - oRPC handlers expose `dashboard.history` and `dashboard.session`.
   - `dashboard.history` rejects anonymous users; `dashboard.session` remains member-gated through repo summary lookup.
   - Session create/join handlers pass member images and enqueue Places fetches with session-specific options.

---

## Security hardening added

1. **Removed public guest absorption RPC** — `auth.absorbGuest` is no longer in the oRPC contract/router. Guest row migration now stays on the trusted Better Auth `onLinkAccount` path.
2. **Bounded session creation inputs** — `CreateSessionInput` caps `radiusM` at 3000, cuisines at 5 items, and each cuisine at 40 trimmed chars.
3. **Strengthened generated join codes** — both core join-code generators now use `node:crypto` `randomInt()` and 10-character codes.
4. **Hardened auth config** — Better Auth rate limits no longer default to trusting `x-real-ip`; `TRUSTED_IP_HEADER` must be explicit. `BETTER_AUTH_SECRET` now rejects short and placeholder values.
5. **Hardened SSE replay** — `Last-Event-ID` must be a UUID, replay queries page from the cursor in SQL, unknown cursors return no backlog, and the stream loops pages so backlogs over 500 events are not silently truncated.
6. **Cleared dependency audit** — root `pnpm.overrides` pins patched transitive `cookie@0.7.2` and `esbuild@0.28.1`.

---

## Security findings closed

1. **High: arbitrary anonymous row takeover**
   - Old issue: any real user could call public `auth.absorbGuest({ anonUserId })` and reassign another anonymous user’s sessions/memberships/swipes/votes.
   - Fix: public RPC removed. Keep using Better Auth `onLinkAccount` for trusted anonymous-to-real migration.

2. **Medium: join-code guessing and unbounded Places inputs**
   - Old issue: short `Math.random()` codes plus unbounded `radiusM`/`cuisines`.
   - Fix: crypto codes and contract-level bounds before queue/cache/Places usage.

3. **Medium: spoofable trusted IP header**
   - Old issue: Redis secondary storage caused auth config to trust `x-real-ip` by default.
   - Fix: no trusted IP header unless `TRUSTED_IP_HEADER` is configured.

4. **Medium: SSE replay amplification**
   - Old issue: replay loaded all session outbox rows and reset to full replay on unknown cursor.
   - Fix: UUID validation, SQL cursor paging, 500-row page size, and page loop in stream.

5. **Low/medium: dependency advisories**
   - Old issue: `cookie` and `esbuild` advisories through transitive paths.
   - Fix: `pnpm audit --audit-level low --json` now reports zero advisories.

---

## Commits

Backend feature/test commits:

- `2a8db8c feat(contract): expose account dashboard contracts`
- `f79c2b7 test(contract): cover dashboard account schemas`
- `9b2d0a7 feat(db): persist account dashboard poll options`
- `58d7493 feat(core): add account dashboard domain seams`
- `c5736a5 test(core): cover dashboard and guest account guards`
- `e0201eb feat(adapters): back dashboard reads with Redis rate storage`
- `716829e test(adapters): cover dashboard SQL and Redis rate storage`
- `bb32b6e feat(web): wire auth rate limiting`
- `0ef31dd feat(web): expose dashboard and guest absorption handlers`

Security follow-up commits:

- `4bb5b3c fix(contract): close public auth absorption`
- `da6e3ae fix(core): strengthen generated join codes`
- `5a4a5ef fix(auth): require explicit trust config`
- `587883a fix(realtime): page SSE replay safely`
- `b25540a chore(deps): clear audit advisories`

Docs handoff commit:

- `42f5d55 docs: add security review handoff`

Check `git status --branch --short` for current ahead count before handing off.

---

## Verification already run

- `pnpm check-types`
- `pnpm --filter @scope/contract test -- schemas.test.ts`
- `pnpm --filter @scope/config test -- env.test.ts`
- `pnpm --filter @scope/core test -- domain.test.ts domain/session.test.ts`
- `pnpm --filter web test -- auth.test.ts orpc.test.ts sse.test.ts`
- `pnpm --filter @scope/adapters test -- repo/outboxRelayStore.test.ts`
- `pnpm audit --audit-level low --json`
- `git diff --check`
- `pnpm lint` ran, but no lint tasks are configured.

---

## Gotchas for Claude

1. **Do not re-add public `auth.absorbGuest`.** The public endpoint was the broken access-control bug. If login-into-existing-account needs guest migration later, add a server-issued proof tied to the pre-link anonymous session.
2. **Dashboard history is real-account only.** Anonymous users can still view member-gated session state, but `dashboard.history` should stay blocked for anonymous users.
3. **Avatars are read from `user.image`, not copied into `session_member`.** Do not add a member image column unless there is a concrete sync requirement.
4. **Rate-limit storage is Redis secondary storage.** Do not switch Better Auth to `"database"` storage unless you also add and migrate the Better Auth rate-limit table path.
5. **`TRUSTED_IP_HEADER` is opt-in.** Only set it in deployment after confirming the proxy overwrites or strips inbound copies.
6. **SSE replay has two halves.** The repo caps each DB page; `createSessionEventStream()` must keep looping pages. Changing one without the other can reintroduce skipped replay rows.
7. **The `pnpm.overrides` are intentional.** Remove them only after upstream dependency ranges resolve patched `cookie` and `esbuild` without overrides.
8. **The browser mock still uses `Math.random()`.** That was not changed because the reviewed risk was backend session membership. Do not treat mock-only randomness as a backend security issue unless the mock becomes a trust boundary.

## Suggested next checks

- Run the real multi-client Playwright flow once after merging/pulling this branch.
- Manually smoke-test signup/login/dashboard history/session summary in the SvelteKit app.
- Confirm production deploy config has a strong `BETTER_AUTH_SECRET`.
- Confirm `TRUSTED_IP_HEADER` is either unset or matches the actual trusted proxy behavior.
