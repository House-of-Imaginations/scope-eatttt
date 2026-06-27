import { test, expect } from "@playwright/experimental-ct-svelte";
import SwipeCard from "../src/SwipeCard.svelte";
import type { Restaurant } from "@scope/contract";

// DESIGN.md comic card: white surface, 3px stroke border, radius-lg, flat block
// shadow. SwipeCard presents one restaurant and emits onswipe("accept"|"reject")
// from the accept/reject buttons (mint/red, the Button accept/reject variants).

const RESTAURANT: Restaurant = {
  id: "r1",
  name: "Sakura Ramen",
  address: "1 Main St",
  cuisineTags: ["japanese", "ramen"],
  rating: 4.3,
  priceLevel: 2,
};

test("renders the restaurant name", async ({ mount }) => {
  const c = await mount(SwipeCard, { props: { restaurant: RESTAURANT } });
  await expect(c).toContainText("Sakura Ramen");
});

test("renders cuisine tags as chips", async ({ mount }) => {
  const c = await mount(SwipeCard, { props: { restaurant: RESTAURANT } });
  await expect(c).toContainText("japanese");
  await expect(c).toContainText("ramen");
});

test("renders rating and price level (star + dollar signs)", async ({ mount }) => {
  const c = await mount(SwipeCard, { props: { restaurant: RESTAURANT } });
  await expect(c).toContainText("4.3");
  await expect(c).toContainText("$$");
});

test("clicking accept emits onswipe('accept')", async ({ mount }) => {
  const swipes: string[] = [];
  const c = await mount(SwipeCard, {
    props: { restaurant: RESTAURANT, onswipe: (d: string) => swipes.push(d) },
  });
  await c.getByRole("button", { name: /accept/i }).click();
  expect(swipes).toEqual(["accept"]);
});

test("clicking reject emits onswipe('reject')", async ({ mount }) => {
  const swipes: string[] = [];
  const c = await mount(SwipeCard, {
    props: { restaurant: RESTAURANT, onswipe: (d: string) => swipes.push(d) },
  });
  await c.getByRole("button", { name: /reject/i }).click();
  expect(swipes).toEqual(["reject"]);
});

test("accept button fills mint-green, reject fills comic-red", async ({ mount }) => {
  const c = await mount(SwipeCard, { props: { restaurant: RESTAURANT } });
  await expect(c.getByRole("button", { name: /accept/i })).toHaveCSS(
    "background-color",
    "rgb(16, 185, 129)", // --color-accept #10B981
  );
  await expect(c.getByRole("button", { name: /reject/i })).toHaveCSS(
    "background-color",
    "rgb(239, 68, 68)", // --color-reject #EF4444
  );
});

test("ArrowRight emits accept, ArrowLeft emits reject (keyboard a11y)", async ({ mount }) => {
  const swipes: string[] = [];
  const c = await mount(SwipeCard, {
    props: { restaurant: RESTAURANT, onswipe: (d: string) => swipes.push(d) },
  });
  // The mounted root is the focusable swipe control (role=group, tabindex=0).
  await expect(c).toHaveRole("group");
  await c.press("ArrowRight");
  await c.press("ArrowLeft");
  expect(swipes).toEqual(["accept", "reject"]);
});
