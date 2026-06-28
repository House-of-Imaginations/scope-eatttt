# Frontend → Backend Handoff — accounts, dashboard, avatars, rate limiting

**From:** Frontend lane (Claude) · **To:** Backend lane (Codex) · **Date:** 2026-06-28
**Branch:** `test/f9-e2e-accounts`

**Why:** The frontend for the accounts/dashboard/avatars/rate-limit round is built, reviewed (code-review + architecture critique), and its own findings fixed. This orients you on what landed against your contract, what's confirmed working, the integration seams you own, and the two cleanup items + verification that fall in the backend lane before this ships.

**Read first:**
- Spec: `docs/superpowers/specs/2026-06-27-accounts-dashboard-rate-limit-design.md`
- Your prior handoff: `docs/superpowers/handoffs/2026-06-28-backend-security-review-handoff.md`
- Frontend review findings (the fixes + the backend flag): `docs/superpowers/handoffs/2026-06-28-frontend-review-findings.md`

---

## What the frontend shipped (against your contract)

All on `test/f9-e2e-accounts`, commits `43459b2`..`d199a12`:

- **Auth UI** — `/login`, `/signup` (`apps/web/src/routes/login|signup/+page.svelte`) on the comic-panel system. Plain-fetch `authClient.ts` (`signInEmail`/`signUpEmail`/`signInGoogle`/`signOut`/`getCurrentUser`) — no `better-auth/client` dep.
- **Dashboard** — `/dashboard` (history + create panel) + `/dashboard/[id]` (read-only summary). Server-load reads `locals.user` and calls your domain fns directly (`listHistory`, `getSessionSummary`) via `getContainer().repo` — NOT an oRPC loopback. Anon/unauth → redirect `/login?redirect=/dashboard`.
- **Avatars** — `@scope/ui` `Avatar` (image-or-initials), composed into `MemberPill` (new optional `image` prop) in the lobby + the dashboard summary. Reads `member.image` off the snapshot (your `user.image` join).
- **Join choice** — `/join/[code]` keeps the guest name path, adds "Have an account? Sign in" → `/login?redirect=/join/{code}`, and a logged-in one-tap "Join as {name}". Reuses `session.join`.
- **Header** — `AppHeader` in `+layout.svelte` (login vs avatar+name+Dashboard+Logout).
- **Create options** — `CreatePollForm` sends `title?` / `pollDurationSec` (60|180|300|600) / `promoteThreshold` (1–5) to `session.create`. Defaults 300 / 2.
- **Rate limit Layer 2** — `apps/web/src/lib/server/rateLimit.ts` + `hooks.server.ts`: Redis fixed-window backstop (300/60s), SSE-exempt, trusted-header IP, self-healing TTL, prod-default-on.
- **Config** — `PUBLIC_GOOGLE_ENABLED` public flag (`packages/config`) gates the Google button.
- **CI/CD** — Biome (`biome.json`, `pnpm check`) + GitHub Actions (`.github/workflows/ci.yml`): two jobs — `ci` (lint/typecheck/test/build) and `e2e` (mock-backed Playwright, 27 specs).

**Two deliberate deviations from the original frontend plan (both improvements, both confirmed with the user):**
1. **`auth.absorbGuest` NOT consumed** — your security review removed the public RPC; frontend never calls it. Guest→real linking is **signup-only** (Better Auth `onLinkAccount`). Login-into-existing does not carry guest rows (accepted tradeoff; join-page login-redirect covers re-join).
2. **`PUBLIC_GOOGLE_ENABLED`** added — frontend-only flag; keep it consistent with whether `GOOGLE_CLIENT_ID`/`SECRET` are set.

---

## Integration seams confirmed working (your contract, exercised by the frontend)

