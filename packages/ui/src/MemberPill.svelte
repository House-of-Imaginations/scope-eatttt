<script lang="ts">
import Avatar from "./Avatar.svelte";

const {
	name,
	image,
	host = false,
}: {
	name: string;
	image?: string | undefined;
	host?: boolean;
} = $props();
</script>

<span class="pill" class:host>
  <Avatar {name} {image} size={24} />
  {#if host}<span class="marker" aria-label="host">★</span>{/if}
  {name}
</span>

<style>
  /* Member chip: bubblegum-pink fill, 2px stroke border, radius-full pill.
     Host gets a banana-yellow fill + star marker. Display name kept sentence
     case (no uppercase — caps live only on category-badge). */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 2px solid var(--color-stroke);
    border-radius: var(--radius-full);
    padding: 4px 12px 4px 4px;
    background-color: var(--color-bubblegum-pink);
    color: var(--color-ink);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 14px;
    line-height: 1.3;
  }

  .pill.host {
    background-color: var(--color-banana-yellow);
  }

  .marker {
    font-size: 12px;
  }
</style>
