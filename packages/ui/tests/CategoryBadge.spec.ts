import { test, expect } from "@playwright/experimental-ct-svelte";
import CategoryBadge from "../src/CategoryBadge.svelte";

// DESIGN.md `category-badge`: pink/mint fill, 2px stroke border, radius-sm (6px),
// 4x8 padding, label-uppercase type — 12px / weight 800 / 1px tracking / ALL-CAPS.
// This is the only component permitted to render uppercase text.

test("pink badge = bubblegum-pink fill, 2px stroke border, radius-sm", async ({ mount }) => {
  const c = await mount(CategoryBadge, { props: { tone: "pink" }, slots: { default: "Animation" } });
  await expect(c).toHaveCSS("background-color", "rgb(251, 207, 232)"); // #FBCFE8
  await expect(c).toHaveCSS("border-top-width", "2px");
  await expect(c).toHaveCSS("border-top-color", "rgb(28, 25, 23)"); // #1C1917 stroke
  await expect(c).toHaveCSS("border-top-left-radius", "6px"); // radius-sm
});

test("label is uppercase 12px / weight 800 / 1px tracking", async ({ mount }) => {
  const c = await mount(CategoryBadge, { props: { tone: "pink" }, slots: { default: "Animation" } });
  await expect(c).toHaveCSS("text-transform", "uppercase");
  await expect(c).toHaveCSS("font-size", "12px");
  await expect(c).toHaveCSS("font-weight", "800");
  await expect(c).toHaveCSS("letter-spacing", "1px");
});

test("mint tone fills mint-green", async ({ mount }) => {
  const c = await mount(CategoryBadge, { props: { tone: "mint" }, slots: { default: "Jobs" } });
  await expect(c).toHaveCSS("background-color", "rgb(16, 185, 129)"); // #10B981
});

test("badge has no shadow (non-interactive micro-pill, flat against surface)", async ({ mount }) => {
  const c = await mount(CategoryBadge, { props: { tone: "pink" }, slots: { default: "Animation" } });
  await expect(c).toHaveCSS("box-shadow", "none");
});
