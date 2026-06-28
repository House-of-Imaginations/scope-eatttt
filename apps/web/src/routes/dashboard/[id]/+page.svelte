<script lang="ts">
  import { Avatar } from "@scope/ui";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const summary = $derived(data.summary);
  // Highest net score first — read-only leaderboard view.
  const candidates = $derived(
    [...(summary?.candidates ?? [])].sort((a, b) => b.netScore - a.netScore),
  );
</script>

<main class="page">
  {#if !summary}
    <section class="panel" data-testid="summary-not-found">
      <h1 class="heading">Lunch not found</h1>
      <p class="subtext">This lunch doesn't exist or you weren't part of it.</p>
      <a class="back" href="/dashboard">Back to your lunches</a>
    </section>
  {:else}
    <section class="panel" data-testid="summary">
      <h1 class="heading">{summary.title ?? summary.joinCode}</h1>
      <p class="subtext">Join code {summary.joinCode}</p>

      {#if summary.winnerName}
        <div class="winner-card" data-testid="summary-winner">
          <span class="winner-glyph" aria-hidden="true">🏆</span>
          <h2 class="winner-name">{summary.winnerName}</h2>
        </div>
      {/if}

      <h2 class="section-label">Candidates</h2>
      {#if candidates.length === 0}
        <p class="subtext">No candidates were promoted.</p>
      {:else}
        <ul class="candidates">
          {#each candidates as candidate (candidate.id)}
            <li class="cand" data-testid="summary-candidate">
              <span class="cand-name">{candidate.restaurant.name}</span>
              <span class="cand-score" data-testid="candidate-net">Net {candidate.netScore}</span>
            </li>
          {/each}
        </ul>
      {/if}

      <h2 class="section-label">Who was in</h2>
      <div class="members">
        {#each summary.members as member (member.id)}
          <span class="member" data-testid="summary-member">
            <Avatar name={member.displayName} image={member.image} />
            <span class="member-name">{member.displayName}</span>
          </span>
        {/each}
      </div>
    </section>
  {/if}
</main>

<style>
  /* DESIGN.md: cream canvas, comic panel with 3px stroke + flat block shadow,
     banana-yellow winner, sentence-case headings. Zero ad-hoc hex. */
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

  .back {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 14px;
    color: var(--color-ink);
  }

  .section-label {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 14px;
    letter-spacing: 0.5px;
    color: var(--color-ink);
    margin: 0 0 12px;
  }

  /* Winner card — banana-yellow comic block, mirrors the session decided view. */
  .winner-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    text-align: center;
    background-color: var(--color-banana-yellow);
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-block);
    padding: 24px;
    margin-bottom: 24px;
  }

  .winner-glyph {
    font-size: 48px;
    line-height: 1;
  }

  .winner-name {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 24px;
    color: var(--color-ink);
  }

  .candidates {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0 0 24px;
    padding: 0;
    list-style: none;
  }

  .cand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    background-color: var(--color-surface-card);
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-block);
  }

  .cand-name {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 16px;
    color: var(--color-ink);
  }

  .cand-score {
    flex-shrink: 0;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 14px;
    color: var(--color-ink);
  }

  .members {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .member {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .member-name {
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--color-ink);
  }
</style>