- `dashboard.history` rejects anonymous; frontend guard mirrors it (`requireRealUser` in `dashboard/_guard.ts`). **Keep both rejecting anon** — they must stay in agreement.
- `dashboard.session` returns `null` for non-member/missing → frontend renders an identical "not found" panel (no existence leak). Verified + unit-tested.
- `locals.user` → core `AuthUser` mapping in `routes/api/rpc/[...orpc]/+server.ts` (`authUserFromLocal`) holds the port boundary; handlers never see a Better Auth type.
- `Member.image` flows from your `user.image` join through the snapshot to the lobby Avatar.
- `CreateSessionInput` new optional fields parse; legacy anonymous `/` create still works (omits them → your column defaults).

---

## Backend-lane work before this ships

### 1. Delete `absorbGuest` dead code (architecture risk #3)

The public RPC was removed but the supporting code reads as live with **zero callers** (grep-confirmed):
- `packages/core/src/domain/auth.ts` — `absorbGuest` fn + guards
- `packages/core/src/domain/auth.test.ts` — its test
- `packages/contract/src/schemas/auth.ts` — `AbsorbGuestInput` (in the **mobile-shared** contract seam — highest-leverage to remove)

Delete all three. The deferred "server-issued proof token" path (your prior handoff gotcha #1) is YAGNI — the join-page login-redirect already covers re-join. If you keep it, comment it as intentionally dormant. These are your lane (core + contract); the frontend did not touch them.

### 2. Widen the Redis rate-limit client interface (low)

`packages/adapters/src/cache/redis.ts` `rateLimitClient` getter uses an `as unknown as` double-cast. Widen the constructor's client interface to drop it when convenient. Adapters lane.

---

## Verification still owed (needs infra the frontend CI can't run)

- **Real multi-client E2E** — `apps/web/tests/e2e-accounts.spec.ts` (391 lines: signup→dashboard→create-with-options→share; guest + signed-in join; avatars; swipe→promote→poll→vote→winner; history; anon-link) is authored + wired into `playwright.real.config.ts` but **never executed**. Run it once after pulling, with `docker compose up -d` + worker (`pnpm --filter worker dev`):
  `pnpm --filter web exec playwright test -c playwright.real.config.ts e2e-accounts`
  It is intentionally excluded from CI (`playwright.config.ts` `testIgnore`) because it needs Postgres/Redis/worker.
- **`testcontainers`** dashboard query coverage (your backend Task 12) over real Postgres — confirm still green after the format pass.

---

## Deploy gates (ops, not code — both lanes care)

- **`BETTER_AUTH_SECRET`** must be a real (non-placeholder) value in prod — config rejects placeholders. (CI seeds a generated one.)
- **`TRUSTED_IP_HEADER`** must match the prod proxy's actual behavior, or both rate-limit layers key on the load-balancer IP (limit all users as one) or trust a spoofable header. Set only after confirming the proxy overwrites inbound copies.

---

## Note on the wide format commit

`a7fb3ae` (Biome first-pass format) reformatted 149 files including backend ones (`betterauth.ts`, `relay.ts`, `sse.ts`, `core/domain/auth.ts`). Verified **whitespace-only** on the security-hardened files (`git show a7fb3ae -w` returns zero non-whitespace lines). No semantic drift. `.svelte` is excluded from Biome going forward (svelte-check owns it) — the format pass had briefly flipped `let`→`const` on `$state` bind targets; fixed in `5d71736` and config-blocked from recurring.

## Verification already run (frontend)

- `pnpm check` (Biome lint+format) — 105 files, 0 errors
- `pnpm --filter web check-types`, `pnpm --filter @scope/ui check-types` — exit 0
- web vitest (authClient, rate-limit incl. orphan-TTL, safeRedirect, dashboard-load, avatar) + ui CT — green
- mock-backed Playwright — 27 passed

## Commits

Per `COMMIT.md`. Frontend range on `test/f9-e2e-accounts`: `43459b2`..`d199a12`. Review fixes: `5d71736` (let-binding), `548b96f` (open-redirect), `7234fc5` (rate-limit), `5f30713` (CI e2e), `d199a12` (findings doc).
