<script>
  import { onMount } from "svelte";
  import "../styles/global.css";
  import { configureFrontendLogging, getAppLogger } from "@scope/logging/browser";
  import { ensureAnonSession } from "$lib/client/auth";

  let { children } = $props();

  // Belt-and-suspenders: kick off the anon session bootstrap eagerly on every
  // page mount. The primary race guard is the authFetch wrapper in orpc.ts
  // (which awaits ensureAnonSession() before every RPC call), so this onMount
  // no longer needs to complete before page RPCs fire. Kept here so navigation
  // to a non-RPC page (e.g. /join) still warms the cookie early.
  onMount(() => {
    configureFrontendLogging({ enabled: import.meta.env.MODE !== "production" });
    ensureAnonSession().catch((err) => {
      getAppLogger(["layout"]).error("ensureAnonSession failed", { error: err });
    });
  });
</script>

<div class="layout-shell">
  {@render children()}
</div>

<style>
  .layout-shell {
    width: 100%;
    max-width: 1280px;
    margin-inline: auto;
    padding-inline: 1rem;
  }
</style>
