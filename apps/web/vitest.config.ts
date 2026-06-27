import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

// Vitest = unit/server tests. Playwright E2E uses *.spec.ts and stays out.
// sveltekit() plugin is needed so $env/static/public resolves in unit tests.
export default defineConfig({
  plugins: [sveltekit()],
  test: {
    include: ["src/**/*.{test,spec}.ts", "tests/**/*.test.ts"],
    exclude: ["tests/**/*.spec.ts", "node_modules/**"],
  },
});
