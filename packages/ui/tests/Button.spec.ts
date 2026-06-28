import { expect, test } from "@playwright/experimental-ct-svelte";
import Button from "../src/Button.svelte";

// DESIGN.md `pill-button-primary`: bg banana-yellow, ink text, 3px stroke
// border, radius-full, height 48px, weight 800, flat (non-blurred) block shadow,
// press translate on :active. All variants share the silhouette; only fill
// (and reject's label) changes per variant.

test("primary uses banana-yellow fill + ink text + 3px stroke border", async ({
	mount,
}) => {
	const c = await mount(Button, {
		props: { variant: "primary" },
		slots: { default: "Go" },
	});
	await expect(c).toHaveCSS("background-color", "rgb(250, 204, 21)"); // #FACC15
	await expect(c).toHaveCSS("color", "rgb(28, 25, 23)"); // #1C1917
	await expect(c).toHaveCSS("border-top-width", "3px");
	await expect(c).toHaveCSS("border-top-color", "rgb(28, 25, 23)"); // #1C1917 stroke
});

test("primary is a full pill at 48px touch height with weight-800 label", async ({
	mount,
}) => {
	const c = await mount(Button, {
		props: { variant: "primary" },
		slots: { default: "Go" },
	});
	await expect(c).toHaveCSS("border-top-left-radius", "9999px"); // radius-full
	await expect(c).toHaveCSS("height", "48px");
	await expect(c).toHaveCSS("font-weight", "800");
});

test("primary has a flat (non-blurred) hard-edged block shadow in stroke black", async ({
	mount,
}) => {
	const c = await mount(Button, {
		props: { variant: "primary" },
		slots: { default: "Go" },
	});
	const shadow = await c.evaluate((el) => getComputedStyle(el).boxShadow);
	expect(shadow).toContain("rgb(28, 25, 23)"); // stroke black #1C1917
	// hard-edged offset "Xpx Ypx 0px" — the blur radius (3rd length) is 0; a blurred
	// shadow would report a non-zero blur length. Computed form: "rgb(...) 4px 4px 0px".
	expect(shadow).toMatch(/\b0px\b/);
	expect(shadow).not.toMatch(/[1-9]\d*px\s+(rgb|#)/); // no positive blur before color
});

test("accept variant fills mint-green", async ({ mount }) => {
	const c = await mount(Button, {
		props: { variant: "accept" },
		slots: { default: "Yes" },
	});
	await expect(c).toHaveCSS("background-color", "rgb(16, 185, 129)"); // #10B981
});

test("reject variant fills comic-red", async ({ mount }) => {
	const c = await mount(Button, {
		props: { variant: "reject" },
		slots: { default: "No" },
	});
	await expect(c).toHaveCSS("background-color", "rgb(239, 68, 68)"); // #EF4444
});

test("secondary variant is white-filled with 3px stroke border (same silhouette)", async ({
	mount,
}) => {
	const c = await mount(Button, {
		props: { variant: "secondary" },
		slots: { default: "More" },
	});
	await expect(c).toHaveCSS("background-color", "rgb(255, 255, 255)"); // #FFFFFF surface-card
	await expect(c).toHaveCSS("border-top-width", "3px");
	await expect(c).toHaveCSS("border-top-left-radius", "9999px");
});

test("disabled button is non-interactive (disabled attribute set)", async ({
	mount,
}) => {
	const c = await mount(Button, {
		props: { variant: "primary", disabled: true },
		slots: { default: "Go" },
	});
	await expect(c).toBeDisabled();
});

test("invokes the onclick prop when pressed", async ({ mount }) => {
	let clicks = 0;
	const c = await mount(Button, {
		props: { variant: "primary", onclick: () => (clicks += 1) },
		slots: { default: "Go" },
	});
	await c.click();
	expect(clicks).toBe(1);
});

test("disabled button does not invoke onclick", async ({ mount }) => {
	let clicks = 0;
	const c = await mount(Button, {
		props: { variant: "primary", disabled: true, onclick: () => (clicks += 1) },
		slots: { default: "Go" },
	});
	await c.click({ force: true });
	expect(clicks).toBe(0);
});
