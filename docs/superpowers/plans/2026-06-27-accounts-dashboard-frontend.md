# Accounts, Dashboard, Avatars & Rate Limiting — Frontend Plan (Claude lane)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SvelteKit UI for real accounts — login/signup pages, a logged-in dashboard, member avatars, the join-screen account option, a shared header, and the site-wide rate-limit backstop — on the existing comic-panel design system.

**Architecture:** SvelteKit (Svelte 5 runes, adapter-node). Auth via plain `fetch` to Better Auth's `/api/auth/*` (same pattern as the existing `ensureAnonSession`). Mutations/queries over the existing oRPC client; live state still over SSE. New UI consumes the contract types the backend plan produces. The site-wide rate limiter lives in `hooks.server.ts` backed by the existing Redis.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, `@scope/ui` (Svelte) + `@scope/tokens`, oRPC client, Better Auth endpoints, Redis (ioredis), Vitest, Playwright (component + E2E).

**Spec:** `docs/superpowers/specs/2026-06-27-accounts-dashboard-rate-limit-design.md`

> **Dependency:** Tasks consuming new contract types (`Member.image`, `DashboardHistoryItem`, `SessionSummary`, `dashboard.*`, `auth.absorbGuest`) need the **backend plan Tasks 2–3, 11** merged (or a stub of those contract exports) first. Tasks 1, 6 (Avatar, header copy) and 7 (rate-limit hook) have no backend dependency and can start immediately.

## Global Constraints

- **Commit per** `COMMIT.md`: semantic messages, present tense, no `Co-authored-by`. 1–5 files ideal, 7 max.
- **Design system only:** cream canvas, comic panels (3px stroke + flat block shadow), banana-yellow primary, sentence-case headings. **Zero ad-hoc hex** — use `var(--color-*)`, `var(--font-*)`, `var(--radius-*)`, `var(--shadow-*)` tokens. Match the existing `/join` and `/s/[id]` markup idiom.
- **Svelte 5 runes:** `$state`, `$derived`, `$effect`, `$props`. Route params via `$app/state` `page.params` (matches existing pages).
- **No new auth dependency:** plain `fetch`, `credentials: "include"`, same-origin. No `better-auth/client`.
- **Member identity** still persisted per-tab via `memberSession.ts` (`storeSessionMember`/`readSessionMember`).
- **Tests:** Vitest for logic, Playwright component for styling/markup, Playwright E2E for multi-step flows. Reuse the existing multi-client E2E harness.

---

## File Structure

- `packages/ui/src/Avatar.svelte` — **create**: image-or-initials avatar.
- `packages/ui/src/index.ts` — export `Avatar`.
- `packages/ui/src/avatar.ts` — **create**: pure `initials(name)` + `colorFor(seed)` helpers (unit-testable without DOM).
- `apps/web/src/lib/client/authClient.ts` — **create**: signUp/signIn/signOut/social + current-user helpers.
- `apps/web/src/routes/login/+page.svelte` — **create**.
- `apps/web/src/routes/signup/+page.svelte` — **create**.
- `apps/web/src/routes/dashboard/+page.server.ts` — **create**: logged-in guard + history load.
- `apps/web/src/routes/dashboard/+page.svelte` — **create**: history list + create-poll form.
- `apps/web/src/routes/dashboard/[id]/+page.server.ts` + `+page.svelte` — **create**: read-only summary.
- `apps/web/src/routes/+layout.svelte` — modify: render the shared header.
- `apps/web/src/lib/components/AppHeader.svelte` — **create**: nav (login / dashboard / logout + avatar).
- `apps/web/src/routes/join/[code]/+page.svelte` — modify: add "sign in" secondary path + logged-in one-tap join.
- `apps/web/src/routes/+page.svelte` — modify: add `title`/`pollDurationSec`/`promoteThreshold` to the create form (shared form component, see Task 4).
- `apps/web/src/lib/components/CreatePollForm.svelte` — **create**: the create form (used by `/` and `/dashboard`).
- `apps/web/src/lib/server/rateLimit.ts` — **create**: Redis fixed-window limiter.
- `apps/web/src/hooks.server.ts` — modify: invoke the limiter.

