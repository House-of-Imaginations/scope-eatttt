<script lang="ts">
import { untrack } from "svelte";

const {
	deadline,
}: {
	deadline: string | Date;
} = $props();

const secondsUntil = (d: string | Date) =>
	Math.max(0, Math.ceil((new Date(d).getTime() - Date.now()) / 1000));

// remaining whole seconds, never negative, recomputed each tick. Seeded once
// (untrack) so first paint is correct; the $effect owns all later updates.
let remaining = $state(untrack(() => secondsUntil(deadline)));

$effect(() => {
	// re-read deadline so changing the prop restarts the countdown.
	const end = new Date(deadline).getTime();
	remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
	if (remaining === 0) return;

	// ponytail: plain setInterval, no timer lib. Cleared on teardown / deps change.
	const id = setInterval(() => {
		const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
		remaining = left;
		if (left === 0) clearInterval(id);
	}, 1000);

	return () => clearInterval(id);
});

const label = $derived(
	`${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`,
);
</script>

<span class="countdown" class:done={remaining === 0}>{label}</span>

<style>
  /* mm:ss timer readout in the chunky display voice. Turns reject-red at zero. */
  .countdown {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 20px;
    line-height: 1;
    letter-spacing: 0.5px;
    color: var(--color-ink);
    font-variant-numeric: tabular-nums;
  }

  .countdown.done {
    color: var(--color-reject);
  }
</style>
