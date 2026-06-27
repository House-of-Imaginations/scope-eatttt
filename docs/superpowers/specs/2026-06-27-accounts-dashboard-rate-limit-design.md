# Accounts, Dashboard, Avatars & Rate Limiting — Design

**Date:** 2026-06-27
**Status:** Approved (design phase) — pending spec review before plan
**Scope:** One functional spec. Builds new flows and pages on the **existing** comic-panel design system (cream canvas, 3px stroke, banana-yellow, `@scope/ui` + tokens). No visual redesign.

## Summary

The baseline lunch-poll app works (create → join → swipe → promote → poll → vote → winner) and currently runs entirely on auto-created **anonymous** Better Auth users. This round adds real accounts and the surfaces around them:

1. **Auth UI** — email+password and Google login/signup pages (both already configured in the Better Auth backend; only the UI is missing).
2. **Dashboard** (`/dashboard`, logged-in only) — read-only poll history with winner, and a create-new-poll form with extra options.
3. **Member avatars** — logged-in members show name + logo (Google photo, initials fallback) in the lobby; guests get an initials avatar.
4. **Join choice** — `/join/[code]` keeps the fast guest name-entry and adds a secondary "Sign in / use account" path.
5. **New poll options** — the create form gains a session title, poll-timer duration, and promote threshold (alongside existing location / cuisines / radius).
6. **Anon→real linking** — logging in or signing up mid-flow keeps a guest's in-progress session, swipes, and votes.
7. **Rate limiting** — anti-bot limits on auth endpoints + a site-wide backstop, both backed by the existing Redis.

Everything rides existing architectural seams. No new ports for auth/dashboard logic (one new Redis-backed secondary-storage adapter for rate limiting, consistent with hexagonal rules). No vendor SDK imported into `core`.

## Lane split (per AGENTS.md)

- **Backend (Codex lane):** Drizzle columns + migration, `SessionRepo` query methods, domain query/command changes (threading per-session poll options, `absorbGuest` reassignment), oRPC `dashboard.*` + `auth.absorbGuest` handlers, Better Auth `rateLimit` config + Redis secondary-storage adapter.
- **Frontend (this/normal lane):** `/login`, `/signup`, `/dashboard` routes, join-screen update, shared header, `authClient.ts`, `@scope/ui` `Avatar`, SvelteKit `hooks.server.ts` site-wide limiter, all tests on the frontend side.

## Architecture context (current state)

- **Auth** — Better Auth (`apps/web/src/lib/server/auth.ts` → `packages/adapters/src/auth/betterauth.ts`) with `emailAndPassword.enabled`, optional `socialProviders.google` (env-gated), and the `anonymous` plugin whose `onLinkAccount` calls `UserLinkRepo.reassignUserRows(anonUserId, newUserId)`. `user` table already has `name`, `email`, `image`, `isAnonymous`, `displayName`.
- **Identity into the app** — `AuthProvider` port (`packages/core/src/ports/auth.ts`): `getUser(headers) → AuthUser | null`, `requireUser(headers)`. `AuthUser = { id, email?, displayName, isAnonymous? }`. Client bootstraps an anon session via `ensureAnonSession()` (plain fetch to `/api/auth/*`).
- **App data** (`packages/db/src/schema/app.ts`): `lunch_session` (FK `host_user_id → user.id`), `session_member` (`user_id`, `display_name`, `is_host`, no avatar column), `swipe`, `restaurant_cache`, `poll_candidate`, `vote`. App tables FK to `user.id` only.
- **Contract** (`packages/contract/src/router.ts`): `session.{create,join,startSwiping,state,eventsSince}`, `swipe.*`, `poll.*`. No `dashboard` or `auth` group yet. `Member` type (`types.ts`) = `{ id, userId, displayName, isHost, joinedAt }` — no `image`.
- **Routes** (`apps/web/src/routes`): `/` (anonymous create), `/join/[code]` (name entry), `/s/[id]` (lobby→swipe→poll→decided), `/api/rpc/[...orpc]`, `/api/sessions/[id]/events` (SSE). No login, signup, or dashboard pages.
- **Pinned defaults** (AGENTS.md): `promote_threshold=2`, poll timer `5min`. Currently hard-coded constants.

