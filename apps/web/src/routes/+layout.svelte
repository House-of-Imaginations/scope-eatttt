<script>
  import "../styles/global.css";

  let { children } = $props();
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
