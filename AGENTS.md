# AGENTS.md

Guidance for AI agents (Claude Code, Codex) working in **scope-eatttt** — a real-time, event-driven group lunch decider.

User/global rules: see `@../../.claude/CLAUDE.md` (OMC orchestration, RTK, memory). This file overrides nothing there; it adds project specifics.

Always commit per @./COMMIT.md

## What this is

Team can't decide where to eat. App: start a **lunch session** → share a join code → members **swipe** nearby restaurants (Tinder-style) → accepted ones become **poll candidates** → group **votes** → **winner**. Phase 2 adds **bill splitting** via receipt OCR.

Using superpowers (brainstorming/specs/plans)? Refer to `docs/superpowers/`.

## Implementation lanes (who builds what)

- **Backend → implement with Codex.** Domain/`core`, ports + adapters, outbox relay, oRPC handlers, worker, `db` (Drizzle schema + migrations).
- **Frontend → this agent / normal lane.** SvelteKit UI, `packages/ui` (Svelte), tokens, component + E2E tests.

Keep authoring and review in separate passes. Never self-approve in the same context.

## Architecture (big picture — needs multiple files to grasp)

**Hexagonal (ports & adapters).** Domain in `packages/core` depends only on interfaces (`PlacesProvider`, `OcrProvider`, `EventBus`, `JobQueue`, `Cache`, `AuthProvider`). Concrete vendors are adapters wired at one composition root from env (`*_PROVIDER` vars). Every port ships a **Fake** adapter for offline dev + tests. Never import a vendor SDK from `core`.

**Transactional outbox = the event backbone.** Every command writes its domain row **and** an `outbox_event` row in **one Postgres transaction** → no lost events, no dual-write race. A **relay** (`LISTEN outbox`) publishes events to Redis pub/sub (fanout) and BullMQ (durable jobs). Browsers receive live updates over **SSE** (`GET /sessions/:id/events`). Reconnect replays from the outbox via `Last-Event-ID`. Consumers idempotent on `outbox_event.id`.

**Command/event split:** mutations + queries go over **oRPC**; live state changes come back over the **separate SSE stream**. Do not stream over oRPC.

**Type-sharing seam:** `packages/contract` exports the oRPC router type + Zod schemas. Web imports it now; mobile (Expo, P2) imports the same — no codegen.

**Auth boundary:** Better Auth **owns** `user`/`session`/`account`/`verification` (generated, do not hand-edit). App tables FK to `user.id` only. Anonymous plugin (`isAnonymous`) lets guests join; `onLinkAccount` migrates app rows on anon→real upgrade. Domain code reaches auth only through the `AuthProvider` port. App's ephemeral session is named **`lunch_session`** to avoid colliding with auth `session`.

## Critical gotchas (these will silently break things)

- **PgBouncer transaction mode breaks `LISTEN`** (works for `NOTIFY`). Two connection paths: `DATABASE_URL` (pooled, all queries + NOTIFY) and `DATABASE_DIRECT_URL` (direct, **relay LISTEN only** + drizzle-kit migrations).
- **`prepare: false`** on the postgres.js pooled connection — prepared statements break under PgBouncer transaction mode (invisible locally, fails under prod load). #1 trap.
- **Relay uses postgres.js `sql.listen()` on the direct URL** (auto-reconnects + re-registers LISTEN). Raw `pg` silently stops after a reconnect — don't use it for the listener.
- **Not Vercel.** SSE/long-lived connections need a persistent Node host (Railway/Fly).
- **OCR never auto-finalizes a bill** — always a human confirm step.
- **Places calls server-side only**, field-masked, cached 30 min (Redis) by `geohash:radius:cuisines`. Never call Places from the browser.

## Monorepo (Turborepo + pnpm)

```
apps/{web,mobile,worker}   web=SvelteKit(adapter-node) · worker=BullMQ · mobile=Expo (P2)
packages/{contract,core,adapters,db,ui,tokens,config}
```

`turbo.json` uses `^build` so `packages/contract` builds before consumers (shared types stay current). Scope work with `--filter`.

## Commands

> Scaffolding pending. Fill exact scripts once `package.json` files exist. Expected shape:

```bash
pnpm install
docker compose up -d                 # Postgres + PgBouncer (tx mode, mirrors prod) + Redis + bull-board
pnpm db:migrate                       # drizzle-kit, uses DATABASE_DIRECT_URL
turbo dev --filter=web                # SvelteKit dev
turbo dev --filter=worker             # BullMQ worker
turbo build                           # full graph, cached
turbo check-types
```

### Tests

- **Vitest** — pure domain unit (core logic against Fake adapters), contract/Zod, oRPC guards.
- **Playwright** — component tests (assert styling matches `DESIGN.md`, provided later) **and** E2E (multi-member realtime: join→swipe→promote→poll→vote→winner, incl. reconnect replay).
- **testcontainers** — integration over real Postgres + outbox→relay→bus path.
- Run single test: `vitest run -t "<name>"` · Playwright: `playwright test <file> -g "<title>"`.

## Pinned defaults

promote_threshold=2 · reject-streak expand trigger=5 · radius base=500m, +500m/step, cap=3000m · poll timer=5min · Places cache TTL=30min.

## Stack

Turborepo+pnpm · SvelteKit(Svelte 5 runes, adapter-node) · oRPC+Zod · Better Auth(anon+email/Google) · Postgres+Drizzle · Redis(pub/sub)+BullMQ · SSE · PgBouncer(prod) · Docker Compose(local) · PlacesProvider→Google Places(New) · OcrProvider→Mindee(P2) · Railway/Fly hosting.