---

## Section 1 — Auth UI & anon→real linking

### Pages (existing comic card idiom, like `/join`)

- `/login` — email + password fields; "Sign in with Google" button; link to `/signup`.
- `/signup` — name + email + password; Google button; link to `/login`.
- Both honour a `?redirect=<path>` query param so "sign in to join/dashboard" returns the user to where they came from. Default redirect: `/dashboard`.

### Client — `apps/web/src/lib/client/authClient.ts`

Plain `fetch` to Better Auth's existing endpoints (same pattern and file neighbourhood as `auth.ts`'s `ensureAnonSession`; **no** `better-auth/client` dependency added — ponytail rung 4):

- `signUpEmail({ name, email, password })` → `POST /api/auth/sign-up/email`
- `signInEmail({ email, password })` → `POST /api/auth/sign-in/email`
- `signInGoogle(redirect)` → navigate to `GET /api/auth/sign-in/social?provider=google` (browser redirect flow)
- `signOut()` → `POST /api/auth/sign-out`

All `credentials: "include"`, same-origin. `429` responses surface a "too many attempts, retry in {X}s" message read from the `X-Retry-After` header.

### Anon → real linking

Behaviour target: **link & keep everything** for both signup and login.

| Case | Mechanism |
|---|---|
| Guest **signs up** (new email, or first Google) | Better Auth's anonymous plugin auto-fires `onLinkAccount` → `reassignUserRows(anonUserId, newUserId)`. Guest's session membership, swipes, votes carry to the new account. No new code. |
| Guest **logs into an existing** real account | Better Auth does **not** auto-merge (cannot silently fold guest rows into a different real user). Handled explicitly below. |

**`auth.absorbGuest` (new oRPC mutation, backend lane):**
- Client captures the current anonymous `userId` (from `/api/auth/get-session`) **before** calling `signInEmail` / `signInGoogle`.
- After a successful login, client calls `auth.absorbGuest({ anonUserId })`.
- Handler runs `reassignUserRows(anonUserId, realUserId)` where `realUserId` comes from the now-authenticated session headers.
- **Guards:** only reassign if (a) `anonUserId !== realUserId`, (b) the `anonUserId` user still exists and is `isAnonymous === true`, and (c) it owns the rows being reassigned (the existing `reassignUserRows` is scoped by `userId`). Prevents a malicious client from passing an arbitrary user id to steal rows.
- **Failure is non-fatal:** login still succeeds; the failure is logged. Worst case a mid-session guest's in-progress state isn't carried — rare, and the user is now logged in.

### Errors

- Invalid credentials / duplicate email → inline `.error-msg` (existing style).
- `429` → "Too many attempts, try again in {X}s" from `X-Retry-After`.

---

## Section 2 — Rate limiting

Two layers, because Better Auth's built-in limiter covers **only `/api/auth/*`** (client-initiated requests; server-side `auth.api` calls are exempt). The rest of the app needs its own backstop.

### Layer 1 — Auth endpoints (Better Auth built-in)

Added to the `betterAuth({...})` config in `packages/adapters/src/auth/betterauth.ts` (surfaced through `createAuth` options so it stays env-aware):

```ts
rateLimit: {
  enabled: true,                  // on in prod; opt-in locally via env flag
  window: 60,
  max: 100,                       // global default for /api/auth/*
  storage: "secondary-storage",   // Redis — multi-instance + restart safe
  customRules: {
    "/sign-in/email":     { window: 60, max: 10 },
    "/sign-up/email":     { window: 60, max: 10 },
    "/sign-in/anonymous": { window: 60, max: 10 },
    "/get-session":       false,  // hot path, called on every page load
  },
}
```

