<script lang="ts">
import type { Snippet } from "svelte";

type Variant = "primary" | "secondary" | "accept" | "reject";

const {
	variant = "primary",
	disabled = false,
	type = "button",
	onclick,
	children,
}: {
	variant?: Variant;
	disabled?: boolean;
	type?: "button" | "submit" | "reset";
	onclick?: (event: MouseEvent) => void;
	children?: Snippet;
} = $props();
</script>

<button class="btn {variant}" {type} {disabled} {onclick}>
  {@render children?.()}
</button>

<style>
  /* pill-button-primary silhouette (DESIGN.md): radius-full, 48px touch height,
     3px stroke border, weight-800 display label, flat hard-edged block shadow.
     Hover/active = analog press: element translates down-right while the fixed
     offset shadow collapses to 0. All values come from @scope/tokens vars. */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 48px;
    padding: 12px 24px;
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-full);
    background-color: var(--color-primary);
    color: var(--color-ink);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 16px;
    line-height: 1;
    letter-spacing: 0.5px;
    cursor: pointer;
    box-shadow: 3px 3px 0 var(--color-stroke);
    transition:
      transform 80ms ease-out,
      box-shadow 80ms ease-out;
    /* the shadow lives down-right; press translates into it so the block
       visually flattens (mechanical pop) without any blur. */
    transform: translate(0, 0);
  }

  .btn:hover:not(:disabled),
  .btn:active:not(:disabled) {
    transform: translate(3px, 3px);
    box-shadow: 0 0 0 var(--color-stroke);
  }

  .btn:focus-visible {
    outline: 3px solid var(--color-accent);
    outline-offset: 2px;
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
    box-shadow: 3px 3px 0 var(--color-stroke);
  }

  .primary {
    background-color: var(--color-primary);
    color: var(--color-ink);
  }

  .secondary {
    background-color: var(--color-surface-card);
    color: var(--color-ink);
  }

  .accept {
    background-color: var(--color-accept);
    color: var(--color-ink);
  }

  .reject {
    background-color: var(--color-reject);
    color: var(--color-surface-card);
  }
</style>
