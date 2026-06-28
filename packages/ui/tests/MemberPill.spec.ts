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

test("with image renders the avatar photo next to the name", async ({ mount }) => {
  const c = await mount(MemberPill, {
    props: { name: "Mia", image: "https://example.com/mia.jpg" },
  });
  const img = c.locator("img");
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute("src", "https://example.com/mia.jpg");
  await expect(c).toContainText("Mia");
});

test("without image renders initials, no img", async ({ mount }) => {
  const c = await mount(MemberPill, { props: { name: "Mia" } });
  await expect(c.locator("img")).toHaveCount(0);
  await expect(c).toContainText("M"); // initials avatar
});
