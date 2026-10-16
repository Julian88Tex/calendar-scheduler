// The friends link (owner request, October 16): /friends books the owner's event types through the same flow as the
// public page, in a warm, personal voice and theme, light and dark by the device setting. Success means: the
// landing shows the personal note and friendly event names, a friend can pick a day and time, fill the details and
// book, the confirmation is the friends one, the booking is real (the friend gets the usual email), the pages are
// never indexed, the public page is unchanged, and contrast passes axe in both modes.
// FRIENDS_SHOTS=<dir> saves screenshots of every step.
import { expect, test } from "../fixtures";

const NOW = "2030-10-07T13:00:00Z";
const OPEN_DAY = "Monday, October 7 - Times available";
const SHOTS = process.env.FRIENDS_SHOTS;

test.describe("friends link", () => {
  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await api.setTime(NOW);
    await seed("owner");
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test.setTimeout(150_000);

  for (const scheme of ["light", "dark"] as const) {
    test(`${scheme}: a friend books a quick catch-up from /friends`, async ({ page, axe, api }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/friends", { timeout: 60_000 });
      const shell = page.locator("[data-public-shell]");
      await expect(shell).toHaveAttribute("data-tone", "friends");
      await expect(shell).toHaveAttribute("data-public-auto", "");
      await expect(shell).toHaveCSS("background-color", scheme === "dark" ? "rgb(26, 20, 17)" : "rgb(251, 243, 232)");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.getByRole("heading", { level: 1, name: /Hey, friend!/ })).toBeVisible();
      await expect(page.getByTestId("friends-hello")).toContainText("Can't wait to see you,");
      await axe(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${scheme}-1-landing.png`, fullPage: true });

      await page.getByRole("link", { name: /Quick video catch-up/ }).click();
      await expect(page).toHaveURL(/\/friends\/30min/);
      await expect(page.getByRole("heading", { name: "When works for you?" })).toBeVisible({ timeout: 60_000 });
      const day = page.getByRole("button", { name: OPEN_DAY });
      await expect(day).toBeEnabled({ timeout: 60_000 });
      await axe(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${scheme}-2-calendar.png` });

      await day.click();
      await page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: "3:00pm" }).click();
      await axe(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${scheme}-3-times.png` });

      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page).toHaveURL(/\/friends\/30min\/2030-10-07T19:00:00Z/);
      await expect(page.getByRole("heading", { name: "Almost there!" })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("friends-details-intro")).toBeVisible();
      const name = `Friend ${scheme}`;
      const email = `friend-${scheme}@example.com`;
      await page.getByLabel("Name").fill(name);
      await page.getByLabel("Email").fill(email);
      await page.getByLabel(/What's new with you\?/).fill("Just want to catch up!");
      await axe(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${scheme}-4-details.png`, fullPage: true });

      await page.getByRole("button", { name: "Lock it in" }).click();
      await expect(page).toHaveURL(/\/friends\/booked\/[0-9a-f-]{36}/, { timeout: 60_000 });
      await expect(page.getByRole("heading", { level: 1, name: "It's a date!" })).toBeVisible();
      await expect(page.getByTestId("friends-thanks")).toBeVisible();
      await expect(page.getByText("You and Julian are all set.")).toBeVisible();
      await expect(page.getByText(/Powered by/)).toHaveCount(0);
      await expect(page.getByTestId("confirmation")).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Quick video catch-up" })).toBeVisible();
      await expect(page.getByTestId("schedule-another")).toHaveAttribute("href", "/friends");
      await axe(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${scheme}-5-confirmed.png`, fullPage: true });

      // A real booking: the friend gets the usual email, like any public booking.
      await expect.poll(async () => (await api.outbox({ to: email })).length, { timeout: 30_000 }).toBeGreaterThan(0);
    });
  }

  test("the public page keeps its classic look and wording", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/julianjoseph/30min", { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Select a Date & Time" })).toBeVisible({ timeout: 60_000 });
    const shell = page.locator("[data-public-shell]");
    await expect(shell).not.toHaveAttribute("data-tone", "friends");
    await expect(shell).toHaveCSS("background-color", "rgb(250, 250, 250)");
  });

  test("unknown friends event slugs are 404", async ({ page }) => {
    const res = await page.goto("/friends/not-a-real-event", { timeout: 60_000 });
    expect(res?.status()).toBe(404);
  });
});
