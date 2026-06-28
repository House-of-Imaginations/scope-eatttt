# Frontend Review Findings → backend lane (Codex)

**From:** Frontend lane (Claude) · **Date:** 2026-06-28

The frontend for accounts/dashboard/avatars/rate-limiting shipped and was put through a code-review + architecture critique pass. Frontend-lane findings are fixed (below). **One finding lands in the backend lane** — flagged here per the AGENTS.md lane split rather than reached across.

## For the backend lane: delete `absorbGuest` dead code

The security review removed the public `auth.absorbGuest` oRPC endpoint (it was the row-takeover bug). But the supporting code was left half-wired and now reads as a live capability when it has **zero callers**:

- `packages/core/src/domain/auth.ts` — `absorbGuest` function + guard logic (no non-test caller; grep-confirmed).
- `packages/core/src/domain/auth.test.ts` — its dedicated test file.
- `packages/contract/src/schemas/auth.ts` — `AbsorbGuestInput`. This lives in the **type-sharing seam mobile imports**, so it's the highest-leverage one to remove.

**Recommendation:** delete all three. The login-into-existing guest-link case is covered cheaply by the join page's login-redirect (guest logs in → re-joins as their real account; only in-flight swipes are lost, an accepted tradeoff). The deferred "server-issued proof token" path (prior handoff gotcha #1) is YAGNI — don't build it until data demands login-time linking. If you keep `absorbGuest`, add a comment naming it as intentionally-dormant so it doesn't read as wired-up.

Also low-priority (adapters lane): `packages/adapters/src/cache/redis.ts` `rateLimitClient` getter uses an `as unknown as` double-cast — widen the constructor's client interface to drop it when convenient.

## Fixed in the frontend lane (no action needed)

- **[HIGH] Open redirect** — `?redirect=` flowed unvalidated into `goto()`/`signInGoogle()` on login + signup. Added `apps/web/src/lib/client/safeRedirect.ts` (same-origin guard, rejects `//host`, `/\host`, schemes) + unit test; wired both pages. Join was never vulnerable (builds its own path). Commit `548b96f`.
- **[MEDIUM] Rate-limit TTL orphan** — `incr`/`expire` non-atomic; a crash between them could strand a counter with no TTL → IP blocked forever. `checkRateLimit` now re-asserts EXPIRE whenever `ttl < 0` (self-heal) + a test for the orphan branch. Commit `7234fc5`.
- **[MEDIUM] Layer-2 rate limit off in prod** — `RATE_LIMIT_ENABLED` had no prod fallback (Layer 1 did). `hooks.server.ts` now mirrors Layer 1: `env.RATE_LIMIT_ENABLED ?? process.env.NODE_ENV === "production"`. Commit `7234fc5`.
- **[ARCH] Playwright never ran in CI** — added an `e2e` job running the mock-backed specs (`PUBLIC_USE_MOCK=1`) on every PR. `e2e-real`/`e2e-accounts` (need docker + worker) stay out of unit CI and run manually/nightly.

## Deploy gates (ops, not code)

- **`TRUSTED_IP_HEADER`** must match the prod proxy's actual behavior (Railway/Fly), or per-IP rate limiting keys on the load-balancer IP / is spoofable. Set it only after confirming the proxy overwrites inbound copies.
- **`BETTER_AUTH_SECRET`** must be a real (non-placeholder) value in prod — the config rejects placeholders.

## Verdicts (both reviewers)

Code review: **fix-then-ship** — the one HIGH (open redirect) is fixed. Architecture: **architecturally sound to ship** — hexagonal boundary, command/event split, auth boundary, rate-limit layering all structurally correct; the two spec deviations (absorbGuest drop, `PUBLIC_GOOGLE_ENABLED`) are improvements on the spec.
