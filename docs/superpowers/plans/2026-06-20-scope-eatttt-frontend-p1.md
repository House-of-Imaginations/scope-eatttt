# scope-eatttt Frontend (P1) Implementation Plan — Claude lane

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SvelteKit web UI for the group lunch decider — lobby/join, swipe deck, live poll, winner — driven by typed oRPC calls and a live SSE stream, styled from shared tokens.

**Architecture:** SvelteKit (Svelte 5 runes) consuming `@scope/contract` for end-to-end types. Commands/queries go over an oRPC client; live updates arrive over a single SSE connection per session and feed a runes store. UI built from `packages/ui` (Svelte components) themed by `packages/tokens`. While backend handlers are incomplete, the app runs against a mock oRPC handler + a mock SSE emitter so frontend can progress in parallel.

**Tech Stack:** SvelteKit (adapter-node) · Svelte 5 runes · Tailwind v4 (`@tailwindcss/vite`) · `@orpc/client` · `@scope/contract` · Vitest (logic) · Playwright (component-style + E2E).

**Owner:** Claude. Backend (Codex) owns the server; this plan owns UI, `packages/ui`, `packages/tokens`, component + E2E tests.

## Global Constraints

- **Prerequisite:** Setup plan Tasks S1–S6 done (`docs/superpowers/plans/2026-06-20-scope-eatttt-setup.md`) — monorepo + `@scope/contract` published in workspace. Frontend imports `@scope/contract` for all types/inputs — never redefines them.
- **Parallel-work seam:** until backend Phase 2 lands, target a **mock oRPC handler** (`apps/web/src/lib/client/mockHandler.ts`) and a **mock SSE source**. Swapping to real = change one base-URL/flag, no component edits.
- TypeScript strict. Svelte 5 **runes** (`$state`, `$derived`, `$effect`) — no legacy stores syntax for new code.
- **Styling source of truth:** `DESIGN.md` (user to provide). All colors/spacing/type come from `packages/tokens` → Tailwind theme in `src/styles/global.css` `@theme`. No ad-hoc hex in components.
- **Realtime is SSE, not oRPC.** Components never poll; they read the SSE-backed store.
- Rendered components are Svelte (web only). Mobile (P2) reuses `packages/tokens` + headless logic, not these components.
- Tests: Vitest for pure logic; **Playwright Component Testing** to assert styling matches `DESIGN.md` (computed styles/layout/tokens); Playwright E2E for the multi-screen flow.
- Commits: semantic per `COMMIT.md`. NO `Co-authored-by`. Max 7 files/commit.

---

## File Structure

```
packages/tokens/        src/tokens.ts (TS export), src/theme.css (@theme block), package.json
packages/ui/            src/{Button,Card,SwipeCard,CandidateRow,MemberPill,Countdown}.svelte, src/index.ts, package.json
apps/web/               src/styles/global.css (imports tokens theme)
                        src/lib/client/{orpc.ts (real client), mockHandler.ts, sessionStore.svelte.ts (SSE+state), sse.ts (EventSource wrapper)}
                        src/routes/+layout.svelte, +page.svelte (start), join/[code]/+page.svelte,
                        s/[id]/+page.svelte (the live session screen: lobby->swipe->poll->winner)
tests/                  packages/ui/tests/*.spec.ts (Playwright CT), apps/web/tests/*.spec.ts (Playwright E2E),
                        apps/web/src/lib/client/sessionStore.test.ts (Vitest)
playwright.config.ts · playwright-ct.config.ts
```

---

## Phase F0 — Tokens, UI primitives, client plumbing

### Task F0.1: Tokens package (`packages/tokens`)

**Files:**
- Create: `packages/tokens/package.json`, `packages/tokens/src/tokens.ts`, `packages/tokens/src/theme.css`
- Test: `packages/tokens/src/tokens.test.ts`

