<script lang="ts">
  import type { Restaurant } from "@scope/contract";
  import Button from "./Button.svelte";

  let {
    restaurant,
    onswipe,
  }: {
    restaurant: Restaurant;
    onswipe?: (decision: "accept" | "reject") => void;
  } = $props();

  // Past this many px of horizontal travel, releasing the drag commits a swipe;
  // anything shorter springs the card back to centre.
  const COMMIT_THRESHOLD = 96;

  // Live drag offset (px). 0 = resting/centred. Drives the CSS transform.
  let dragX = $state(0);
  let dragging = $state(false);
  let pointerId: number | null = null;
  let startX = 0;

  function commit(decision: "accept" | "reject") {
    onswipe?.(decision);
  }

  function onPointerDown(e: PointerEvent) {
    // Let the action buttons receive their own clicks: a pointerdown that starts
    // on a button must not become a card drag (capturing it would steal the
    // button's click).
    if ((e.target as HTMLElement).closest("button")) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    dragging = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || e.pointerId !== pointerId) return;
    dragX = e.clientX - startX;
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    if (dragX >= COMMIT_THRESHOLD) commit("accept");
    else if (dragX <= -COMMIT_THRESHOLD) commit("reject");
    dragX = 0; // spring back (CSS transition handles the ease when not dragging)
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      commit("accept");
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      commit("reject");
    }
  }

  // Price level → dollar signs (1..4); omitted when absent.
  const price = $derived(
    restaurant.priceLevel ? "$".repeat(restaurant.priceLevel) : "",
  );
</script>

<!-- The accept/reject Buttons below are the primary, fully-accessible controls.
     The card itself is additionally made focusable so ArrowLeft/ArrowRight can
     swipe it and the pointer drag has a key-operable equivalent — an intentional
     enhancement on a group container, so the non-interactive-element a11y hints
     are suppressed here deliberately. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="swipe-card"
  class:dragging
  role="group"
  tabindex="0"
  aria-label="Swipe {restaurant.name}. Arrow right to accept, arrow left to reject."
  style="transform: translateX({dragX}px) rotate({dragX * 0.04}deg);"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onkeydown={onKeydown}
>
  <!-- ponytail: comic placeholder block — Restaurant has no photo field, so no
       real image pipeline; a flat striped panel stands in for the hero photo. -->
  <div class="photo" aria-hidden="true">
    <span class="photo-glyph">🍽️</span>
  </div>

  <div class="body">
    <h2 class="name">{restaurant.name}</h2>

    <ul class="tags">
      {#each restaurant.cuisineTags as tag (tag)}
        <li class="chip">{tag}</li>
      {/each}
    </ul>

    {#if restaurant.rating !== undefined || price}
      <p class="meta">
        {#if restaurant.rating !== undefined}<span class="rating">★ {restaurant.rating}</span>{/if}
        {#if restaurant.rating !== undefined && price}<span class="dot"> · </span>{/if}
        {#if price}<span class="price">{price}</span>{/if}
      </p>
    {/if}
  </div>

  <div class="actions">
    <Button variant="reject" onclick={() => commit("reject")}>Reject</Button>
    <Button variant="accept" onclick={() => commit("accept")}>Accept</Button>
  </div>
</div>

<style>
  /* Comic card (DESIGN.md project-card mechanic): white surface, 3px stroke
     border, radius-lg, flat hard-edged block shadow. No blur, no gradient. */
  .swipe-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-md, 16px);
    width: 100%;
    max-width: 360px;
    padding: var(--space-md, 16px);
    background-color: var(--color-surface-card);
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-block);
    touch-action: pan-y; /* let the card own horizontal drags, page owns vertical */
    cursor: grab;
    user-select: none;
    /* spring-back ease when not actively dragging */
    transition: transform 160ms ease-out;
  }

  .swipe-card.dragging {
    cursor: grabbing;
    transition: none; /* follow the pointer 1:1 while dragging */
  }

  .swipe-card:focus-visible {
    outline: 3px solid var(--color-accent);
    outline-offset: 3px;
  }

  /* placeholder hero panel — flat comic block, no real image */
  .photo {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 160px;
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-sm);
    background-color: var(--color-surface-soft);
  }

  .photo-glyph {
    font-size: 48px;
    line-height: 1;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-xs, 8px);
  }

  .name {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 24px;
    line-height: 1.2;
    color: var(--color-ink);
  }

  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-xxs, 4px);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* cuisine chip — small comic micro-pill (category-badge silhouette) */
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

  .meta {
    margin: 0;
    font-family: var(--font-body);
    font-weight: 500;
    font-size: 16px;
    color: var(--color-ink-muted);
  }

  .actions {
    display: flex;
    justify-content: space-between;
    gap: var(--space-sm, 12px);
  }
</style>
