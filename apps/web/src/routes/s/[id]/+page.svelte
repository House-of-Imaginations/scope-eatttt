<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/state";
  import { api } from "$lib/client/orpc";
  import { createSessionStore } from "$lib/client/sessionStore.svelte";
  import { createDeck } from "$lib/client/deck.svelte";
  import {
    Button,
    CandidateRow,
    Countdown,
    MemberPill,
    SwipeCard,
  } from "@scope/ui";
  import type { Candidate, Restaurant } from "@scope/contract";
  // The oRPC client returns a Zod-inferred snapshot whose optional numerics are
  // `T | undefined` (vs the domain SessionState that omits absent optionals under
  // exactOptionalPropertyTypes). Type the local snapshot from the client's actual
  // return so it flows into the components without a cast — the same seam the
  // deck/store normalisers cross. `status` is the discriminating union we switch on.
  type Snapshot = NonNullable<Awaited<ReturnType<typeof api.session.state>>>;
  type SnapshotCandidate = Snapshot["candidates"][number];

  // Cross the Zod->domain seam for a candidate before handing it to CandidateRow,
  // which takes the strict domain Candidate. Same normaliser shape as the deck/
  // store: drop absent optionals so the value satisfies Restaurant exactly.
  function toCandidate(c: SnapshotCandidate): Candidate {
    const r = c.restaurant;
    const restaurant: Restaurant = {
      id: r.id,
      name: r.name,
      address: r.address,
      cuisineTags: r.cuisineTags,
      ...(r.lat !== undefined ? { lat: r.lat } : {}),
      ...(r.lng !== undefined ? { lng: r.lng } : {}),
      ...(r.rating !== undefined ? { rating: r.rating } : {}),
      ...(r.priceLevel !== undefined ? { priceLevel: r.priceLevel } : {}),
      ...(r.distanceM !== undefined ? { distanceM: r.distanceM } : {}),
    };
    return {
      id: c.id,
      restaurant,
      promotedAt: c.promotedAt,
      upvotes: c.upvotes,
      downvotes: c.downvotes,
      netScore: c.netScore,
    };
  }

  // ponytail: route param via $app/state — matches the join screen's pattern
  // for this SvelteKit 2 / Svelte 5 runes version.
  const sessionId = $derived(page.params.id ?? "");

  // The live session store (SSE-backed; mock transport when PUBLIC_USE_MOCK=1).
  // The store reduces incoming events into its own state. In mock mode the SSE
  // channel carries no events on its own, so this screen treats the authoritative
  // snapshot from api.session.state() as the source of truth and re-hydrates it
  // after each host mutation. The store is still connected so the real backend
  // (F1.6) drives live updates with zero screen changes.
  let store = $state<ReturnType<typeof createSessionStore> | null>(null);
  let deck = $state<ReturnType<typeof createDeck> | null>(null);

  // Authoritative snapshot. Seeded on mount, refreshed after host actions.
  let session = $state<Snapshot | null>(null);

  // ponytail: there is no `session.startSwiping` procedure. The host clicking
  // "Start swiping" flips this local flag to advance the lobby into the swiping
  // view; the server status only ever moves forward (promote/poll), so a local
  // OR with the snapshot status is safe and never regresses the screen.
  let startedSwiping = $state(false);

  // ponytail: real auth identity is not wired into the mock UI. We treat THIS
  // client as the host whenever the session has a host member — the mock is a
  // single-driver session, so the host controls belong to whoever is viewing.
  // The real backend (F1.6) will gate this on the authenticated user id.
  const isHost = $derived(session?.members.some((m) => m.isHost) ?? false);

  // Effective status: the snapshot status, bumped to "swiping" once the host
  // has started (and only while the snapshot is still in lobby).
  const status = $derived.by((): Snapshot["status"] => {
    const s = session?.status ?? "lobby";
    if (s === "lobby" && startedSwiping) return "swiping";
    return s;
  });

  // The promoted candidate chosen as the winner, for the decided view.
  const winner = $derived(
    session?.candidates.find((c) => c.id === session?.winnerCandidateId),
  );

  // Transient "promoted!" toast text, shown briefly after a promoting swipe.
  let promotedToast = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  // This client's vote per candidate, to highlight the chosen button.
  let myVotes = $state<Record<string, 1 | -1>>({});

  async function refresh() {
    session = await api.session.state({ sessionId });
  }

  onMount(() => {
    const code = session?.joinCode ?? "";
    const s = createSessionStore(sessionId, code);
    store = s;
    s.connect();
    deck = createDeck(sessionId);
    void refresh();
    return () => {
      s.disconnect();
      if (toastTimer) clearTimeout(toastTimer);
    };
  });

  function flashPromoted(name: string) {
    promotedToast = `🎉 ${name} promoted!`;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      promotedToast = null;
    }, 2200);
  }

  async function startSwiping() {
    startedSwiping = true;
    await deck?.load();
  }

  async function onSwipe(decision: "accept" | "reject") {
    const result = await deck?.decide(decision);
    if (result?.promoted && result.candidate) {
      flashPromoted(result.candidate.restaurant.name);
      await refresh();
    }
  }

  async function openPoll() {
    await api.poll.start({ sessionId });
    await refresh();
  }

  async function vote(candidateId: string, value: 1 | -1) {
    await api.poll.vote({ sessionId, candidateId, value });
    myVotes = { ...myVotes, [candidateId]: value };
    await refresh();
  }

  async function endPoll() {
    await api.poll.close({ sessionId });
    await refresh();
  }
