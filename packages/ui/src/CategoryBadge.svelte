<script lang="ts">
  import type { Snippet } from "svelte";

  type Tone = "pink" | "mint";

  let {
    tone = "pink",
    children,
  }: {
    tone?: Tone;
    children?: Snippet;
  } = $props();
</script>

<span class="badge {tone}">{@render children?.()}</span>

<style>
  /* DESIGN.md `category-badge`: tiny non-interactive micro-pill. pink/mint fill,
     2px stroke border, radius-sm (6px), 4x8 padding, label-uppercase type
     (12px / 800 / 1px tracking, ALL-CAPS — the one place caps are allowed). */
  .badge {
    display: inline-flex;
    align-items: center;
    border: 2px solid var(--color-stroke);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 12px;
    line-height: 1;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-ink);
  }

  .pink {
    background-color: var(--color-bubblegum-pink);
  }

  .mint {
    background-color: var(--color-mint-green);
  }
</style>