**Interfaces:**
- Produces: `tokens` object (`{ color: {...}, space: {...}, radius: {...}, font: {...} }`) and a `theme.css` `@theme` block consumed by web; the SAME token object is importable by mobile later.

> **DESIGN.md dependency:** exact values come from `DESIGN.md`. Until provided, use placeholder-but-real defaults below and mark a TODO to reconcile. (This is the one allowed deferred-value, gated on user input — values are real, not "TBD".)

- [ ] **Step 1: `package.json`**

```json
{ "name": "@scope/tokens", "version": "0.0.0", "private": true, "type": "module", "main": "src/tokens.ts",
  "scripts": { "check-types": "tsc --noEmit", "test": "vitest run" },
  "devDependencies": { "vitest": "^2.1.0", "typescript": "^5.6.0" } }
```

- [ ] **Step 2: `tokens.ts` (real defaults; reconcile with DESIGN.md when provided)**

```ts
export const tokens = {
  color: {
    bg: "#0e0f13", surface: "#1a1c22", text: "#f5f6fa", muted: "#9aa0ad",
    primary: "#ff6b4a", accept: "#36d399", reject: "#f87272", accent: "#ffd460",
  },
  space: { xs: "4px", sm: "8px", md: "16px", lg: "24px", xl: "40px" },
  radius: { sm: "8px", md: "16px", lg: "24px", pill: "999px" },
  font: { body: "Inter, system-ui, sans-serif", display: "Inter, system-ui, sans-serif" },
} as const;
export type Tokens = typeof tokens;
```

- [ ] **Step 3: `theme.css` (Tailwind v4 @theme — generated from same values)**

```css
@theme {
  --color-bg: #0e0f13; --color-surface: #1a1c22; --color-text: #f5f6fa; --color-muted: #9aa0ad;
  --color-primary: #ff6b4a; --color-accept: #36d399; --color-reject: #f87272; --color-accent: #ffd460;
  --radius-pill: 999px;
}
```

- [ ] **Step 4: Test (tokens object shape stable)**

```ts
import { describe, it, expect } from "vitest";
import { tokens } from "./tokens";
describe("tokens", () => {
  it("exposes color/space/radius/font groups", () => {
    for (const g of ["color","space","radius","font"]) expect(tokens).toHaveProperty(g);
    expect(tokens.color.accept).toMatch(/^#/);
  });
});
```

- [ ] **Step 5: Run + commit**

Run: `pnpm --filter @scope/tokens test` → PASS.

```bash
git add packages/tokens
git commit -m "feat(tokens): shared design tokens (TS object + tailwind @theme)"
```

---

### Task F0.2: Wire tokens into SvelteKit app + base layout

**Files:**
- Create: `apps/web/src/styles/global.css`, `apps/web/src/routes/+layout.svelte`, `apps/web/vite.config.ts` (if not already by backend), `apps/web/tailwind` wiring
- Modify: `apps/web/package.json` (add `@scope/tokens`, `@scope/contract`, `@tailwindcss/vite`, `@orpc/client`)

**Interfaces:**
- Produces: app shell rendering tokens; `global.css` imports `@scope/tokens/theme.css`.

- [ ] **Step 1: `global.css`**

```css
@import "tailwindcss";
@import "@scope/tokens/src/theme.css";
:root { color-scheme: dark; }
body { background: var(--color-bg); color: var(--color-text); font-family: Inter, system-ui, sans-serif; }
```

- [ ] **Step 2: `+layout.svelte`** — import `../styles/global.css`, render `<slot/>` in a centered max-width container.

- [ ] **Step 3: Verify dev server boots**

