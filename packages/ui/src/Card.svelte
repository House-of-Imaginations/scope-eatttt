<script lang="ts">
import type { Snippet } from "svelte";

const {
	children,
}: {
	children?: Snippet;
} = $props();
</script>

<div class="card">
  {@render children?.()}
</div>

<style>
  /* DESIGN.md `project-card` mechanic: white surface, 3px stroke border,
     radius-lg, flat hard-edged block shadow. On hover the whole card rises
     up-and-left while the offset shadow expands — pure CSS, no blur, no JS. */
  .card {
    background-color: var(--color-surface-card);
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-block);
    transition:
      transform 100ms ease-out,
      box-shadow 100ms ease-out;
  }

  .card:hover {
    transform: translate(-3px, -3px);
    /* shadow grows to fill the gap the lifted card leaves — mechanical pop. */
    box-shadow: 7px 7px 0 var(--color-stroke);
  }
</style>
