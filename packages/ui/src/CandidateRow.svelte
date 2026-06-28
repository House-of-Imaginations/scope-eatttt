<script lang="ts">
import type { Candidate } from "@scope/contract";
import Button from "./Button.svelte";

const {
	candidate,
	myVote = undefined,
	onvote,
}: {
	candidate: Candidate;
	/** This client's current vote, if any — highlights the matching button. */
	myVote?: 1 | -1 | undefined;
	onvote?: (value: 1 | -1) => void;
} = $props();
</script>

<!-- Comic candidate row: project-card mechanic — white surface, 3px stroke
     border, radius-lg, flat block shadow. Holds the restaurant name + cuisine
     tags, the live tally, and the two vote controls. -->
<div class="candidate-row">
  <div class="info">
    <h3 class="name">{candidate.restaurant.name}</h3>
    <ul class="tags">
      {#each candidate.restaurant.cuisineTags as tag (tag)}
        <li class="chip">{tag}</li>
      {/each}
    </ul>
    <p class="tally" data-testid="candidate-tally">
      <span class="up">▲ {candidate.upvotes}</span>
      <span class="down">▼ {candidate.downvotes}</span>
      <span class="net">Net {candidate.netScore}</span>
    </p>
  </div>

  <div class="votes">
    <span class:active={myVote === 1}>
      <Button
        variant={myVote === 1 ? "accept" : "secondary"}
        onclick={() => onvote?.(1)}
      >
        ▲ Up
      </Button>
    </span>
    <span class:active={myVote === -1}>
      <Button
        variant={myVote === -1 ? "reject" : "secondary"}
        onclick={() => onvote?.(-1)}
      >
        ▼ Down
      </Button>
    </span>
  </div>
</div>

<style>
  .candidate-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-md, 16px);
    width: 100%;
    box-sizing: border-box;
    padding: 16px;
    background-color: var(--color-surface-card);
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-block);
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }

  .name {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 20px;
    line-height: 1.3;
    color: var(--color-ink);
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* category-badge silhouette — the one place all-caps is allowed. */
  .chip {
    padding: 4px 8px;
    background-color: var(--color-bubblegum-pink);
    border: 2px solid var(--color-stroke);
    border-radius: var(--radius-sm);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 12px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-ink);
  }

  .tally {
    display: flex;
    gap: 12px;
    margin: 0;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 14px;
    color: var(--color-ink-muted);
  }

  .tally .up {
    color: var(--color-accept);
  }

  .tally .down {
    color: var(--color-reject);
  }

  .tally .net {
    color: var(--color-ink);
  }

  .votes {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
  }
</style>