---

## Task 1: `Avatar` component + pure helpers

**Skills:** `frontend-ui-engineering`, `sveltekit-svelte5-tailwind`, `playwright-testing`

**Files:**
- Create: `packages/ui/src/avatar.ts`
- Create: `packages/ui/src/Avatar.svelte`
- Modify: `packages/ui/src/index.ts`
- Test: `packages/ui/test/avatar.test.ts` (Vitest, pure helpers) + `packages/ui/test/Avatar.spec.ts` (Playwright component)

**Interfaces:**
- Produces: `initials(name: string): string` (1–2 uppercase letters); `colorFor(seed: string): string` (deterministic token-palette color); `<Avatar name={string} image?={string} size?={number} />`.

- [ ] **Step 1: Write the failing unit test** (`avatar.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { initials, colorFor } from "../src/avatar";
describe("avatar helpers", () => {
  it("derives 1-2 uppercase initials", () => {
    expect(initials("Alice")).toBe("A");
    expect(initials("Alice Wong")).toBe("AW");
    expect(initials("  bob  ")).toBe("B");
    expect(initials("")).toBe("?");
  });
  it("colorFor is deterministic", () => {
    expect(colorFor("user-1")).toBe(colorFor("user-1"));
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter @scope/ui test -- avatar` → FAIL.

- [ ] **Step 3: Implement `avatar.ts`.** `initials`: trim, split on whitespace, take first char of first + last word, uppercase, fall back to `"?"`. `colorFor`: hash the seed to an index into a small array of palette tokens (e.g. `["--color-banana-yellow","--color-mint-green","--color-electric-blue", ...]`).

- [ ] **Step 4: Run, verify pass.** `pnpm --filter @scope/ui test -- avatar` → PASS.

- [ ] **Step 5: Write `Avatar.svelte`** — if `image`, render `<img>` (round, `object-fit: cover`, 3px stroke); else a circle filled with `colorFor(name)` showing `initials(name)`. Size prop drives width/height. Export from `index.ts`.

- [ ] **Step 6: Write the Playwright component test** (`Avatar.spec.ts`): mounts with `image` → renders `img` with that src; mounts without → renders initials text; assert the stroke/border matches the design token (computed border-width `3px`).

- [ ] **Step 7: Run, verify pass.** `pnpm --filter @scope/ui test:component -- Avatar` → PASS.

- [ ] **Step 8: Commit.**

```bash
git add packages/ui/src/avatar.ts packages/ui/src/Avatar.svelte packages/ui/src/index.ts packages/ui/test
git commit -m "feat(ui): add avatar component with initials fallback"
```

---

## Task 2: `authClient.ts` — login/signup/logout/social helpers

**Skills:** `sveltekit-data-flow`, `context7-cli` (Better Auth endpoint reference)

**Files:**
- Create: `apps/web/src/lib/client/authClient.ts`
- Test: `apps/web/src/lib/client/authClient.test.ts`

**Interfaces:**
- Produces:
  - `getCurrentUser(): Promise<{ id, isAnonymous, name, email, image } | null>` (GET `/api/auth/get-session`)
  - `signUpEmail({ name, email, password }): Promise<Result>`
  - `signInEmail({ email, password }): Promise<Result>`
  - `signInGoogle(redirect: string): void` (navigates to social endpoint)
  - `signOut(): Promise<void>`
  - `Result = { ok: true } | { ok: false; error: string; retryAfter?: number }`

- [ ] **Step 1: Write the failing test.** Mock `fetch`: `signInEmail` POSTs to `/api/auth/sign-in/email` with `credentials: "include"`; on `429` returns `{ ok: false, retryAfter }` parsed from `X-Retry-After`; on non-ok JSON error returns `{ ok: false, error }`; on ok returns `{ ok: true }`. `getCurrentUser` returns `null` when no session.

```ts
it("returns retryAfter on 429", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response("", { status: 429, headers: { "X-Retry-After": "30" } }));
  const r = await signInEmail({ email: "a@b.c", password: "x" });
  expect(r).toEqual({ ok: false, error: expect.any(String), retryAfter: 30 });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web test -- authClient` → FAIL.

- [ ] **Step 3: Implement** mirroring `auth.ts`'s fetch style (`credentials: "include"`, same-origin). `signInGoogle` sets `window.location.href = '/api/auth/sign-in/social?provider=google&callbackURL=' + encodeURIComponent(redirect)`. Map `429` → `retryAfter`; other non-ok → error message from body.

- [ ] **Step 4: Run, verify pass.** `pnpm --filter web test -- authClient` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/lib/client/authClient.ts apps/web/src/lib/client/authClient.test.ts
git commit -m "feat(web): add better-auth fetch client helpers"
```

---

## Task 3: `/login` and `/signup` pages

**Skills:** `frontend-ui-engineering`, `sveltekit-structure`, `frontend-design`

**Files:**
- Create: `apps/web/src/routes/login/+page.svelte`
- Create: `apps/web/src/routes/signup/+page.svelte`
- Test: `apps/web/tests/auth-pages.spec.ts` (Playwright component/page)

**Interfaces:**
- Consumes: `authClient` (Task 2), `getCurrentUser`, `Avatar` not needed here. Reads `?redirect=` via `page.url.searchParams`.

- [ ] **Step 1: Write the failing Playwright test.** `/login` renders email + password inputs, a "Sign in with Google" button, and a link to `/signup`. Submitting valid creds (mock the endpoint) navigates to the `redirect` target. A `429` shows "try again in 30s". The Google button is hidden when `PUBLIC_GOOGLE_ENABLED` is false.

- [ ] **Step 2: Run, verify fail.** `playwright test auth-pages` → FAIL.

- [ ] **Step 3: Build `/login`.** Comic card (copy the `.card`/`.heading`/`.text-input`/`.error-msg` styles from `/join`). On submit: capture `getCurrentUser()` anon id first, call `signInEmail`, on `ok` call `api.auth.absorbGuest({ anonUserId })` (non-fatal — wrap in try/catch, log on failure), then `goto(redirect ?? "/dashboard")`. On `!ok` show inline error (with retry-after when present). Google button calls `signInGoogle(redirect ?? "/dashboard")`.

- [ ] **Step 4: Build `/signup`.** Same shell + a name field; calls `signUpEmail`. Better Auth auto-links the anon user on signup, so no `absorbGuest` call needed here. Then `goto(redirect ?? "/dashboard")`.

- [ ] **Step 5: Gate the Google button** behind a `PUBLIC_GOOGLE_ENABLED` public env flag (hidden/disabled when unset) — backend env-gates the provider, so the button must match.

- [ ] **Step 6: Run, verify pass.** `playwright test auth-pages` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/routes/login apps/web/src/routes/signup apps/web/tests/auth-pages.spec.ts
git commit -m "feat(web): add login and signup pages"
```

---

## Task 4: Extract `CreatePollForm` with new options; use on `/`

**Skills:** `frontend-ui-engineering`, `sveltekit-svelte5-tailwind`

**Files:**
- Create: `apps/web/src/lib/components/CreatePollForm.svelte`
- Modify: `apps/web/src/routes/+page.svelte` (use the component)
- Test: `apps/web/tests/create-poll-form.spec.ts`

**Interfaces:**
- Consumes: `api.session.create` (now accepting `title?`, `pollDurationSec?`, `promoteThreshold?`).
- Produces: `<CreatePollForm oncreated={(result) => ...} />` emitting the create result; encapsulates geolocation + cuisines + the three new options.

- [ ] **Step 1: Write the failing test.** The form renders the existing location + cuisine controls PLUS: a "Session name" text input, a poll-timer select (1/3/5/10 min → 60/180/300/600), and a promote-threshold control (1–5). Submitting sends those values to `api.session.create` (mock); the 5-min / threshold-2 defaults are pre-selected.

- [ ] **Step 2: Run, verify fail.** `playwright test create-poll-form` → FAIL.

- [ ] **Step 3: Move the existing `/` form body into `CreatePollForm.svelte`** (geolocation `$effect`, cuisine chips, manual lat/lng fallback — copy verbatim from `+page.svelte`). Add the three new fields with design-system styling. Default `pollDurationSec = 300`, `promoteThreshold = 2`, `title = ""` (omit title from payload when blank). Emit `oncreated` with the API result.

- [ ] **Step 4: Rewrite `/+page.svelte`** to render `<CreatePollForm oncreated={...} />`, keeping its current "show join code then navigate" behavior in the callback.

- [ ] **Step 5: Run, verify pass + existing `/` E2E still green.** `playwright test create-poll-form` and the existing create→join E2E → PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/lib/components/CreatePollForm.svelte apps/web/src/routes/+page.svelte apps/web/tests/create-poll-form.spec.ts
git commit -m "feat(web): extract create-poll form with title, timer, threshold"
```

---

## Task 5: `/dashboard` — guard, history list, create panel

**Skills:** `sveltekit-data-flow`, `sveltekit-structure`, `frontend-ui-engineering`

**Files:**
- Create: `apps/web/src/routes/dashboard/+page.server.ts`
- Create: `apps/web/src/routes/dashboard/+page.svelte`
- Create: `apps/web/src/routes/dashboard/[id]/+page.server.ts`
- Create: `apps/web/src/routes/dashboard/[id]/+page.svelte`
- Test: `apps/web/tests/dashboard.spec.ts`

**Interfaces:**
- Consumes: `dashboard.history`, `dashboard.session`, `AuthProvider` (via server-side `locals`/headers), `CreatePollForm`, `Avatar`.

- [ ] **Step 1: Write the failing test.** Logged-out visit to `/dashboard` redirects to `/login?redirect=/dashboard`. Logged-in: shows history rows (title-or-code + date + status + winner) and the create panel. Clicking a decided row opens `/dashboard/[id]` showing the winner + candidate scores. A non-member visiting `/dashboard/[id]` gets a not-found panel.

- [ ] **Step 2: Run, verify fail.** `playwright test dashboard` → FAIL.

- [ ] **Step 3: `dashboard/+page.server.ts`.** In `load`: resolve the user from the auth provider (request headers); if none or `isAnonymous`, `throw redirect(302, "/login?redirect=/dashboard")`. Else call the server-side oRPC `dashboard.history` and return `{ items }`. (Use the `sveltekit-data-flow` skill for load + redirect + serialization patterns.)

- [ ] **Step 4: `dashboard/+page.svelte`.** Two comic panels: history list (rows with status badge + winner; empty-state "No lunches yet"), and `<CreatePollForm oncreated={(r) => goto('/s/' + r.sessionId)} />`. Each history row links to `/dashboard/{id}`.

- [ ] **Step 5: `dashboard/[id]/+page.server.ts` + `+page.svelte`.** `load` calls `dashboard.session({ sessionId })`; `null` → render a "not found" panel (don't leak). Else show a read-only summary: title/code, winner card (reuse the `/s/[id]` decided winner markup), candidate net-score list.

- [ ] **Step 6: Run, verify pass.** `playwright test dashboard` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/routes/dashboard apps/web/tests/dashboard.spec.ts
git commit -m "feat(web): add dashboard with history and read-only summary"
```

---

## Task 6: Shared `AppHeader` + lobby avatars

**Skills:** `frontend-ui-engineering`, `sveltekit-svelte5-tailwind`

**Files:**
- Create: `apps/web/src/lib/components/AppHeader.svelte`
- Modify: `apps/web/src/routes/+layout.svelte`
- Modify: `apps/web/src/routes/s/[id]/+page.svelte:275-281` (members list → Avatar)
- Test: `apps/web/tests/header.spec.ts`

**Interfaces:**
- Consumes: `getCurrentUser` (Task 2), `Avatar`, `signOut`.

- [ ] **Step 1: Write the failing test.** Logged out: header shows "Log in" linking `/login`. Logged in (non-anon): shows the user's `Avatar` + name + "Dashboard" link + "Log out". Anonymous users see "Log in" (not the dashboard). Lobby members render an `Avatar` next to each name; a member with `image` shows the photo.

- [ ] **Step 2: Run, verify fail.** `playwright test header` → FAIL.

- [ ] **Step 3: Build `AppHeader.svelte`.** On mount call `getCurrentUser()`; reactive state drives the nav. Logged-in-real → `Avatar` + name + Dashboard + Log out (`signOut()` then `goto("/")`). Otherwise → "Log in". Comic-style top bar using tokens.

- [ ] **Step 4: Render it in `+layout.svelte`** above `{@render children()}`.

- [ ] **Step 5: Update the lobby members list** in `/s/[id]/+page.svelte`: replace the bare `MemberPill` name with `<Avatar name={member.displayName} image={member.image} />` + name + host badge (keep `MemberPill` if it already composes an avatar slot; otherwise inline). `member.image` now exists on the snapshot (backend Task 8).

- [ ] **Step 6: Run, verify pass.** `playwright test header` → PASS.

- [ ] **Step 7: Commit.**

```bash
git add apps/web/src/lib/components/AppHeader.svelte apps/web/src/routes/+layout.svelte apps/web/src/routes/s
git commit -m "feat(web): add app header and member avatars in lobby"
```

---

## Task 7: Site-wide rate-limit backstop (Layer 2)

**Skills:** `sveltekit-structure`, `bullmq-specialist` (Redis client), `postgres-best-practices` (not needed — Redis only)

**Files:**
- Create: `apps/web/src/lib/server/rateLimit.ts`
- Modify: `apps/web/src/hooks.server.ts`
- Test: `apps/web/tests/rate-limit.test.ts`

**Interfaces:**
- Consumes: the existing Redis client (import from the server container/cache module).
- Produces: `checkRateLimit(key: string, limit: number, windowSec: number): Promise<{ ok: boolean; retryAfter: number }>`.

- [ ] **Step 1: Write the failing test** (ioredis-mock): `limit=2, window=60` — calls 1 and 2 return `ok`, call 3 returns `{ ok: false, retryAfter > 0 }`. Distinct keys are independent.

- [ ] **Step 2: Run, verify fail.** `pnpm --filter web test -- rate-limit` → FAIL.

- [ ] **Step 3: Implement fixed-window.**

```ts
// ponytail: fixed-window (INCR + EXPIRE). Upgrade to sliding-window only if abuse rides the boundary.
export async function checkRateLimit(redis, key, limit, windowSec) {
  const k = `rl:${key}`;
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, windowSec);
  if (n > limit) {
    const ttl = await redis.ttl(k);
    return { ok: false, retryAfter: ttl > 0 ? ttl : windowSec };
  }
  return { ok: true, retryAfter: 0 };
}
```

- [ ] **Step 4: Wire into `hooks.server.ts`.** Derive client IP from the trusted proxy header (same header the auth layer trusts). Skip when the path is the SSE endpoint (`/api/sessions/*/events`). For other paths, `checkRateLimit(ip, 300, 60)`; on `!ok` return `new Response("Too Many Requests", { status: 429, headers: { "Retry-After": String(retryAfter) } })`. Skip entirely when `RATE_LIMIT_ENABLED` is off (dev).

- [ ] **Step 5: Run, verify pass.** `pnpm --filter web test -- rate-limit` → PASS.

- [ ] **Step 6: Commit.**

```bash
git add apps/web/src/lib/server/rateLimit.ts apps/web/src/hooks.server.ts apps/web/tests/rate-limit.test.ts
git commit -m "feat(web): add site-wide redis rate-limit backstop"
```

---

## Task 8: Join screen — account option + logged-in one-tap

**Skills:** `sveltekit-structure`, `frontend-ui-engineering`

**Files:**
- Modify: `apps/web/src/routes/join/[code]/+page.svelte`
- Test: `apps/web/tests/join-account.spec.ts`

**Interfaces:**
- Consumes: `getCurrentUser` (Task 2), `api.session.join`.

- [ ] **Step 1: Write the failing test.** Anonymous visitor sees the name field + a "Have an account? Sign in" link to `/login?redirect=/join/{code}` (primary path unchanged). A logged-in real user sees a one-tap "Join as {name}" button instead of the text field; clicking joins with the account name (and the backend resolves their avatar). Guest join still works exactly as before.

- [ ] **Step 2: Run, verify fail.** `playwright test join-account` → FAIL.

- [ ] **Step 3: Implement.** On mount, `getCurrentUser()`. If a real (non-anon) user: render "Join as {name}" → `api.session.join({ joinCode, displayName: user.name })`, store member, `goto('/s/'+sessionId)`. Else: keep the existing name form and add the secondary "Sign in" link (`/login?redirect=/join/{code}`). After returning from login, the mount check now finds a real user → one-tap path. `// ponytail: reuse session.join; logged-in path just prefills displayName from the account.`

- [ ] **Step 4: Run, verify pass.** `playwright test join-account` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add apps/web/src/routes/join apps/web/tests/join-account.spec.ts
git commit -m "feat(web): offer account sign-in on the join screen"
```

---

## Task 9: End-to-end multi-step flow

**Skills:** `playwright-testing`

**Files:**
- Modify: `apps/web/tests/e2e-real.spec.ts` (extend the existing multi-client harness) or create `apps/web/tests/e2e-accounts.spec.ts`.

**Interfaces:**
- Consumes: the full stack (backend handlers + these UI screens).

- [ ] **Step 1: Write the E2E.** Flow: signup → lands on dashboard → create poll with a title + 1-min timer + threshold 1 → share code; a second (guest) client joins by name and a third client signs in and joins → both appear in the lobby with avatars; swipe→promote (honoring threshold 1)→poll→vote→winner; back on the dashboard the session appears in history with the winner. Plus the anon-link assertion: a guest who swiped, then signs up mid-session, still appears as the same member afterward.

- [ ] **Step 2: Run, verify pass.** `playwright test e2e-accounts`
Expected: PASS (multi-client realtime, incl. avatars + history + link).

- [ ] **Step 3: Commit.**

```bash
git add apps/web/tests
git commit -m "test(web): e2e accounts, dashboard, avatars, anon-link"
```

---

## Self-Review (frontend)

- **Spec coverage:** Auth UI (T2/T3) ✓; anon-link UX call (T3 login `absorbGuest`, signup auto) ✓; dashboard + history + summary (T5) ✓; poll options form (T4) ✓; avatars (T1/T6) ✓; join choice (T8) ✓; header (T6) ✓; rate-limit Layer 2 (T7) ✓; E2E (T9) ✓.
- **Placeholders:** none; each step carries concrete code or exact markup-source instructions.
- **Type consistency:** `Result`, `getCurrentUser`, `Avatar({name,image})`, `CreatePollForm oncreated`, `checkRateLimit` consistent across tasks. `member.image` consumed in T6 is produced by backend T8.
- **Cross-plan dependency:** T3/T5/T6/T8 need backend contract types (backend T2/T3/T11). T1/T4(form shell)/T7 are independent and can start first.
- **Env flags introduced:** `PUBLIC_GOOGLE_ENABLED` (T3), `RATE_LIMIT_ENABLED` (T7) — add to `packages/config` public/server env schema; document in `.env.example`.
