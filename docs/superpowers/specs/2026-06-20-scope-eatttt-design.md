# scope-eatttt — Design Spec

**Date:** 2026-06-20
**Status:** Approved design (pre-implementation)
**One-liner:** Real-time, event-driven group lunch decider. Swipe nearby restaurants → poll → winner. Phase 2: receipt-OCR bill splitting.

---

## 1. Goal & scope

Team can't decide where to eat on Fridays. Build a usable product that ships next Friday, on a deliberately event-driven backbone so the build teaches real system design (transactional outbox, fanout, idempotency, ports/adapters, connection pooling).

**Primary goal:** ship a usable product. Architecture stays clean/event-shaped, not over-engineered (modular monolith, not microservices).

**Phasing (spec covers all; build in order):**
- **P1 (this weekend):** swipe → poll → winner. Fully usable lunch decider.
- **P2 (later):** bill splitting + receipt OCR.
- **P3+ (later):** mobile app (Expo) reusing shared contract/core/tokens.

**Non-goals (YAGNI):** microservices, WAL/CDC, per-org OAuth, AI recommendations, native-shared rendered components.

---

## 2. Product flow (P1)

1. **Start session** — anyone creates a `lunch_session` with a location (lat/lng), base radius 500m, and group cuisine filter. Gets a short **join code**.
2. **Join** — members open the code, enter a display name (anonymous, no signup), land in a lobby. Live member list.
3. **Swipe** — each member gets 5 restaurant cards within their radius. Swipe right=accept, left=reject.
4. **Promote** — when a restaurant is accepted by ≥ `promote_threshold` (default 2) distinct members, it becomes a **poll candidate**, pushed live to everyone.
5. **Radius expansion / "ask for more"** — per-member reject streak ≥ 5 (or deck ≤ 2 left) → that member's radius += 500m (cap 3000m), fetch 5 more. At cap and still dry → prompt member to broaden cuisines.
6. **Poll** — host opens the poll (status swiping→polling), deadline = now + 5 min. Members upvote/downvote candidates; live tally.
7. **Winner** — timer fires or host ends → highest net score wins (tie → earliest promoted). Pushed live: 🎉.

---

## 3. Goals decisions (locked)

| Decision | Choice |
|---|---|
| Goal | Ship usable product; clean event-driven architecture |
| MVP | Swipe + poll + winner (P1); bill-split = P2 |
| Group model | Ephemeral session + join code (no persistent orgs) |
| Auth | Anonymous join + optional account upgrade |
| Infra | Node host + Postgres + Redis + **transactional outbox** |
| Hosting | Railway/Fly (persistent Node; **not** Vercel) |
| ORM | Drizzle + drizzle-kit |
| Monorepo | Turborepo + pnpm workspaces |
| Backend impl | **Codex** |
| Frontend impl | Standard lane |

---

## 4. Architecture

### 4.1 Approach: modular monolith + outbox

One SvelteKit app (adapter-node) + one worker process, sharing packages. Communicates via Postgres (data+outbox), Redis (pub/sub + BullMQ). Chosen over microservices: teaches the full pattern canon (outbox, fanout, queue, idempotency) without the ops overhead; module boundaries (relay, worker, gateway) let it split later if ever needed.

### 4.2 Ports & adapters (hexagonal)

Domain (`packages/core`) depends only on **ports** (interfaces). Vendors are **adapters** chosen at a single composition root from env. Domain types (`Restaurant`, `LineItem`) are ours; adapters map vendor JSON → domain type at the edge. Every port ships a **Fake** adapter.

| Port | Method | P1 adapter → alternatives + Fake |
|---|---|---|
| `PlacesProvider` | `searchNearby(lat,lng,radius,cuisines) → Restaurant[]` | Google Places (New) → Mapbox/Foursquare · FakePlaces |
| `OcrProvider` (P2) | `extractReceipt(image) → LineItem[]` | Mindee → AWS Textract · FakeOcr |
| `EventBus` | `publish(channel,event)` / `subscribe(channel)` | Redis pub/sub → Postgres NOTIFY-only · InMemoryBus |
| `JobQueue` | `enqueue(job)` / `process(handler)` | BullMQ → InlineQueue |
| `Cache` | `get/set(key,ttl)` | Redis → MemoryCache |
| `AuthProvider` | session/identity | Better Auth (thin wrapper) |