- **Storage = Redis `secondary-storage`** (not `"database"`). Avoids a Better-Auth-owned Drizzle `rateLimit` table and the PgBouncer/`prepare:false` friction, and is correct across a multi-instance Railway/Fly deploy. Better Auth's `secondaryStorage` interface is wired to the existing Redis client via a thin adapter (hexagonal-consistent).
- **Credential limit = 10/min/IP** on sign-in/sign-up email — blocks brute-force and bot signup floods while tolerating shared-NAT offices. Anonymous sign-in matched at 10/min (legit fast path).
- `/get-session` exempt (called on every load; limiting it would throttle normal navigation).
- **IP behind proxy:** set `advanced.ipAddress.ipAddressHeaders` to the single trusted header the Railway/Fly proxy sets (e.g. `x-real-ip`), so the limiter keys on the real client IP, not the load balancer. Do **not** trust raw comma-joined `x-forwarded-for`.

### Layer 2 — Site-wide backstop (SvelteKit hook)

New unit `apps/web/src/lib/server/rateLimit.ts` — a Redis fixed-window counter (`INCR` + `EXPIRE`), invoked from `hooks.server.ts`:

- Applies to `/api/rpc/*` and page loads, keyed by client IP.
- **SSE (`/api/sessions/:id/events`) is exempt** (or counted once at connect, never per-event) — it is a long-lived stream; limiting it would kill live updates.
- Generous default (~300 req/min/IP) — a backstop against scraping/floods, not a tight gate. The tight gate is Layer 1.
- On trip: `429` with `Retry-After`.

```
// ponytail: fixed-window counter, not sliding-window. Upgrade to a sliding
// window only if abuse gets sophisticated enough to ride the window boundary.
```

### Why Redis for both

Already a project dependency (pub/sub + BullMQ) — no new infra (ponytail rung 4). Shared by both layers. Correct under multi-instance deploy.

---

## Section 3 — Dashboard & poll history

### Route `/dashboard` (logged-in only)

- Guard in `+layout.server.ts` (or `+page.server.ts`) via `AuthProvider.getUser(headers)`: redirect anonymous / unauthenticated users to `/login?redirect=/dashboard`.
- Home `/` stays open to anonymous quick-start. Clean guest-vs-account separation.

### Panels (comic-panel style)

1. **History list** — sessions where the user is host or member. Each row: session title (or join code + date when untitled), date, status badge, winner restaurant name (if `decided`). Read-only. Clicking opens a read-only summary (winner + final candidate scores). No resume, no re-run.
2. **Create new poll** — the relocated create form plus the new options (Section 4).

### New oRPC procedures — `packages/contract/src/schemas/dashboard.ts` + `dashboard.*`

