import { expect, test, type Page } from "@playwright/test";

const NAV_TIMEOUT = 8_000;

async function createSession(page: Page): Promise<string> {
  await page.goto("/");
  await expect(page.getByText(/location detected/i)).toBeVisible({ timeout: NAV_TIMEOUT });
  await page.getByRole("button", { name: /pizza/i }).click();
  await page.getByRole("button", { name: /start lunch/i }).click();
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: NAV_TIMEOUT });
  const code = await page.getByTestId("lobby-join-code").textContent();
  if (!code?.trim()) throw new Error("join code missing");
  return code.trim();
}

async function joinSession(page: Page, code: string, name: string): Promise<void> {
  await page.goto(`/join/${code}`);
  await page.getByRole("textbox", { name: /display name/i }).fill(name);
  await page.getByRole("button", { name: /join lunch/i }).click();
  await expect(page).toHaveURL(/\/s\/[0-9a-f-]+/, { timeout: NAV_TIMEOUT });
}

test.describe("mock realtime workflow", () => {
  test("shares mock state across tabs, survives reload, and completes the poll", async ({ browser }) => {
    const context = await browser.newContext({
      geolocation: { latitude: -33.8688, longitude: 151.2093 },
      permissions: ["geolocation"],
    });
    const host = await context.newPage();
    const simon = await context.newPage();
    const alice = await context.newPage();

    const code = await createSession(host);

    await expect(host.getByTestId("invite-link")).toHaveValue(new RegExp(`/join/${code}$`));
    await expect(host.getByTestId("copy-invite")).toBeVisible();

    await joinSession(simon, code, "Simon");
    await joinSession(alice, code, "Alice");

    await expect(host.getByText("Simon")).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(host.getByText("Alice")).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(simon.getByText("Alice")).toBeVisible({ timeout: NAV_TIMEOUT });

    await simon.reload();
    await expect(simon.getByRole("heading", { name: /lobby/i })).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(simon.getByText("Simon")).toBeVisible();
    await expect(simon.getByText("Alice")).toBeVisible();

    await host.getByRole("button", { name: /start swiping/i }).click();
    await expect(host.getByRole("button", { name: /^accept$/i })).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(simon.getByRole("button", { name: /^accept$/i })).toBeVisible({ timeout: NAV_TIMEOUT });

    const firstCard = (await host.getByTestId("swipe-card-name").textContent())?.trim();
    expect(firstCard).toBeTruthy();
    await expect(simon.getByTestId("swipe-card-name")).toHaveText(firstCard!);

    await host.getByRole("button", { name: /^accept$/i }).click();
    await simon.getByRole("button", { name: /^accept$/i }).click();
    await expect(simon.getByTestId("promote-toast")).toBeVisible({ timeout: NAV_TIMEOUT });

    await host.getByRole("button", { name: /open poll/i }).click();
    await expect(host.getByRole("heading", { name: /vote/i })).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(host.getByText(firstCard!)).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(simon.getByText(firstCard!)).toBeVisible({ timeout: NAV_TIMEOUT });

    await host.getByTestId("vote-up").click({ force: true });
    await simon.getByTestId("vote-up").click({ force: true });
    await host.getByRole("button", { name: /end poll/i }).click();

    await expect(host.getByRole("heading", { name: /we have a winner/i })).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(simon.getByRole("heading", { name: /we have a winner/i })).toBeVisible({ timeout: NAV_TIMEOUT });
    await expect(host.locator(".winner-name")).toHaveText(firstCard!);

    await context.close();
  });
});
