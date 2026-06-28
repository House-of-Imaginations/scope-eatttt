<script lang="ts">
import { goto } from "$app/navigation";
import { page } from "$app/state";
import { PUBLIC_GOOGLE_ENABLED } from "$env/static/public";
import { signInEmail, signInGoogle } from "$lib/client/authClient";
import { parsePublicEnv } from "@scope/config";
import { Button } from "@scope/ui";

const googleEnabled = parsePublicEnv({ PUBLIC_GOOGLE_ENABLED }).googleEnabled;

// ponytail: query read via $app/state, same idiom as the join screen.
const redirect = $derived(
	page.url.searchParams.get("redirect") ?? "/dashboard",
);
const signupHref = $derived(`/signup?redirect=${encodeURIComponent(redirect)}`);

const email = $state("");
const password = $state("");
let loading = $state(false);
let error = $state<string | null>(null);

const canSubmit = $derived(
	email.trim().length > 0 && password.length > 0 && !loading,
);

async function handleSubmit(e: SubmitEvent) {
	e.preventDefault();
	if (!canSubmit) return;
	error = null;
	loading = true;
	const r = await signInEmail({ email: email.trim(), password });
	loading = false;
	if (r.ok) {
		await goto(redirect);
		return;
	}
	error = r.retryAfter
		? `Too many attempts, try again in ${r.retryAfter}s`
		: r.error;
}
</script>

<main class="page">
  <div class="card">
    <h1 class="heading">Welcome back</h1>
    <p class="subtext">Sign in to get back to lunch.</p>

    <form onsubmit={handleSubmit}>
      <label class="field-label" for="email">Email</label>
      <input
        id="email"
        class="text-input"
        type="email"
        placeholder="you@example.com"
        aria-label="Email"
        bind:value={email}
        autocomplete="email"
      />

      <label class="field-label" for="password">Password</label>
      <input
        id="password"
        class="text-input"
        type="password"
        placeholder="••••••••"
        aria-label="Password"
        bind:value={password}
        autocomplete="current-password"
      />

      {#if error}
        <p class="error-msg" role="alert">{error}</p>
      {/if}

      <div class="submit-row">
        <Button type="submit" variant="primary" fullWidth disabled={!canSubmit}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </div>
    </form>

    {#if googleEnabled}
      <button class="google-btn" type="button" onclick={() => signInGoogle(redirect)}>
        <svg class="google-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <path fill="currentColor" d="M44.5 20H24v8.5h11.8C34.7 33.9 30 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.3 0 6.3 1.2 8.6 3.3l6-6C42.8 5.1 33.6 1 24 1 11.3 1 1 11.3 1 24s10.3 23 23 23c11.5 0 22-8.3 22-23 0-1.4-.2-2.7-.5-4z" />
        </svg>
        Sign in with Google
      </button>
    {/if}

    <p class="alt-link">
      New here? <a href={signupHref}>Sign up</a>
    </p>
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
    box-shadow: 6px 6px 0 var(--color-stroke);
    padding: 28px 24px;
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

  .field-label {
    display: block;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 13px;
    color: var(--color-ink);
    margin: 0 0 6px;
  }

  .text-input {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-body);
    font-size: 16px;
    color: var(--color-ink);
    background-color: var(--color-canvas);
    border: 2px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    padding: 12px 14px;
    margin: 0 0 16px;
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
    margin-top: 8px;
  }

  /* ponytail: single-color G themed to --color-ink to match the comic mono-stroke look, not the multicolor brand mark */
  .google-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    margin-top: 16px;
    height: 48px;
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-full);
    background-color: var(--color-surface-card);
    color: var(--color-ink);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 16px;
    letter-spacing: 0.5px;
    cursor: pointer;
    box-shadow: 3px 3px 0 var(--color-stroke);
  }

  .google-icon {
    width: 20px;
    height: 20px;
  }

  .alt-link {
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--color-ink-muted);
    text-align: center;
    margin: 20px 0 0;
  }

  .alt-link a {
    color: var(--color-ink);
    font-weight: 700;
  }
</style>