**Rules:** ports in `core/ports/*`; adapters in `packages/adapters/<vendor>/*`; injected via constructor. Swap = change env + register adapter, zero domain edits. Each real adapter passes the **same port contract test** the Fake passes → swap-safety.

### 4.3 Diagram

```
Browser (SvelteKit + Svelte 5 runes)
   │  oRPC (commands+queries, shared types)
   │  SSE  GET /sessions/:id/events   (live)
   ▼
┌──────────────────────────────────────────────┐
│ SvelteKit Node server (Railway/Fly)           │
│  oRPC handlers · Better Auth · SSE gateway     │
│  outbox relay (LISTEN → EventBus)              │
└──────┬──────────────────────┬──────────────────┘
  tx: domain+outbox       enqueue
       ▼                      ▼
  ┌─────────┐          ┌──────────────┐
  │Postgres │          │ Redis        │
  │ +outbox │◀─NOTIFY─▶│ pub/sub+Bull │
  └─────────┘          └──────┬───────┘
                              │ jobs
                              ▼
                   ┌────────────────────────┐
                   │ Worker                  │
                   │ Places fetch+cache      │
                   │ OCR (P2) · poll-close   │
                   └────────────────────────┘
   external (behind adapters): Google Places · Mindee (P2)
```

**Module boundaries:** API (oRPC handlers; writes domain+outbox, no direct Redis) · Relay (only reader of outbox; at-least-once publish) · Gateway (stateless SSE; subscribes Redis) · Worker (only caller of Places/OCR; caches).

---

## 5. Data model

### 5.1 Better Auth owns (generated via `@better-auth/cli generate`, do not hand-edit)

- `user` — id, name, email, emailVerified, image, createdAt, updatedAt **+ isAnonymous** (anonymous plugin) **+ displayName** (additionalFields)
- `session` — id, userId→user.id, token, expiresAt, ipAddress, userAgent, createdAt, updatedAt
- `account` — id, userId, accountId, providerId, accessToken, refreshToken, …, password, …
- `verification` — id, identifier, value, expiresAt, …

Anon→real upgrade: `onLinkAccount({anonymousUser,newUser})` re-points app rows (`session_member`, `swipe`, `vote`, P2 `bill_assignment`) from anon id → new id; Better Auth then deletes the anon user.

### 5.2 App tables (Drizzle; all FK `user.id` ON DELETE CASCADE)

```
lunch_session   id, join_code (unique), host_user_id, status(lobby|swiping|polling|decided|closed),
                center_lat, center_lng, base_radius_m(500), cuisines text[], winner_candidate_id?,
                created_at, expires_at
session_member  session_id, user_id, role(host|member), radius_m, joined_at   PK(session_id,user_id)
restaurant_cache id, provider, provider_place_id, name, lat, lng, cuisines text[], price_level,
                rating, photo_ref, address, fetched_at   UNIQUE(provider,provider_place_id)
swipe           id, session_id, user_id, restaurant_id, decision(accept|reject), created_at
                UNIQUE(session_id,user_id,restaurant_id)
poll_candidate  id, session_id, restaurant_id, promoted_at   UNIQUE(session_id,restaurant_id)
vote            id, session_id, candidate_id, user_id, value(+1|-1), created_at
                UNIQUE(session_id,candidate_id,user_id)
-- P2
bill            id, session_id, image_url, status, subtotal, tax, tip, total
bill_line_item  id, bill_id, label, amount, qty
bill_assignment id, line_item_id, user_id, share_amount
```

### 5.3 Outbox

```
outbox_event
  id uuid pk · aggregate text · aggregate_id uuid (→ SSE channel key)
  type text (member.joined|restaurant.promoted|vote.cast|poll.opened|poll.closed|deck.replenished|prompt.broaden)
  payload jsonb · created_at · dispatched_at (null=pending) · attempts int
  INDEX (dispatched_at) WHERE dispatched_at IS NULL          -- partial; relay scans pending only
```

Write path (atomic): `BEGIN; <domain write>; INSERT outbox_event; COMMIT;` then trigger `NOTIFY outbox`. Domain change + event are all-or-nothing.

> **Hand-written migration (not expressible in Drizzle DSL):** the `NOTIFY` trigger + the partial index. drizzle-kit runs it alongside generated migrations.

---

## 6. Event flow

### Join
`oRPC session.join` → tx insert `session_member` + outbox `member.joined` → relay → `session:{id}` channel → SSE updates lobby for all.