Run: `pnpm --filter web dev` (then curl localhost:4321) → 200, body bg applied.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles/global.css apps/web/src/routes/+layout.svelte apps/web/package.json apps/web/vite.config.ts
git commit -m "feat(web): app shell + tailwind v4 wired to shared tokens"
```

---

### Task F0.3: oRPC client + mock handler (parallel-work seam)

**Files:**
- Create: `apps/web/src/lib/client/orpc.ts`, `apps/web/src/lib/client/mockHandler.ts`
- Test: `apps/web/src/lib/client/orpc.test.ts`

**Interfaces:**
- Consumes: `Contract` type from `@scope/contract`.
- Produces: `api` (typed oRPC client). When `PUBLIC_USE_MOCK=1`, `api` routes to `mockHandler` (in-memory session/swipe/poll implementing the contract shape) so UI works before backend Phase 2. Otherwise targets `/api/rpc`.

- [ ] **Step 1: Test** — mock `api.session.create` returns `{sessionId, joinCode}`; `api.swipe.decide` toggles a promoted flag after 2 accepts (mirrors real rule so UI behaves realistically).

```ts
import { describe, it, expect } from "vitest";
import { makeMockApi } from "./mockHandler";
describe("mock api", () => {
  it("promotes a restaurant after threshold accepts", async () => {
    const api = makeMockApi();
    const { sessionId } = await api.session.create({ centerLat:1, centerLng:2, cuisines:[] });
    await api.session.join({ joinCode:"X", displayName:"A" });
    const r1 = await api.swipe.decide({ sessionId, restaurantId:"r1", decision:"accept" });
    const r2 = await api.swipe.decide({ sessionId, restaurantId:"r1", decision:"accept" });
    expect(r1.promoted).toBe(false); expect(r2.promoted).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `makeMockApi()` (in-memory state, deterministic restaurants from a fixture) and `orpc.ts` (real `createORPCClient` against `/api/rpc`, falls back to mock by env). Export `api`.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/client/orpc.ts apps/web/src/lib/client/mockHandler.ts apps/web/src/lib/client/orpc.test.ts
git commit -m "feat(web): typed orpc client + in-memory mock handler (parallel-work seam)"
```

---

### Task F0.4: SSE-backed session store (runes)

**Files:**
- Create: `apps/web/src/lib/client/sse.ts`, `apps/web/src/lib/client/sessionStore.svelte.ts`
- Test: `apps/web/src/lib/client/sessionStore.test.ts`

**Interfaces:**
- Consumes: `AppEvent` from `@scope/contract`.
- Produces: `createSessionStore(sessionId)` returning a runes-based object `{ state: SessionState, connect(), disconnect() }`. `connect()` opens `EventSource('/api/sessions/{id}/events')` (or a mock emitter when `PUBLIC_USE_MOCK`), applies each `AppEvent` to `state` via a pure `reduce(state, event)` reducer. Tracks `Last-Event-ID` for reconnect.

- [ ] **Step 1: Test the pure reducer** (no DOM/EventSource needed)

```ts
import { describe, it, expect } from "vitest";
import { reduce, initialState } from "./sessionStore.svelte";
describe("reduce", () => {
  it("adds a member on member.joined", () => {
    const s = reduce(initialState("s1","CODE"), { type:"member.joined", member:{ userId:"u1", displayName:"A", role:"host" } });
    expect(s.members).toHaveLength(1);
  });
  it("adds candidate on restaurant.promoted and updates tally on vote.cast", () => {
    let s = reduce(initialState("s1","CODE"), { type:"restaurant.promoted", candidate:{ id:"c1", restaurant:{ id:"r1", name:"X", lat:0,lng:0,cuisines:[] }, up:0, down:0, net:0 } });
    s = reduce(s, { type:"vote.cast", candidateId:"c1", up:3, down:1, net:2 });
    expect(s.candidates[0].net).toBe(2);
  });
  it("sets winner + status on poll.closed", () => {
    let s = initialState("s1","CODE"); s.candidates = [{ id:"c1", restaurant:{id:"r1",name:"X",lat:0,lng:0,cuisines:[]}, up:0,down:0,net:0 }];
    s = reduce(s, { type:"poll.closed", winnerCandidateId:"c1" });
    expect(s.winnerCandidateId).toBe("c1"); expect(s.status).toBe("decided");
  });
});
```

- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** `reduce` (pure, exhaustive over `AppEvent`), `initialState`, and `createSessionStore` (`$state` holding state, EventSource wiring, `onmessage` → `state = reduce(state, JSON.parse(e.data))`, save `e.lastEventId`).
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/client/sse.ts apps/web/src/lib/client/sessionStore.svelte.ts apps/web/src/lib/client/sessionStore.test.ts
git commit -m "feat(web): SSE-backed session store with pure event reducer"
```

---

### Task F0.5: UI primitives (`packages/ui`)

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/src/{Button,Card,MemberPill,Countdown}.svelte`, `packages/ui/src/index.ts`
- Test: `packages/ui/tests/{Button,Countdown}.spec.ts` (Playwright Component Testing — style assertions)

**Interfaces:**
- Produces: presentational primitives using token CSS vars. `Button` (variant: primary|accept|reject|ghost), `MemberPill`, `Countdown(deadline)`, `Card`.

- [ ] **Step 1: Set up Playwright CT** (`playwright-ct.config.ts` for Svelte).

- [ ] **Step 2: Failing component-style test (Button primary uses token color)**

```ts
import { test, expect } from "@playwright/experimental-ct-svelte";
import Button from "../src/Button.svelte";
test("primary button uses --color-primary background", async ({ mount }) => {
  const c = await mount(Button, { props: { variant: "primary" }, slots: { default: "Go" } });
  await expect(c).toHaveCSS("background-color", "rgb(255, 107, 74)"); // #ff6b4a — reconcile w/ DESIGN.md
});
```

- [ ] **Step 3: Run → fail.**
- [ ] **Step 4: Implement primitives** (class-based on token vars, e.g. `background: var(--color-primary)`).
- [ ] **Step 5: Run → pass.**
- [ ] **Step 6: Commit**

```bash
git add packages/ui playwright-ct.config.ts
git commit -m "feat(ui): token-driven primitives + playwright component-style tests"
```

---

## Phase F1 — Screens

### Task F1.1: Start screen (`/`) — create session

**Files:**
- Create: `apps/web/src/routes/+page.svelte`
- Test: `apps/web/tests/start.spec.ts` (Playwright E2E against mock)

**Interfaces:**
- Consumes: `api.session.create`. On submit (location + cuisine chips) → create → redirect to `/s/{id}` and show join code.

- [ ] **Step 1: E2E test (mock mode)** — fill cuisines, click "Start", expect navigation to `/s/...` and a visible join code.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** form (geolocation via `navigator.geolocation` with manual lat/lng fallback), cuisine multiselect chips, calls `api.session.create`, `goto('/s/'+id)`.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/+page.svelte apps/web/tests/start.spec.ts
git commit -m "feat(web): start screen — create session + show join code"
```

---

### Task F1.2: Join screen (`/join/[code]`)

**Files:**
- Create: `apps/web/src/routes/join/[code]/+page.svelte`
- Test: `apps/web/tests/join.spec.ts`

**Interfaces:**
- Consumes: `api.session.join`. Enter display name → join → go to `/s/{id}`.

- [ ] **Step 1: E2E test** — visit `/join/ABCD`, enter name, submit, land on session screen in lobby with self in member list.
- [ ] **Step 2–4:** fail → implement (read `code` param, name input, `api.session.join`, `goto`) → pass.
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/join/[code]/+page.svelte apps/web/tests/join.spec.ts
git commit -m "feat(web): join screen via code + display name"
```

---

### Task F1.3: SwipeCard component + swipe deck

**Files:**
- Create: `packages/ui/src/SwipeCard.svelte`, `apps/web/src/lib/client/deck.svelte.ts`
- Test: `packages/ui/tests/SwipeCard.spec.ts` (CT), `apps/web/src/lib/client/deck.test.ts` (Vitest)

**Interfaces:**
- Produces: `SwipeCard` (restaurant photo/name/rating/price; emits `swipe` with `'accept'|'reject'` on drag-release or button). `createDeck(sessionId)` manages current cards from `api.swipe.deck`, pops on decide, triggers replenish when `deck.replenished` arrives.

- [ ] **Step 1: Vitest for deck logic** — popping a card reduces count; `deck.replenished` event appends new cards; low-deck (≤2) flag flips.
- [ ] **Step 2: CT for SwipeCard** — renders name + accept/reject buttons styled with `--color-accept`/`--color-reject`.
- [ ] **Step 3: fail → implement → pass** (drag via pointer events; keyboard ←/→ accessible fallback).
- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/SwipeCard.svelte apps/web/src/lib/client/deck.svelte.ts packages/ui/tests/SwipeCard.spec.ts apps/web/src/lib/client/deck.test.ts
git commit -m "feat(ui+web): swipe card + deck logic with replenish"
```

---

### Task F1.4: Session screen state machine (`/s/[id]`) — lobby→swipe→poll→winner

**Files:**
- Create: `apps/web/src/routes/s/[id]/+page.svelte`, `packages/ui/src/CandidateRow.svelte`
- Test: `apps/web/tests/session-flow.spec.ts`

**Interfaces:**
- Consumes: `createSessionStore` (SSE state), `createDeck`, `api.session.startPoll/end`, `api.poll.vote`, `SwipeCard`, `CandidateRow`, `Countdown`.
- Produces: one screen that renders by `state.status`:
  - `lobby` — members list + (host) "Start swiping"
  - `swiping` — SwipeCard deck + live "promoted" toast; (host) "Open poll"
  - `polling` — CandidateRow list with up/down + Countdown; live tallies
  - `decided` — winner card 🎉

- [ ] **Step 1: E2E (mock, single browser drives host + simulated events)** — drive: start → swipe two accepts → see candidate appear → open poll → vote → close → winner shown. Mock SSE emits the corresponding `AppEvent`s.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement** the status-switch screen wiring store + api; host-only controls gated by `state.members.find(self).role==='host'`; promoted toast on `restaurant.promoted`.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/s/[id]/+page.svelte packages/ui/src/CandidateRow.svelte apps/web/tests/session-flow.spec.ts
git commit -m "feat(web): session screen state machine lobby->swipe->poll->winner"
```

---

### Task F1.5: Reconnect / connection resilience UX

**Files:**
- Modify: `apps/web/src/lib/client/sessionStore.svelte.ts`, `apps/web/src/routes/s/[id]/+page.svelte`
- Test: `apps/web/tests/reconnect.spec.ts`

**Interfaces:**
- Produces: store auto-reconnect with `Last-Event-ID`; a small "reconnecting…" banner; on reconnect, applies replayed events idempotently (dedupe by event id in reducer).

- [ ] **Step 1: Test** — simulate EventSource error → store sets `connected=false` → banner shows; on resume, duplicate replayed events don't double-count tally (reducer dedupes by `id`).
- [ ] **Step 2: fail → implement** (track `seenIds` Set in store; reducer ignores seen ids; EventSource `onerror` → reconnect with backoff) → pass.
- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/client/sessionStore.svelte.ts apps/web/src/routes/s/[id]/+page.svelte apps/web/tests/reconnect.spec.ts
git commit -m "feat(web): SSE reconnect with Last-Event-ID + idempotent replay UX"
```

---

### Task F1.6: Switch to real backend + full E2E

**Files:**
- Modify: `apps/web/.env` wiring (`PUBLIC_USE_MOCK=0`)
- Create: `apps/web/tests/e2e-real.spec.ts` (runs against `pnpm dev` + docker compose + worker)

**Interfaces:**
- Consumes: real oRPC + real SSE (backend Phase 2 complete).

- [ ] **Step 1: Multi-context Playwright E2E** — 2 browser contexts (host + member), real server: host creates → member joins via code → both swipe → candidate promotes live in BOTH contexts → host opens poll → both vote → winner appears live in both. Asserts realtime fanout end-to-end.
- [ ] **Step 2: Run with stack up**

Run: `docker compose up -d && pnpm --filter web db:migrate && pnpm --filter web dev & pnpm --filter worker dev & npx playwright test e2e-real`
Expected: PASS — live updates cross between contexts.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/e2e-real.spec.ts apps/web/.env.example
git commit -m "test(web): real multi-client e2e — live promote + vote + winner fanout"
```

---

## Self-Review (done)

- **Spec coverage (frontend):** tokens(F0.1), shell/tailwind(F0.2), typed client+mock(F0.3), SSE store+reducer(F0.4), UI primitives(F0.5), start(F1.1), join(F1.2), swipe deck(F1.3), session state machine all 4 statuses(F1.4), reconnect/replay UX(F1.5), real multi-client E2E(F1.6). Covers product flow §2 and realtime §6 client-side. Bill-split UI = P2, excluded.
- **Placeholder scan:** token values are real defaults gated on `DESIGN.md` (explicitly flagged, not "TBD"); the Button CT color literal references the same value — reconcile both when DESIGN.md lands.
- **Type consistency:** all inputs/types imported from `@scope/contract` (`AppEvent`, `SessionState`, `Candidate`, `Restaurant`, contract inputs). `reduce(state,event)` exhaustively handles every `AppEvent` variant defined in Setup S6. Mock handler mirrors real promote rule (threshold 2) so behavior matches.
- **Parallel seam:** F0.3/F0.4 mock paths let F1.* proceed before backend Phase 2; F1.6 flips to real.

---

## Cross-plan dependency

```
Setup S1–S6 (foundation + contract)      ──┬──►  Frontend F0.* (can start at S6)
Backend 1.x–2.x (domain + server)        ──┴──►  Frontend F1.6 (real E2E needs backend Phase 2)
```

After Setup S6, Frontend F0.1–F1.5 run in parallel with backend Phase 1–2 using mocks. Only F1.6 (real E2E) is hard-blocked on backend Phase 2.

---

## Skill Routing (subagent-driven)

When executing a task via subagent-driven-development, the dispatched subagent MUST load the matching skill(s) below before writing code. Skills live in **both** `.claude/skills/` (Claude) and `.agents/skills/` (Codex). Design tasks load the design lane; wiring tasks load the SvelteKit lane.

**Design lane (load on any visual/styling task):** `impeccable`, `frontend-ui-engineering`, `taste-frontend`, `ui-ux-pro-max`, `minimalist-ui`, `high-end-visual-design`. Use these to avoid generic AI aesthetic and to match `DESIGN.md`.

| Task | Load skill(s) |
|---|---|
| F0.1 tokens | design lane (`taste-frontend`, `impeccable`) — token taste |
| F0.2 shell + tailwind wiring | `sveltekit-svelte5-tailwind`, `sveltekit-structure` |
| F0.3 oRPC client + mock | `orpc-patterns` |
| F0.4 SSE store + reducer | `sveltekit-data-flow` |
| F0.5 UI primitives | design lane (all) — these set the visual bar |
| F1.1 start screen | `sveltekit-svelte5-tailwind` + design lane |
| F1.2 join screen | `sveltekit-svelte5-tailwind` + design lane |
| F1.3 swipe card + deck | design lane (`impeccable`, `frontend-ui-engineering`) for motion/feel + `sveltekit-data-flow` |
| F1.4 session state machine | `sveltekit-data-flow`, `sveltekit-structure` + design lane |
| F1.5 reconnect UX | `sveltekit-data-flow` |
| F1.6 real multi-client e2e | `playwright-testing` |

Rule: every screen/component task loads the design lane before styling; wiring/logic tasks load the SvelteKit/oRPC skill. Never ship UI without the design lane loaded — it is the guard against generic output.

