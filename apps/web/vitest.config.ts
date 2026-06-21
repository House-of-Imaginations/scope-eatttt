import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

// Vitest = unit tests only. Playwright E2E lives in tests/ — keep it out.
// sveltekit() plugin is needed so $env/static/public resolves in unit tests.
export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["tests/**", "node_modules/**"],
  },
});
