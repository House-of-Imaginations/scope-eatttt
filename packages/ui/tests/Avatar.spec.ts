import { test, expect } from "@playwright/experimental-ct-svelte";
import Avatar from "../src/Avatar.svelte";

test("with image renders img with correct src and 3px border", async ({ mount }) => {
  const c = await mount(Avatar, { props: { name: "Alice", image: "https://example.com/alice.jpg" } });
  const img = c.locator("img");
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute("src", "https://example.com/alice.jpg");
  await expect(img).toHaveCSS("border-top-width", "3px");
});

test("without image renders initials text", async ({ mount }) => {
  const c = await mount(Avatar, { props: { name: "Alice Wong" } });
  await expect(c).toContainText("AW");
});

test("without image has no img element", async ({ mount }) => {
  const c = await mount(Avatar, { props: { name: "Bob" } });
  await expect(c.locator("img")).toHaveCount(0);
});
