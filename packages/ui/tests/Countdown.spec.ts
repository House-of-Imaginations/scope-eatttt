import { expect, test } from "@playwright/experimental-ct-svelte";
import Countdown from "../src/Countdown.svelte";

// Renders mm:ss for the time left until `deadline`, ticks down, stops at 00:00.

test("renders mm:ss for the remaining time", async ({ mount }) => {
	const deadline = new Date(Date.now() + 90_000); // ~1m30s out
	const c = await mount(Countdown, { props: { deadline } });
	// ceil → "01:30" (allow 01:29 if the second rolled during mount).
	await expect(c).toHaveText(/^01:(30|29)$/);
});

test("an already-passed deadline is clamped to 00:00", async ({ mount }) => {
	const c = await mount(Countdown, {
		props: { deadline: new Date(Date.now() - 5_000) },
	});
	await expect(c).toHaveText("00:00");
});

test("ticks down over time", async ({ mount }) => {
	const c = await mount(Countdown, {
		props: { deadline: new Date(Date.now() + 5_000) },
	});
	await expect(c).toHaveText(/^00:0[45]$/);
	// after ~2s the readout must have decreased.
	await expect(c).toHaveText(/^00:0[0-3]$/, { timeout: 3_000 });
});