### Swipe → promote
`oRPC swipe.decide` → tx insert `swipe` (UNIQUE = idempotent). If accept and distinct-accept count ≥ threshold and not already candidate → insert `poll_candidate` + outbox `restaurant.promoted` → live to all.

### Radius / "ask for more"
Per-member reject streak in Redis (`streak:{session}:{user}`); reject→++, accept→0. Streak ≥ 5 **or** deck ≤ 2 → `radius_m += 500` (cap 3000) → enqueue `places.fetch` for new ring → top up → emit `deck.replenished` (that member only). At cap + still dry → `prompt.broaden`.

### Deck source
Worker `places.fetch` calls `PlacesProvider` → maps → `restaurant_cache` (dedup) → cache key `geohash6:radius:cuisines` in Redis, TTL 30 min.

### Poll → winner
`oRPC poll... startPoll` (host) → status polling, deadline now+5min, emit `poll.opened`, enqueue delayed BullMQ `poll.close` (jobId `poll-close:{sessionId}`).
`oRPC poll.vote` → tx UPSERT `vote` (UNIQUE) + outbox `vote.cast` → live tally.
Close (timer or host) → worker computes winner (max net; tie→earliest promoted) → tx update `lunch_session` decided + winner → outbox `poll.closed` → live 🎉. Guard `status=decided` for idempotency.

### Reconnect
SSE client sends `Last-Event-ID` (=outbox_event.id) → gateway replays outbox rows for that `aggregate_id` after it. Outbox = the event log.

---

## 7. API surface (oRPC)

`packages/contract` = router types + Zod schemas (single source: validation + types + OpenAPI). Realtime is **not** in oRPC — it's the SSE stream. oRPC middleware injects `ctx.user` (Better Auth); procedures guard `requireMember`/`requireHost`.

```
session: create | join | get(query) | startPoll(host) | end(host)
swipe:   decide | deck(query) | broaden
poll:    vote | results(query)
bill (P2): create | addReceipt(image) | assign | summary
```

Mobile (P2): Expo + `@orpc/client` + same `packages/contract` + same SSE + Better Auth Expo client. No core/contract change.

---

## 8. Monorepo (Turborepo + pnpm)

```
apps/{web(SvelteKit,adapter-node), mobile(Expo,P2), worker(BullMQ)}
packages/{contract, core, adapters, db, ui, tokens, config}
```

`turbo.json` tasks: `build` dependsOn `^build` (contract before consumers), `dev` (persistent, no cache), `check-types` dependsOn `^build`, `test`, `lint`, `db:migrate` (no cache). Scope with `--filter`.

**Shared cross-platform (web↔mobile):** `packages/tokens` (colors/spacing/type → Tailwind theme for web, NativeWind/StyleSheet for mobile) and headless logic/state in `core` (swipe deck, tally, timers). **Rendered components are platform-specific** — `packages/ui` = Svelte (web); mobile gets its own RN components consuming the same tokens + core. (Svelte components cannot render in React Native; sharing tokens+behavior is the honest boundary.)

`packages/config` = shared tsconfig/eslint + Zod-validated `env.ts` (the `*_PROVIDER` adapter switches).

---

## 9. Infra & connection topology

**Local:** `docker-compose.yml` — Postgres, **PgBouncer in transaction mode** (mirrors prod so pooling bugs surface locally), Redis, app, worker, bull-board.

**Prod:** Railway/Fly persistent Node + managed Postgres + Redis. PgBouncer (transaction mode) for pooling.

**Two connection paths (critical):**

| Path | Env / connection | Used for |
|---|---|---|
| Pooled | `DATABASE_URL` — PgBouncer transaction mode | All app queries, outbox INSERT, **NOTIFY** ✅ |
| Direct | `DATABASE_DIRECT_URL` — bypass pooler (direct/session) | **LISTEN** (relay) only + drizzle-kit migrations |

Rationale: PgBouncer transaction mode **breaks `LISTEN`** (connection not pinned between txns) but `NOTIFY` works. Only the relay's listener needs the direct connection.

