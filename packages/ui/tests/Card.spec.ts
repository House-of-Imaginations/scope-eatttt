import { test, expect } from "@playwright/experimental-ct-svelte";
import Card from "../src/Card.svelte";

// DESIGN.md `project-card`: white surface, 3px stroke border, radius-lg (16px),
// flat hard-edged block shadow (the --shadow-block 4px 4px 0 mechanic, never blurred).

test("white surface, 3px stroke border, radius-lg, flat non-blurred block shadow", async ({ mount }) => {
  const c = await mount(Card, { slots: { default: "Tacos" } });
  await expect(c).toHaveCSS("background-color", "rgb(255, 255, 255)"); // #FFFFFF surface-card
  await expect(c).toHaveCSS("border-top-width", "3px");
  await expect(c).toHaveCSS("border-top-color", "rgb(28, 25, 23)"); // #1C1917 stroke
  await expect(c).toHaveCSS("border-top-left-radius", "16px"); // radius-lg

  const shadow = await c.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).toContain("rgb(28, 25, 23)"); // stroke black
  expect(shadow).toContain("4px 4px 0px"); // hard-edged offset, zero blur
});