- `dashboard.history` — input `{}` (user resolved from session headers) → output `Array<{ id, title: string | null, joinCode, status, createdAt, winnerName: string | null }>`.
- `dashboard.session({ sessionId })` → read-only summary (`SessionSummarySchema`: winner + final candidate net scores + members). **Authz:** requester must be host or member of that session; otherwise treat as not-found (don't leak existence).

### Backend (Codex lane)

- `SessionRepo.listSessionsForUser(userId)` — sessions where user is host **or** a member, newest first.
- `SessionRepo.getSessionSummary(sessionId)` — winner name resolved by joining `winner_candidate_id → poll_candidate → restaurant_cache.name`.
- Domain query handlers + oRPC wiring. All scoped to `user.id`.

### Identity wrinkle

Today the host create flow defaults `hostDisplayName = "Host"` and `/` creates anonymously. From the dashboard a real user creates: pass `user.displayName ?? user.name` as the host display name and rely on `user.image` for the avatar. "Joined" history rows only populate after anon→real linking reassigns membership — consistent with Section 1.

---

## Section 4 — New poll options & avatars

### Poll options — 3 new per-session settings

| Setting | Storage | Default | Notes |
|---|---|---|---|
| Session title | new `lunch_session.title text` (nullable) | `null` | optional; history shows code+date when null |
| Poll timer duration | new `lunch_session.poll_duration_sec int` | `300` (5 min) | replaces the pinned 5-min constant; host picks (e.g. 1/3/5/10 min) |
| Promote threshold | new `lunch_session.promote_threshold int` | `2` | replaces pinned `promote_threshold=2`; per-session |

- **`CreateSessionInput`** (Zod) gains `title?: string`, `pollDurationSec` (bounded int / small enum), `promoteThreshold` (bounded int 1–5). All optional with the pinned defaults — the existing anonymous `/` create keeps working unchanged (omits them → defaults).
- **Domain reads per-session values** instead of constants: swipe-promotion checks `session.promoteThreshold`; poll-open sets `pollDeadlineAt = now + pollDurationSec`. (Backend lane.)

```
// ponytail: the pinned AGENTS.md defaults (threshold 2, 5-min timer) become
// column defaults — single source of truth, zero behaviour change for any
// session that doesn't set them.
```

### Avatars (improvement #3)

- **`@scope/ui` `Avatar` component** — props `{ name, image? }`. Renders `image` if present, else initials on a deterministic colour derived from name/id. Pure, no network.
- **Thread `image` through the member seam:** `Member` type (`packages/contract/types.ts`) gains `image?: string`; the `member.joined` event payload gains it; `AddMemberRecord` / `addMember` carry it.
- **No new `session_member` column** — read `user.image` via join when building `SessionState.members`. Avatar is a property of the account, not the membership. Guests have `user.image = null` → initials fallback.
- Lobby: `MemberPill` shows `Avatar` + name + host badge. Dashboard header shows the current user's avatar.

```
// ponytail: no avatar column on session_member — join to user.image at read
// time. One less column to keep in sync, and a photo change reflects everywhere.
```

---

## Section 5 — Join choice, header, errors

### Join screen (`/join/[code]`)

- Primary, fast path unchanged: name entry → anonymous guest join.
- Secondary line below submit: "Have an account? Sign in" → `/login?redirect=/join/{code}`.
- After login the user lands back on `/join/{code}` authenticated; the page detects a real (non-anon) session and shows a one-tap **"Join as {name}"** using the account name + avatar instead of the text field.

```
// ponytail: reuse the same session.join RPC. Logged-in join just prefills
// displayName from the account and skips the text input.
```

### Shared header (`+layout.svelte`)

Needed — without it there's no way to reach login/dashboard/logout.

- Logged out: "Log in".
- Logged in: avatar + name + "Dashboard" + "Log out".
- Minimal, comic-style.

### Error handling

- Auth forms: inline `.error-msg`. `429` → retry-after message.
- `absorbGuest` failure: non-fatal, logged, login still succeeds.
- Dashboard load failure: panel-level error, same retry idiom as `/s/[id]`.
- Unauthorized dashboard/summary access: redirect to login / treat as not-found (don't leak existence).

---

## Testing (per AGENTS.md stack)

- **Vitest** — `CreateSessionInput` Zod (new optional fields + bounds), `Avatar` initials/colour logic, `dashboard.*` authz guards, rate-limit fixed-window function, `absorbGuest` reassignment guard (rejects mismatched/non-anon ids).
- **Playwright component** — `Avatar` (image vs initials), header states (logged in/out), styling matches the design system.
- **Playwright E2E** — signup → dashboard → create-with-options → share; guest join still works; "sign in to join" round-trip; anon→real link keeps a mid-session guest's state; logged-in member shows avatar in lobby. Reuse the existing multi-client harness.
- **testcontainers** — `dashboard.history` / `dashboard.session` over real Postgres; new columns migrate cleanly.

## Out of scope (YAGNI)

Avatar upload + storage; password reset / email-verification UI; session resume or re-run; profile-edit page; sliding-window rate limiting; mobile (P2); any visual redesign.

## Open risks / notes

- **PgBouncer / `prepare: false`** — new repo queries go through the pooled `DATABASE_URL`; keep `prepare: false`. New migration runs via drizzle-kit on `DATABASE_DIRECT_URL`.
- **Better Auth secondary-storage** must be wired to the same Redis instance the relay/queue use; confirm the client is initialised once at the composition root.
- **Google OAuth** requires `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in the environment; the Google button should be hidden/disabled when they're absent (the backend already env-gates the provider).
- **Proxy IP header** must be set correctly for prod, or both rate-limit layers key on the load-balancer IP and limit all users as one.