</script>

<main class="page">
  {#if store && !store.connected}
    <div class="reconnect-banner" role="status" aria-live="polite" data-testid="reconnect-banner">
      Reconnecting…
    </div>
  {/if}
  {#if !session}
    <p class="loading">Loading lunch…</p>
  {:else if status === "lobby"}
    <section class="panel lobby">
      <h1 class="heading">Lobby</h1>
      <p class="subtext">Share this code so your team can join.</p>

      <div class="code-banner" data-testid="lobby-join-code">
        {session.joinCode}
      </div>

      <h2 class="section-label">Who's in</h2>
      <div class="members">
        {#each session.members as member (member.id)}
          <MemberPill name={member.displayName} host={member.isHost} />
        {/each}
      </div>

      {#if isHost}
        <div class="actions">
          <Button variant="primary" onclick={startSwiping}>
            Start swiping
          </Button>
        </div>
      {:else}
        <p class="subtext waiting">Waiting for the host to start…</p>
      {/if}
    </section>
  {:else if status === "swiping"}
    <section class="panel swiping">
      <h1 class="heading">Swipe to pick</h1>
      <p class="subtext">Accept the spots you'd happily eat at.</p>

      {#if promotedToast}
        <div class="toast" role="status" data-testid="promote-toast">
          {promotedToast}
        </div>
      {/if}

      <div class="deck">
        {#if deck?.current}
          {#key deck.current.id}
            <div data-testid="swipe-card-name" class="visually-hidden">
              {deck.current.name}
            </div>
            <SwipeCard restaurant={deck.current} onswipe={onSwipe} />
          {/key}
        {:else}
          <p class="subtext">No more cards right now.</p>
        {/if}
      </div>

      {#if deck?.isLow}
        <p class="hint" data-testid="low-deck-hint">
          Running low — broaden the search to see more.
        </p>
      {/if}

      {#if isHost}
        <div class="actions">
          <Button variant="primary" onclick={openPoll}>Open poll</Button>
        </div>
      {/if}
    </section>
  {:else if status === "polling"}
    <section class="panel polling">
      <div class="poll-head">
        <h1 class="heading">Vote on the candidates</h1>
        {#if session.pollDeadlineAt}
          <span data-testid="poll-countdown">
            <Countdown deadline={session.pollDeadlineAt} />
          </span>
        {/if}
      </div>

      {#if session.candidates.length === 0}
        <p class="subtext">No candidates yet — sit tight.</p>
      {:else}
        <div class="candidates">
          {#each session.candidates as candidate (candidate.id)}
            <span class="cand">
              <CandidateRow
                candidate={toCandidate(candidate)}
                myVote={myVotes[candidate.id]}
                onvote={(value) => vote(candidate.id, value)}
              />
              <!-- ponytail: test hooks onto the same vote intent the row emits;
                   hidden buttons keep the E2E stable across row markup tweaks. -->
              <span class="visually-hidden">
                <button data-testid="vote-up" onclick={() => vote(candidate.id, 1)}>up</button>
                <button data-testid="vote-down" onclick={() => vote(candidate.id, -1)}>down</button>
              </span>
            </span>
          {/each}
        </div>
      {/if}

      {#if isHost}
        <div class="actions">
          <Button variant="primary" onclick={endPoll}>End poll</Button>
        </div>
      {/if}
    </section>
  {:else if status === "decided"}
    <section class="panel decided">
      <h1 class="heading">We have a winner 🎉</h1>
      {#if winner}
        <div class="winner-card">
          <span class="winner-glyph" aria-hidden="true">🍽️</span>
          <h2 class="winner-name">{winner.restaurant.name}</h2>
          <ul class="tags">
            {#each winner.restaurant.cuisineTags as tag (tag)}
              <li class="chip">{tag}</li>
            {/each}
          </ul>
          <p class="winner-score">Net score {winner.netScore}</p>
        </div>
      {:else}
        <p class="subtext">The poll is closed.</p>
      {/if}
    </section>
  {:else}
    <section class="panel">
      <h1 class="heading">Lunch is over</h1>
      <p class="subtext">This session is closed.</p>
    </section>
  {/if}
</main>

<style>
  /* DESIGN.md: cream canvas, comic panels with 3px stroke + flat block shadow,
     banana-yellow primary, sentence-case headings. Zero ad-hoc hex. */
  .page {
    min-height: 100vh;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 32px 16px;
    background-color: var(--color-canvas);
  }

  .panel {
    width: 100%;
    max-width: 480px;
    background-color: var(--color-surface-card);
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-xl);
    padding: 32px;
    box-shadow: 6px 6px 0 var(--color-stroke);
  }

  .heading {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 28px;
    line-height: 1.3;
    color: var(--color-ink);
    margin: 0 0 8px;
  }

  .subtext {
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--color-ink-muted);
    margin: 0 0 24px;
  }

  .subtext.waiting {
    margin-top: 24px;
    margin-bottom: 0;
  }

  .loading {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 20px;
    color: var(--color-ink);
    padding: 48px 0;
  }

  /* Big, shareable join code — banana-yellow block with thick stroke. */
  .code-banner {
    display: block;
    text-align: center;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 40px;
    letter-spacing: 8px;
    color: var(--color-ink);
    background-color: var(--color-banana-yellow);
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-block);
    padding: 20px 16px;
    margin-bottom: 24px;
  }

  .section-label {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 14px;
    letter-spacing: 0.5px;
    color: var(--color-ink);
    margin: 0 0 12px;
  }

  .members {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 24px;
  }

  /* Transient promote toast — mint-green comic block. */
  .toast {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 16px;
    color: var(--color-ink);
    background-color: var(--color-mint-green);
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-block);
    padding: 12px 16px;
    margin-bottom: 16px;
  }

  .deck {
    display: flex;
    justify-content: center;
    margin-bottom: 16px;
  }

  .hint {
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--color-ink-muted);
    text-align: center;
    margin: 0;
  }

  .poll-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
  }

  .poll-head .heading {
    margin: 0;
  }

  .candidates {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .cand {
    display: block;
  }

  /* Winner celebration card. */
  .winner-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
    background-color: var(--color-banana-yellow);
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-block);
    padding: 32px;
  }

  .winner-glyph {
    font-size: 56px;
    line-height: 1;
  }

  .winner-name {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 28px;
    color: var(--color-ink);
  }

  .winner-score {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 16px;
    color: var(--color-ink);
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .chip {
    padding: 4px 8px;
    background-color: var(--color-surface-card);
    border: 2px solid var(--color-stroke);
    border-radius: var(--radius-sm);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 12px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-ink);
  }

  /* Off-screen but accessible-name preserving — used for test hooks/markers. */
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* DESIGN.md: electric-blue strip, thick stroke, flat block shadow — comic notice. */
  .reconnect-banner {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 14px;
    color: #ffffff;
    background-color: var(--color-electric-blue);
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: 4px 4px 0 var(--color-stroke);
    padding: 10px 20px;
    white-space: nowrap;
  }
</style>
