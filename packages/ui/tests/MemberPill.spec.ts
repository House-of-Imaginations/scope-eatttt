import { test, expect } from "@playwright/experimental-ct-svelte";
import MemberPill from "../src/MemberPill.svelte";

// Member chip: pink fill + 2px stroke border + radius-full pill; host gets the
// banana-yellow fill and a star marker. Display name stays sentence case.

test("default member = pink fill, 2px stroke border, radius-full", async ({ mount }) => {
  const c = await mount(MemberPill, { props: { name: "Sam" } });
  await expect(c).toContainText("Sam");
  await expect(c).toHaveCSS("background-color", "rgb(251, 207, 232)"); // #FBCFE8
  await expect(c).toHaveCSS("border-top-width", "2px");
  await expect(c).toHaveCSS("border-top-left-radius", "9999px"); // radius-full
});

test("host member fills banana-yellow and shows a marker", async ({ mount }) => {
  const c = await mount(MemberPill, { props: { name: "Alex", host: true } });
  await expect(c).toHaveCSS("background-color", "rgb(250, 204, 21)"); // #FACC15
  await expect(c.getByLabel("host")).toBeVisible();
});
