import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests",
	testMatch: "**/*.spec.ts",
	// real-stack specs (docker + worker) run only under playwright.real.config.ts
	testIgnore: ["**/e2e-real.spec.ts", "**/e2e-accounts.spec.ts"],
	fullyParallel: false,
	retries: 0,
	use: {
		baseURL: "http://localhost:5173",
		trace: "on-first-retry",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		command: "pnpm dev",
		url: "http://localhost:5173",
		reuseExistingServer: true,
		timeout: 60_000,
		env: {
			PUBLIC_USE_MOCK: "1",
			// auth-pages.spec.ts asserts the Google button renders; gate it on.
			PUBLIC_GOOGLE_ENABLED: "1",
		},
	},
});
