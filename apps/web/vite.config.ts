import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Server code (auth, relay, container) reads config via process.env in
  // packages/config. Vite only exposes .env to import.meta.env by default, so
  // load every var (prefix "") from apps/web/.env into process.env for SSR/dev.
  const env = loadEnv(mode, process.cwd(), "");
  for (const [key, value] of Object.entries(env)) {
    process.env[key] ??= value;
  }

  return {
    plugins: [tailwindcss(), sveltekit()],
  };
});