**Hard requirements:**
- **`prepare: false`** on the postgres.js pooled connection (prepared statements break under PgBouncer tx mode; invisible locally, fails under prod load — the #1 trap).
- Relay uses **postgres.js `sql.listen()` on `DATABASE_DIRECT_URL`** (auto-reconnect + re-register LISTEN). Do **not** use raw `pg` for the listener (silently stops after reconnect).
- **Fallback:** if a host blocks direct connections, relay degrades to **1s outbox polling** via the same `EventBus` port — no LISTEN.

---

## 10. Error handling & failure modes

| Failure | Mitigation |
|---|---|
| Dual-write (event lost) | Outbox — domain+event one tx; relay publishes after commit; never publish from request path |
| Relay crash mid-dispatch | At-least-once + idempotent consumers (dedupe `outbox_event.id`); safe re-publish |
| Duplicate poll-close timers | Deterministic BullMQ `jobId=poll-close:{sessionId}`; close guarded by `status=decided` |
| Places down / quota | Adapter → typed `ProviderError`; serve stale cache; circuit-break → cached/Fake; UI "limited results" |
| OCR garbage (P2) | Never auto-finalize; OCR → draft line items → mandatory human confirm |
| SSE disconnect | Auto-reconnect + `Last-Event-ID` replay; 25s heartbeat |
| Redis down | EventBus port → degrade to Postgres NOTIFY-only fanout; jobs retry w/ backoff |
| Concurrent vote change | UPSERT on UNIQUE → atomic last-write-wins |
| Double promote | UNIQUE(session,restaurant) on poll_candidate → no-op |
| Bad/expired join code | Unique code; reject if status=closed or past expires_at |

**Error model:** domain throws typed errors (`SessionClosedError`, `NotHostError`, `ProviderError`) → oRPC maps to codes (`FORBIDDEN`/`NOT_FOUND`/`UNAVAILABLE`) → friendly client message; no raw stack to client. Adapters wrap vendor errors into `ProviderError` at the edge.

---

## 11. Testing

- **Vitest** — core domain unit vs Fake adapters (promote rule, radius/streak, winner calc, idempotency); contract/Zod; oRPC guards. Single: `vitest run -t "<name>"`.
- **Playwright — component tests:** render Svelte components in real browser, **assert styling matches `DESIGN.md`** (computed styles, layout, tokens). (DESIGN.md to be provided.)
- **Playwright — E2E:** 3 simulated members, full flow join→swipe→promote→poll→vote→winner over SSE, incl. reconnect replay. Single: `playwright test <file> -g "<title>"`.
- **testcontainers** — integration over real Postgres + outbox→relay→bus (event emitted on commit, replay, consumer dedupe).
- **Adapter contract tests** — each real adapter passes the same port suite as its Fake → swap-safety.
- **Load smoke** — k6/autocannon on swipe+vote to observe cache hits + fanout (where the system design becomes visible).

**Observability (light):** structured logs (sessionId, eventId, userId); outbox lag metric (pending count, oldest-pending age); bull-board for jobs/retries/DLQ.

---

## 12. Implementation ownership

- **Backend → Codex:** `packages/core` (domain + ports), `packages/adapters` (Google, Mindee, Redis, BullMQ, Better Auth, Fakes), outbox relay, `apps/web` server (oRPC handlers, SSE gateway, auth wiring), `apps/worker`, `packages/db` (Drizzle schema + migrations incl. hand-written outbox trigger/index).
- **Frontend → standard lane:** `apps/web` UI (SvelteKit, Svelte 5 runes, swipe UI), `packages/ui` (Svelte components), `packages/tokens`, component + E2E tests.
- Authoring and review are separate passes; no self-approval in the same context.

---

## 13. Pinned defaults

promote_threshold=2 · reject-streak expand trigger=5 · radius base=500m, step +500m, cap=3000m · poll timer=5min · Places cache TTL=30min · poll tie-break=earliest promoted_at.

---

## 14. Open items (resolve before/while implementing)

- `DESIGN.md` (styling tokens/spec) — user to provide; drives `packages/tokens` + Playwright component-style assertions.
- Exact host choice Railway vs Fly (both satisfy persistent-Node requirement).
- Google Places billing/key setup + field mask finalization (cost control).
- P2 Mindee account + free-tier limits confirmation.

---

## Sources (research)

- Better Auth: database, anonymous plugin, SvelteKit integration, organization plugin
- oRPC SvelteKit adapter; tRPC vs oRPC comparison
- Postgres LISTEN/NOTIFY + SvelteKit; Vercel function limits
- PgBouncer features/FAQ + issue #655; Supabase pooler deprecation; Neon pooled vs direct; Crunchy Data prepared-statements-in-tx-mode; postgres.js listen API; pg-listen
- Google Places (New) Nearby Search + billing
- Mindee receipt OCR; AWS Textract AnalyzeExpense pricing
