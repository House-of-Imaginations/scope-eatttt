# Scope Eatttt Frontend Handoff

Created: 2026-06-21
Target: frontend agent continuing from `docs/superpowers/`

## Next Session Focus

Continue the SvelteKit frontend lane for Scope Eatttt using the existing superpowers artifacts:

- `docs/superpowers/plans/2026-06-20-scope-eatttt-frontend-p1.md`
- `docs/superpowers/specs/2026-06-20-scope-eatttt-design.md`
- `docs/superpowers/plans/2026-06-20-scope-eatttt-setup.md`
- Backend reference only: `docs/superpowers/plans/2026-06-20-scope-eatttt-backend-p1.md`

Do not duplicate those plans/specs in new docs. Treat them as the source of truth for frontend scope and design constraints.

## Suggested Skills

- `superpowers:using-superpowers` - start-of-session skill routing and process discipline.
- `frontend-ui-engineering` - production-quality Svelte UI implementation.
- `sveltekit-svelte5-tailwind-skill` - SvelteKit 2 / Svelte 5 / Tailwind patterns if styling or app shell work is needed.
- `sveltekit-data-flow` - load/action/server boundary decisions.
- `playwright-testing` - E2E/component coverage for multi-member realtime flows.
- `design-taste-frontend` or `impeccable` - visual polish review against the design spec.
- `superpowers:verification-before-completion` - required before claiming completion.

## Current Backend State Relevant To Frontend

Backend P1 critical/high risks were patched and verified in the prior backend session:

- oRPC session create/join enqueue initial `places.fetch` jobs so a new member can receive deck replenishment.
- SvelteKit server startup initializes the outbox relay once outside build mode.
- `restaurant.promoted` SSE events preserve `candidateId` and `promotedAt`.
- The handwritten `0001_outbox_trigger.sql` migration is registered in Drizzle journal metadata.

Frontend can rely on:

- oRPC for mutations and query-style reads.
- SSE as the live update channel; do not stream through oRPC.
- `restaurant.promoted` events carrying `candidateId`.
- `session.eventsSince` replay path for reconnect recovery.
- `swipe.deck` for current cached deck state.

## Files Recently Touched

- `apps/web/src/lib/server/orpc.ts`
- `apps/web/src/hooks.server.ts`
- `apps/web/src/lib/server/relayRuntime.ts`
- `apps/web/src/lib/server/relayRuntimeCore.ts`
- `packages/contract/src/events.ts`
- `packages/db/migrations/meta/_journal.json`
- `apps/web/tests/orpc.test.ts`
- `apps/web/tests/relayRuntime.test.ts`
- `apps/web/tests/e2e-backend.test.ts`
- `packages/contract/src/schemas/schemas.test.ts`
- `packages/db/tests/outbox-trigger.test.ts`

## Verification Evidence From Backend Session

Commands passed:

- `pnpm check-types`
- `pnpm test`
- `RUN_E2E=1 pnpm --filter web test -- tests/e2e-backend.test.ts`
- `pnpm build`
- `pnpm --filter @scope/db db:generate` reported no schema changes.
- `pnpm lint` ran, but no lint tasks are configured.
- Docker compose was running; `pnpm --filter @scope/db db:migrate` succeeded against compose Postgres/PgBouncer.
- Direct Postgres check found `outbox_notify` trigger count `1` and `outbox_pending_idx` count `1`.

## Repo State Notes

The backend scaffold has been split into semantic commits on `codex/scope-eatttt-backend-p1` according to `COMMIT.md`. The worktree was clean after the commit flow.

Docker services verified during backend work:

- Postgres on `5432`
- PgBouncer on `6432`
- Redis on `6379`

## Frontend Integration Pointers

- Read the frontend plan and design spec first; avoid inventing a separate IA.
- Keep the first screen as the actual lunch session experience, not a marketing page.
- Build around the backend contract already present in `packages/contract`.
- For realtime flows, combine initial oRPC reads with SSE updates and reconnect replay.
- Test at least one multi-member happy path: create -> join -> swipe -> promote -> poll -> vote -> winner.

## Known Remaining Risk

Relay startup is lazy on first SvelteKit request, not a standalone daemon. This is acceptable for current web-owned writes, but if future frontend work assumes worker-only outbox writes, revisit relay deployment topology.

## Knowledge Base Source Labels

Use context-mode search labels from the backend session if more detail is needed:

- `docs superpowers inventory`
- `backend handoff relevant files`
- `backend e2e after event schema fix`
- `check types after event schema fix`
- `full unit tests after event schema fix`
- `build after backend fixes`
- `docker db migrate against compose`
- `docker trigger and index verification`
