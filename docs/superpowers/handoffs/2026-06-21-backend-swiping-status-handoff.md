# Backend Handoff — server `swiping` status + viewer self-identity

**From:** Frontend lane (Claude) · **To:** Backend lane (Codex) · **Date:** 2026-06-21

**Why:** Playwright drove the full real-stack flow (two browsers) and confirmed the UI works end to end — start → lobby → join → swipe → promote → poll → vote → winner, all over real SSE/Postgres/Redis/worker. But two flow defects surfaced, and **both root-cause to missing backend/contract surface, not frontend bugs.** The frontend has documented stopgaps (`apps/web/src/routes/s/[id]/+page.svelte:65-75`) waiting on this work.

---

> **Update 2026-06-22:** Finding 1 is **DONE** in the backend lane (uncommitted at time of writing): `session.startSwiping` is in `packages/contract/src/router.ts`, the `session.started` event is in `events.ts`, and the command is in `packages/core/src/domain/session.ts` (+46). Frontend still needs the consume step (drop `startedSwiping`-local, call `api.session.startSwiping`, handle `session.started` in the reducer). **Finding 2 is still open.**

## Finding 1 — DONE (backend): non-host members cannot swipe (spec deviation)

**Spec says** (`docs/superpowers/specs/2026-06-20-scope-eatttt-design.md`):
- L28: "**each member** gets 5 restaurant cards… swipe right=accept, left=reject."
- L31: "host opens the poll (**status swiping→polling**)."
- L120: `status(lobby|swiping|polling|decided|closed)` — `swiping` is a real session status.
- L252: E2E target is "**3 simulated members**, full flow join→**swipe**→promote→…".

**Current reality:**
- There is **no `swiping` server status transition** and **no command to trigger it.** `swiping` exists in the DB enum (`packages/db/src/schema/app.ts:4`) and in `SessionStatusSchema` but **nothing ever sets it.**
- The frontend fakes it: `startedSwiping` is a **host-local boolean** (`+page.svelte:69`), and `status` is derived `lobby + startedSwiping → "swiping"` **only in the host's browser** (`+page.svelte:79-83`).
- Consequence: a **joiner's** snapshot status stays `lobby` until the host opens the poll, so the joiner is **stuck on "Waiting for the host to start…"** and **jumps straight from lobby to voting — never swiping.** Only the host swipes in the UI.
- The passing real E2E hid this because it drives both members' decks via the `swipe.decide` API directly (`page.evaluate`), bypassing the joiner's swipe UI entirely.

**Fix (backend/contract lane):**
1. **Contract** (`packages/contract/src/router.ts`): add `session.startSwiping` — input `SessionIdInput`, host-only, output `{ status: "swiping" }` (or void).
2. **Core** (`packages/core/src/domain/`): a `startSwiping(deps, sessionId, hostUserId)` command — `assertHost`, then one tx: update `lunch_session.status = 'swiping'` (guard: only from `lobby`, idempotent) + `insertOutbox` a `session.started` event (new `AppEvent` variant — see Finding 3 note) so the relay fans it out to **all** members.
3. **oRPC handler** (`apps/web/src/lib/server/orpc.ts`): wire `session.startSwiping` via `mapDomainError`, same shape as `poll.start`.
4. **Frontend (then, my lane):** drop `startedSwiping`-local; the host's "Start swiping" calls `api.session.startSwiping`; **all** members' SSE reducer flips to `swiping` on the new event → every member sees the deck. The reducer already has an exhaustive `never` guard — a new event variant will force the handler.

---

## Finding 2 — MAJOR: every viewer is treated as host

**File:** `apps/web/src/routes/s/[id]/+page.svelte:75`
```ts
const isHost = $derived(session?.members.some((m) => m.isHost) ?? false);
```
`some(m => m.isHost)` is `true` for **every** viewer whenever the session has any host member (always). So the **joiner also renders host-only controls** ("Start swiping", "Open poll", "End poll"). The code admits this (L71-74): *"real backend will gate this on the authenticated user id."*

**Root cause:** `SessionStateSchema` (`packages/contract/src/schemas/session.ts`) exposes `members[]` and `hostUserId`, but **nothing tells the client which member IS the viewer.** `session.join` returns the caller's `memberId`, but `session.state` has no `selfMemberId`/`viewerIsHost`. The client cannot resolve self → host without it.

**Fix (backend/contract lane):** add ONE of —
- `viewerIsHost: boolean` on `SessionStateSchema` (simplest; server compares authed `user.id` to `hostUserId`), **or**
- `selfMemberId: string` (more general; frontend matches `members.find(m => m.id === selfMemberId)?.isHost`).

Either resolves server-side from `context.user.id` in the `session.state` handler. Recommend `viewerIsHost` (smaller surface, exactly what the UI needs).

**Frontend (then):** `const isHost = $derived(session?.viewerIsHost ?? false);` — one line.

---

## Finding 3 — note for whoever adds the `session.started` event

`AppEvent` is an exhaustive Zod union (`packages/contract/src/events.ts`) consumed by the frontend reducer (`apps/web/src/lib/client/sessionStore.svelte.ts`) which has a `never`-exhaustiveness guard. Adding a `session.started` variant (base `{id,sessionId,occurredAt}`, no extra payload needed) is the clean fanout mechanism for Finding 1. The reducer will fail to compile until the new variant is handled — that's the intended safety net, not a bug.

---

## Already fixed this loop (frontend lane + 1 cross-lane), all green

- **`packages/core/src/domain/poll.ts:62`** — BullMQ jobId `poll-close:${id}` → `poll-close-${id}`. BullMQ throws `Custom Id cannot contain :`; poll opened but client got a 500. **Cross-lane** (poll.ts is backend) — applied because it fully blocked the real poll flow and is the identical bug class already fixed for `places-fetch` (489d512). `FakeQueue` in `poll.test.ts` hardened to throw on colon so the unit layer now catches it (proven red→green). **Please confirm you're OK with this edit on your next backend pass; if it collides, the intent is just colon→hyphen.**
- **`apps/web/src/lib/client/auth.ts`** — `ensureAnonSession` retries transient cold-start `Failed to fetch` instead of rejecting bootstrap (frontend lane). NOTE: this is a client resilience fix; if the first `/api/auth/get-session` regularly fails on cold start, there may be a **server readiness** angle worth a look, but the retry is correct regardless.
- **`apps/web/src/routes/s/[id]/+page.svelte`** — `openPoll`/`vote`/`endPoll` now catch rejected RPCs into a dismissable comic error banner (was unhandled rejections); optimistic `myVotes` deferred past the await (frontend lane).

## Verification state at handoff

real multi-client flow: all-pass · mock E2E 7/7 + poll-error 1/1 · web vitest 26/26 · core 25/25 · check-types 0 · DESIGN.md token fidelity asserted on every screen.

## Pinned defaults confirmed honored
promote_threshold=2 (real promotion took exactly 2 distinct accepts) · poll timer=300000ms (countdown rendered "05:00") · winner = max net score.
