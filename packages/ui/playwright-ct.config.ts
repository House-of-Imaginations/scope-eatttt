import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/experimental-ct-svelte";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// The chromium build CT 1.58.2 expects (1208) downloads broken in this
// sandbox (missing framework dylib). Fall back to any complete headless-shell
// already on disk so the visual contracts can actually run. Leave undefined if
// none is found — Playwright then uses its managed browser (e.g. in CI).
const SHELL_CANDIDATES = ["1228", "1223", "1208"].map((b) =>
  join(homedir(), "Library/Caches/ms-playwright", `chromium_headless_shell-${b}`, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"),
);
const executablePath = SHELL_CANDIDATES.find((p) => existsSync(p));

export default defineConfig({
  testDir: "./tests",
  snapshotDir: "./tests/__snapshots__",
  timeout: 10_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    trace: "on-first-retry",
    ctPort: 3100,
    ctViteConfig: {
      plugins: [svelte()],
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
});
