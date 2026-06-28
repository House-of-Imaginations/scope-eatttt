# scope-eatttt

Real-time, event-driven group lunch decider: start a lunch session, share a join code, swipe nearby restaurants, promote accepted places into a poll, vote, and pick a winner.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square&logo=typescript&logoColor=white)
![SvelteKit](https://img.shields.io/badge/SvelteKit-adapter--node-ff3e00?style=flat-square&logo=svelte&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-9.12.0-f69220?style=flat-square&logo=pnpm&logoColor=white)
![Turborepo](https://img.shields.io/badge/Turborepo-monorepo-000000?style=flat-square&logo=turborepo&logoColor=white)

[Overview](#overview) • [Architecture](#architecture) • [Workspace](#workspace) • [Getting Started](#getting-started) • [Commands](#commands) • [Project Plans](#project-plans)

## Overview

scope-eatttt solves the recurring "where should we eat?" problem for groups. The P1 product is a usable lunch flow:

1. A host starts a `lunch_session` with a location, radius, and cuisine filters.
2. Members join with a short code.
3. Everyone swipes restaurants from a shared deck.
4. Accepted restaurants become poll candidates after the promotion threshold is met.
5. The host opens a live poll.
6. Members vote, the poll closes, and the winner is pushed to everyone.

Phase 2 adds receipt OCR and bill splitting, with an explicit human confirmation step before finalizing any bill.

> [!NOTE]
> P1 is designed as a real-time product and a systems-design exercise: typed RPC for commands, SSE for live updates, a transactional outbox for reliable events, and ports/adapters for swappable vendors.

## Architecture

![scope-eatttt architecture](./docs/assets/scope-eatttt-architecture-excalidraw.png)

The app is a modular monolith with a hexagonal core:

- **Commands and queries** go through oRPC using shared contract types from `packages/contract`.
- **Live updates** stream through `GET /sessions/:id/events` over SSE.
- **Domain logic** lives in `packages/core` and depends only on ports.
- **Adapters** live outside core: Google Places, Mindee OCR, Redis, BullMQ, Better Auth, and fake adapters for offline development/tests.
- **Persistence** uses Drizzle + Postgres.
- **Events** are written to `outbox_event` in the same transaction as domain writes.
- **Relay** listens on the direct Postgres connection, publishes to Redis Pub/Sub, and enqueues durable BullMQ jobs.

> [!IMPORTANT]
> `DATABASE_URL` is the pooled PgBouncer transaction-mode connection for normal queries and `NOTIFY`; `DATABASE_DIRECT_URL` is reserved for migrations and relay `LISTEN`. The pooled postgres.js client must use `prepare: false`.

> [!WARNING]
> Places calls are server-side only, field-masked, cached, and never made from the browser.

## Workspace

```text
apps/
  web/       SvelteKit app, oRPC handlers, SSE gateway
  worker/    BullMQ worker for durable jobs

packages/
  contract/  Zod schemas, oRPC router contract, shared event/types seam
  core/      Domain logic, ports, domain errors, fake-friendly contracts
  adapters/  Vendor and infrastructure adapters
  db/        Drizzle schema, clients, migrations, outbox support
  config/    Typed environment parsing and defaults
  ui/        Svelte components
  tokens/    Shared design tokens
  logging/   Structured logging (browser + server)
```

## Getting Started

Prerequisites:

- Node.js `>=22.12.0`
- pnpm `9.12.0`
- Docker, for Postgres, PgBouncer, and Redis

Install dependencies:

```bash
pnpm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Fill the environment values before starting the app:

| Variable | Required for | Notes |
| --- | --- | --- |
| `DATABASE_URL` | App queries | PgBouncer transaction-mode URL, usually `postgres://app:app@localhost:6432/app` locally |
| `DATABASE_DIRECT_URL` | Migrations, relay `LISTEN` | Direct Postgres URL, usually `postgres://app:app@localhost:5432/app` locally |
| `REDIS_URL` | Pub/Sub, cache, jobs | Local default is `redis://localhost:6379` |
| `PLACES_PROVIDER` | Restaurant discovery | Use `fake` for offline dev; switch to a real provider when wiring Google Places |
| `OCR_PROVIDER` | P2 receipt OCR | Use `fake` for P1/offline dev |
| `GOOGLE_MAPS_API_KEY` | Google Places adapter | Required only when `PLACES_PROVIDER` uses Google |
| `GOOGLE_CLIENT_ID` | Google sign-in | Required for Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Google sign-in | Required for Google OAuth |
| `BETTER_AUTH_SECRET` | Auth sessions | Replace the dev value outside local experiments |
| `BETTER_AUTH_URL` | Auth callbacks | Local default is `http://localhost:5173` |
| `PROMOTE_THRESHOLD` | Swipe rules | Default `2` accepts |
| `REJECT_STREAK` | Deck expansion | Default `5` rejects |
| `RADIUS_BASE_M` | Places search | Default `500` |
| `RADIUS_STEP_M` | Places search expansion | Default `500` |
| `RADIUS_CAP_M` | Places search cap | Default `3000` |
| `POLL_TIMER_MS` | Poll duration | Default `300000` |
| `PLACES_CACHE_TTL_S` | Places cache | Default `1800` |

Start local infrastructure:

```bash
docker compose up -d
```

Run database migrations:

```bash
pnpm db:migrate
```

Start the development graph:

```bash
pnpm dev
```

Run only the web app or worker when needed:

```bash
pnpm --filter web dev
pnpm --filter worker dev
```

## Commands

| Command | Description |
| --- | --- |
| `pnpm dev` | Run the Turbo development graph |
| `pnpm build` | Build/check the workspace graph |
| `pnpm check-types` | Run TypeScript checks across packages |
| `pnpm test` | Run package test suites through Turbo |
| `pnpm lint` | Run workspace lint tasks |
| `pnpm db:migrate` | Run Drizzle migrations through the DB package |
| `pnpm --filter @scope/db db:generate` | Generate Drizzle migrations |

## Key Defaults

| Setting | Value |
| --- | --- |
| Promotion threshold | `2` accepts |
| Reject-streak expansion trigger | `5` rejects |
| Search radius | `500m` base, `+500m` step, `3000m` cap |
| Poll timer | `5 min` |
| Places cache TTL | `30 min` |
| Poll tie-break | Earliest promoted candidate |

## Project Plans

The detailed specs and execution plans live in `docs/superpowers/`:

- `docs/superpowers/specs/2026-06-20-scope-eatttt-design.md` — approved product and architecture spec.
- `docs/superpowers/plans/2026-06-20-scope-eatttt-setup.md` — shared foundation plan.
- `docs/superpowers/plans/2026-06-20-scope-eatttt-backend-p1.md` — backend P1 implementation plan.
- `docs/superpowers/plans/2026-06-20-scope-eatttt-frontend-p1.md` — frontend P1 implementation plan.

## Testing Strategy

- **Vitest** for core domain behavior, contract/Zod validation, adapter contract tests, and oRPC guards.
- **testcontainers** for Postgres, Redis, outbox trigger, relay, and integration paths.
- **Playwright** for component checks and multi-member real-time E2E flows.

The primary E2E acceptance path is:

```text
host creates session -> member joins -> both swipe -> candidate promotes live
-> host opens poll -> both vote -> winner appears live in both clients
```
