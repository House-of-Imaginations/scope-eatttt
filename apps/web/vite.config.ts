import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Env comes from the root .env, injected into process.env by the `with-env`
// script (dotenv-cli) before vite runs — single source for web + worker.
// Vitest scoping lives in vitest.config.ts.
export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  // Bundle workspace packages for SSR — they ship raw TS with extensionless
  // relative imports that Node's strict ESM resolver can't load when externalized.
  ssr: {
    noExternal: [/^@scope\//],
  },
});
