<script lang="ts">
  import { initials, colorFor } from "./avatar.js";

  let {
    name,
    image,
    size = 32,
  }: {
    name: string;
    // ponytail: allow `undefined` so callers can forward an optional image
    // under exactOptionalPropertyTypes without juggling spreads.
    image?: string | undefined;
    size?: number;
  } = $props();
</script>

<span style="display:inline-flex;">
  {#if image}
    <img
      src={image}
      alt={name}
      style="width:{size}px;height:{size}px;border:3px solid var(--color-stroke);border-radius:var(--radius-full);object-fit:cover;"
    />
  {:else}
    <span
      style="display:inline-flex;align-items:center;justify-content:center;width:{size}px;height:{size}px;border-radius:var(--radius-full);background:var({colorFor(name)});color:var(--color-ink);font-family:var(--font-display);font-weight:700;font-size:{Math.round(size * 0.4)}px;"
    >{initials(name)}</span>
  {/if}
</span>
