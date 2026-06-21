<script lang="ts">
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { api } from "$lib/client/orpc";
  import { Button } from "@scope/ui";

  // ponytail: route param read via $app/state (SvelteKit 2 / Svelte 5 runes)
  const code = $derived(page.params.code ?? "");

  let displayName = $state("");
  let loading = $state(false);
  let error = $state<string | null>(null);

  // Disable submit when name is blank or request in flight
  const canSubmit = $derived(displayName.trim().length > 0 && !loading);

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    error = null;
    loading = true;
    try {
      const result = await api.session.join({
        joinCode: code,
        displayName: displayName.trim(),
      });
      await goto(`/s/${result.sessionId}`);
    } catch (err) {
      error =
        err instanceof Error
          ? err.message
          : "Couldn't join — check the code and try again.";
    } finally {
      loading = false;
    }
  }
</script>

<main class="page">
  <div class="card">
    <h1 class="heading">You're invited to lunch</h1>
    <p class="subtext">
      Joining <span class="code-badge">{code}</span>
    </p>

    <form onsubmit={handleSubmit}>
      <label class="field-label" for="display-name">Your name</label>
      <input
        id="display-name"
        class="text-input"
        type="text"
        placeholder="e.g. Alice"
        aria-label="Display name"
        bind:value={displayName}
        autocomplete="off"
        maxlength={40}
      />

      {#if error}
        <p class="error-msg" role="alert">{error}</p>
      {/if}

      <div class="submit-row">
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {loading ? "Joining…" : "Join lunch"}
        </Button>
      </div>
    </form>
  </div>
</main>

<style>
  /* DESIGN.md: cream canvas, comic card, banana-yellow primary button */
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
    max-width: 420px;
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

  /* ponytail: inline code badge, no extra component */
  .code-badge {
    display: inline-block;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 15px;
    letter-spacing: 2px;
    color: var(--color-ink);
    background-color: var(--color-primary);
    border: 2px solid var(--color-stroke);
    border-radius: var(--radius-sm);
    padding: 1px 8px;
  }

  .field-label {
    display: block;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 13px;
    letter-spacing: 0.5px;
    color: var(--color-ink);
    margin-bottom: 8px;
  }

  /* DESIGN.md: comic-text-input — 3px stroke border, focus = electric-blue block shadow */
  .text-input {
    display: block;
    width: 100%;
    box-sizing: border-box;
    background-color: var(--color-surface-card);
    color: var(--color-ink);
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    padding: 14px 16px;
    font-family: var(--font-body);
    font-size: 16px;
    margin-bottom: 20px;
  }

  .text-input:focus {
    outline: none;
    box-shadow: 3px 3px 0 var(--color-accent);
  }

  /* ponytail: inline error text, no toast lib */
  .error-msg {
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--color-reject);
    margin: 0 0 16px;
    padding: 10px 14px;
    border: 2px solid var(--color-reject);
    border-radius: var(--radius-lg);
  }

  .submit-row {
    display: flex;
    justify-content: flex-end;
  }
</style>
