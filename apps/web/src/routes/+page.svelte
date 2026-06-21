<script lang="ts">
  import { goto } from "$app/navigation";
  import { api } from "$lib/client/orpc";
  import { Button } from "@scope/ui";

  // ponytail: static cuisine list — fetch from API later if ever needed
  const CUISINES = [
    "Pizza",
    "Sushi",
    "Burgers",
    "Thai",
    "Indian",
    "Mexican",
    "Vegan",
    "Cafe",
  ] as const;

  // Form state (Svelte 5 runes)
  let lat = $state<number | null>(null);
  let lng = $state<number | null>(null);
  let manualLat = $state("");
  let manualLng = $state("");
  let geoError = $state(false);
  let selected = $state<Set<string>>(new Set());
  let loading = $state(false);
  let error = $state<string | null>(null);
  let joinCode = $state<string | null>(null);

  // Attempt geolocation on mount; show manual fallback on failure
  $effect(() => {
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        },
        () => {
          geoError = true;
        },
        { timeout: 5000 },
      );
    } else {
      geoError = true;
    }
  });

  function toggleCuisine(name: string) {
    const next = new Set(selected);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    selected = next;
  }

  // Resolved coords: prefer geolocation, fall back to manual inputs
  function resolvedCoords(): { lat: number; lng: number } | null {
    if (lat !== null && lng !== null) return { lat, lng };
    const pLat = parseFloat(manualLat);
    const pLng = parseFloat(manualLng);
    if (!isNaN(pLat) && !isNaN(pLng)) return { lat: pLat, lng: pLng };
    return null;
  }

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    error = null;

    const coords = resolvedCoords();
    if (!coords) {
      error = "Please enter your location.";
      return;
    }
    if (selected.size === 0) {
      error = "Pick at least one cuisine.";
      return;
    }

    loading = true;
    try {
      const result = await api.session.create({
        lat: coords.lat,
        lng: coords.lng,
        cuisines: Array.from(selected),
        radiusM: 500,
      });
      joinCode = result.joinCode;
      // Show join code for 1.5 s so host can read it, then navigate.
      // ponytail: simple timeout — no need for a modal/drawer.
      await new Promise((r) => setTimeout(r, 1500));
      await goto(`/s/${result.sessionId}`);
    } catch (err) {
      error = err instanceof Error ? err.message : "Something went wrong.";
    } finally {
      loading = false;
    }
  }
</script>

<main class="page">
  <div class="card">
    <h1 class="heading">Where are we eating?</h1>
    <p class="subtext">Start a lunch session and share the code with your team.</p>

    <form onsubmit={handleSubmit}>
      <!-- Manual lat/lng fallback: always rendered but visually hidden until needed -->
      <fieldset class="location-fallback" class:visible={geoError || (lat === null && lng === null)}>
        <legend class="fallback-legend">Enter your location</legend>
        <div class="coord-row">
          <label class="coord-label" for="lat-input">Latitude</label>
          <input
            id="lat-input"
            class="coord-input"
            type="number"
            step="any"
            placeholder="-33.8688"
            bind:value={manualLat}
            aria-label="Latitude"
          />
        </div>
        <div class="coord-row">
          <label class="coord-label" for="lng-input">Longitude</label>
          <input
            id="lng-input"
            class="coord-input"
            type="number"
            step="any"
            placeholder="151.2093"
            bind:value={manualLng}
            aria-label="Longitude"
          />
        </div>
      </fieldset>

      {#if lat !== null && lng !== null}
        <p class="geo-ok">Location detected automatically.</p>
      {/if}

      <section class="cuisine-section">
        <p class="section-label">What are you in the mood for?</p>
        <div class="chips" role="group" aria-label="Cuisine selection">
          {#each CUISINES as name}
            <button
              type="button"
              class="chip"
              class:selected={selected.has(name)}
              onclick={() => toggleCuisine(name)}
              aria-pressed={selected.has(name)}
            >
              {name}
            </button>
          {/each}
        </div>
      </section>

      {#if error}
        <p class="error-msg" role="alert">{error}</p>
      {/if}

      {#if joinCode}
        <div class="join-code-banner" data-testid="join-code">
          <span class="join-code-label">Share this code</span>
          <span class="join-code-value">{joinCode}</span>
        </div>
      {/if}

      <div class="submit-row">
        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? "Starting…" : "Start lunch"}
        </Button>
      </div>
    </form>
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

  /* Location fallback: hidden by default, shown when geo unavailable */
  .location-fallback {
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    padding: 16px;
    margin-bottom: 16px;
    display: none;
  }

  .location-fallback.visible {
    display: block;
  }

  .fallback-legend {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 12px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-ink);
    padding: 0 4px;
  }

  .coord-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
  }

  .coord-label {
    font-family: var(--font-body);
    font-size: 14px;
    font-weight: 500;
    color: var(--color-ink);
    width: 68px;
    flex-shrink: 0;
  }

  .coord-input {
    flex: 1;
    background-color: var(--color-surface-card);
    color: var(--color-ink);
    border: 3px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    padding: 10px 12px;
    font-family: var(--font-body);
    font-size: 14px;
  }

  .coord-input:focus {
    outline: none;
    box-shadow: 3px 3px 0 var(--color-accent);
  }

  .geo-ok {
    font-family: var(--font-body);
    font-size: 13px;
    color: var(--color-accept);
    margin: 0 0 16px;
  }

  /* Cuisine section */
  .cuisine-section {
    margin-bottom: 24px;
  }

  .section-label {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 14px;
    letter-spacing: 0.5px;
    color: var(--color-ink);
    margin: 0 0 12px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  /* ponytail: cuisine chips are styled buttons (not CategoryBadge which is non-interactive).
     Selected = banana-yellow fill; unselected = white with stroke border. */
  .chip {
    display: inline-flex;
    align-items: center;
    padding: 6px 14px;
    border: 2px solid var(--color-stroke);
    border-radius: var(--radius-full);
    background-color: var(--color-surface-card);
    color: var(--color-ink);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 13px;
    cursor: pointer;
    transition:
      background-color 80ms ease-out,
      box-shadow 80ms ease-out,
      transform 80ms ease-out;
    box-shadow: 2px 2px 0 var(--color-stroke);
  }

  .chip:hover {
    transform: translate(1px, 1px);
    box-shadow: 1px 1px 0 var(--color-stroke);
  }

  .chip.selected {
    background-color: var(--color-primary);
    box-shadow: 2px 2px 0 var(--color-stroke);
  }

  .chip.selected:hover {
    transform: translate(1px, 1px);
    box-shadow: 1px 1px 0 var(--color-stroke);
  }

  /* Error */
  .error-msg {
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--color-reject);
    margin: 0 0 16px;
    padding: 10px 14px;
    border: 2px solid var(--color-reject);
    border-radius: var(--radius-lg);
  }

  /* Join code confirmation banner (shown after API returns, before nav completes) */
  .join-code-banner {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    margin-bottom: 16px;
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

  /* Submit */
  .submit-row {
    display: flex;
    justify-content: flex-end;
  }
</style>
