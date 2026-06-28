<script lang="ts">
import { goto } from "$app/navigation";
import CreatePollForm from "$lib/components/CreatePollForm.svelte";

let joinCode = $state<string | null>(null);

async function handleCreated(result: {
	sessionId: string;
	joinCode: string;
	memberId: string;
}) {
	joinCode = result.joinCode;
	// Show join code for 1.5 s so host can read it, then navigate.
	// ponytail: simple timeout — no need for a modal/drawer.
	await new Promise((r) => setTimeout(r, 1500));
	await goto(`/s/${result.sessionId}`);
}
</script>

<main class="page">
  <div class="card">
    <h1 class="heading">Where are we eating?</h1>
    <p class="subtext">Start a lunch session and share the code with your team.</p>

    <CreatePollForm oncreated={handleCreated} />

    {#if joinCode}
      <div class="join-code-banner" data-testid="join-code">
        <span class="join-code-label">Share this code</span>
        <span class="join-code-value">{joinCode}</span>
      </div>
    {/if}
  </div>
</main>

<style>
  /* DESIGN.md: cream canvas, comic card with 3px stroke + flat block shadow */
  .page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
    background-color: var(--color-canvas);
  }

  .card {
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

  /* Join code confirmation banner (shown after API returns, before nav completes) */
  .join-code-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    margin-top: 16px;
    background-color: var(--color-banana-yellow);
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: 4px 4px 0 var(--color-stroke);
  }

  .join-code-label {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 12px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-ink);
  }

  .join-code-value {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 22px;
    letter-spacing: 4px;
    color: var(--color-ink);
  }
</style>
