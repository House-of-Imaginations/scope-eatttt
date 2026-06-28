<script lang="ts">
import { goto } from "$app/navigation";
import CreatePollForm from "$lib/components/CreatePollForm.svelte";
import type { PageData } from "./$types";

const { data }: { data: PageData } = $props();

// ponytail: Intl.DateTimeFormat is stdlib — no date lib for one formatted date.
const dateFmt = new Intl.DateTimeFormat(undefined, {
	day: "numeric",
	month: "short",
	year: "numeric",
});

function formatDate(iso: string): string {
	return dateFmt.format(new Date(iso));
}
</script>

<main class="page">
  <section class="panel" data-testid="dashboard-history">
    <h1 class="heading">Your lunches</h1>
    <p class="subtext">Every session you've started or joined.</p>

    {#if data.items.length === 0}
      <p class="empty" data-testid="history-empty">No lunches yet</p>
    {:else}
      <ul class="history">
        {#each data.items as item (item.id)}
          <li>
            <a class="row" href={`/dashboard/${item.id}`} data-testid="history-row">
              <span class="row-main">
                <span class="row-title">
                  {item.title ?? `${item.joinCode} · ${formatDate(item.createdAt)}`}
                </span>
                {#if item.status === "decided" && item.winnerName}
                  <span class="row-winner">🏆 {item.winnerName}</span>
                {/if}
              </span>
              <span class="badge" data-status={item.status}>{item.status}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="panel">
    <h1 class="heading">Start a new lunch</h1>
    <p class="subtext">Pick a spot, set the timer, share the code.</p>
    <CreatePollForm oncreated={(r) => goto(`/s/${r.sessionId}`)} />
  </section>
</main>

<style>
  /* DESIGN.md: cream canvas, comic panels with 3px stroke + flat block shadow,
     banana-yellow primary, sentence-case headings. Zero ad-hoc hex. */
  .page {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
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

  .empty {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 16px;
    color: var(--color-ink-muted);
    margin: 0;
  }

  .history {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    text-decoration: none;
    padding: 16px;
    background-color: var(--color-surface-card);
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-block);
    transition:
      transform 100ms ease-out,
      box-shadow 100ms ease-out;
  }

  .row:hover {
    transform: translate(-3px, -3px);
    box-shadow: 7px 7px 0 var(--color-stroke);
  }

  .row-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .row-title {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 16px;
    color: var(--color-ink);
  }

  .row-winner {
    font-family: var(--font-body);
    font-size: 13px;
    color: var(--color-ink-muted);
  }

  /* Comic status badge — all-caps chip, thick stroke. Decided = mint, others
     fall back to the surface so the chip stays readable on every status. */
  .badge {
    flex-shrink: 0;
    padding: 4px 10px;
    border: 2px solid var(--color-stroke);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-card);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 12px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-ink);
  }

  .badge[data-status="decided"] {
    background-color: var(--color-mint-green);
  }

  .badge[data-status="polling"] {
    background-color: var(--color-banana-yellow);
  }
</style>
