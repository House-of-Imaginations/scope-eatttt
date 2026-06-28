<script lang="ts">
import { goto } from "$app/navigation";
import { signOut } from "$lib/client/authClient";
import { auth, refreshUser } from "$lib/client/userStore.svelte";
import { Avatar } from "@scope/ui";

// Reads shared reactive auth state; login/signup/layout call refreshUser().
const user = $derived(auth.user);
const isReal = $derived(!!user && !user.isAnonymous);

async function logout() {
	await signOut();
	await refreshUser();
	await goto("/");
}
</script>

<header class="bar">
  <a class="brand" href="/">scope-eatttt</a>
  <nav class="nav">
    {#if isReal && user}
      <Avatar name={user.name} image={user.image ?? undefined} size={28} />
      <span class="name">{user.name}</span>
      <a class="link" href="/dashboard">Dashboard</a>
      <button class="logout" type="button" onclick={logout}>Log out</button>
    {:else}
      <a class="link" href="/login">Log in</a>
    {/if}
  </nav>
</header>

<style>
  /* Thin comic-style top bar: cream fill, stroke underline, banana accents. */
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 16px;
    background-color: var(--color-canvas);
    border-bottom: 3px solid var(--color-stroke);
  }

  .brand {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 18px;
    color: var(--color-ink);
    text-decoration: none;
  }

  .nav {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .name {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 14px;
    color: var(--color-ink);
  }

  .link {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 14px;
    color: var(--color-ink);
    text-decoration: none;
    border-bottom: 2px solid var(--color-banana-yellow);
  }

  .logout {
    cursor: pointer;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 14px;
    color: var(--color-ink);
    background-color: var(--color-banana-yellow);
    border: 2px solid var(--color-stroke);
    border-radius: var(--radius-full);
    padding: 4px 12px;
  }
</style>
