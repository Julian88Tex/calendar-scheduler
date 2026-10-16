// Friends mode (owner requests, October 16): ?friends=1 on the public links books the owner's event types through the
// same flow in a warm, personal voice and theme, light and dark; the old /friends link redirects there. Success means:
// the landing shows the personal note, favorites and friendly event names, a friend can pick a day and time, fill the
// details and book with friends=1 kept on every step, the confirmation is the friends one, the booking is real (the
// friend gets the usual email), the pages are never indexed, the Friends / Business toggle switches styles and only
// shows with the parameter, the plain public page is unchanged, Settings > Friends mode edits what friends see, and
// contrast passes axe in both modes.
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
    test(`${scheme}: a friend books a quick catch-up from the old /friends link`, async ({ page, axe, api }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/friends", { timeout: 60_000 });
      await expect(page).toHaveURL(/\/julianjoseph\?friends=1$/);
      const shell = page.locator("[data-public-shell]");
      await expect(shell).toHaveAttribute("data-tone", "friends");
      await expect(shell).toHaveAttribute("data-public-auto", "");
      await expect(shell).toHaveCSS("background-color", scheme === "dark" ? "rgb(20, 18, 17)" : "rgb(251, 243, 232)");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.getByTestId("tone-toggle")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: /Hey, friend!/ })).toBeVisible();
      await expect(page.getByTestId("friends-hello")).toContainText("Can't wait to see you,");
      await expect(page.getByTestId("friends-favorites")).toContainText("Favorite ways to hang");
      await expect(page.getByTestId("friends-favorites")).toContainText("Pizza");
      await expect(page.getByText("Always a yes")).toHaveCount(0);
      await expect(page.getByRole("link", { name: /Grab pizza \(or coffee\)/ })).toBeVisible();
      await axe(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${scheme}-1-landing.png`, fullPage: true });

      await page.getByRole("link", { name: /Quick video catch-up/ }).click();
      await expect(page).toHaveURL(/\/julianjoseph\/30min\?.*friends=1/);
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
      await expect(page).toHaveURL(/\/julianjoseph\/30min\/2030-10-07T19:00:00Z\?.*friends=1/);
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
      await expect(page).toHaveURL(/\/booking\/[0-9a-f-]{36}\?.*friends=1/, { timeout: 60_000 });
      await expect(page.getByRole("heading", { level: 1, name: "It's a date!" })).toBeVisible();
      await expect(page.getByTestId("friends-thanks")).toBeVisible();
      await expect(page.getByText("You and Julian are all set.")).toBeVisible();
      await expect(page.getByText(/Powered by/)).toHaveCount(0);
      await expect(page.getByTestId("confirmation")).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Quick video catch-up" })).toBeVisible();
      await expect(page.getByTestId("schedule-another")).toHaveAttribute("href", "/julianjoseph?friends=1");
      await axe(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${scheme}-5-confirmed.png`, fullPage: true });

      // A real booking: the friend gets the usual email, like any public booking.
      await expect.poll(async () => (await api.outbox({ to: email })).length, { timeout: 30_000 }).toBeGreaterThan(0);
    });
  }

  test("the public page keeps its classic look and wording, with no toggle", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/julianjoseph/30min", { timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Select a Date & Time" })).toBeVisible({ timeout: 60_000 });
    const shell = page.locator("[data-public-shell]");
    await expect(shell).not.toHaveAttribute("data-tone", "friends");
    await expect(shell).toHaveCSS("background-color", "rgb(250, 250, 250)");
    await expect(page.getByTestId("tone-toggle")).toHaveCount(0);
    await page.goto("/julianjoseph", { timeout: 60_000 });
    await expect(page.getByTestId("tone-toggle")).toHaveCount(0);
  });

  test("the toggle switches between the friends and business styles and keeps the picked day", async ({ page, axe }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/julianjoseph?friends=1", { timeout: 60_000 });
    const shell = page.locator("[data-public-shell]");
    const toggle = page.getByTestId("tone-toggle");
    await expect(toggle.getByRole("link", { name: "Friends" })).toHaveAttribute("aria-current", "page");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/toggle-1-friends.png` });
    await toggle.getByRole("link", { name: "Business" }).click();
    await expect(page).toHaveURL(/\/julianjoseph\?friends=0$/);
    await expect(shell).not.toHaveAttribute("data-tone", "friends");
    await expect(page.getByRole("heading", { level: 1, name: /Hey, friend!/ })).toHaveCount(0);
    await expect(toggle.getByRole("link", { name: "Business" })).toHaveAttribute("aria-current", "page");
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/toggle-2-business.png` });

    // The business landing keeps the parameter on its links, so the toggle follows the visitor.
    await page.getByRole("link", { name: /30 Minute Virtual/ }).click();
    await expect(page).toHaveURL(/\/julianjoseph\/30min\?.*friends=0/);
    await expect(page.getByRole("heading", { name: "Select a Date & Time" })).toBeVisible({ timeout: 60_000 });
    const day = page.getByRole("button", { name: OPEN_DAY });
    await expect(day).toBeEnabled({ timeout: 60_000 });
    await day.click();
    await expect(page).toHaveURL(/date=2030-10-07/);
    await toggle.getByRole("link", { name: "Friends" }).click();
    await expect(page).toHaveURL(/\/julianjoseph\/30min\?.*friends=1/);
    await expect(page).toHaveURL(/date=2030-10-07/);
    await expect(page.getByRole("heading", { name: "When works for you?" })).toBeVisible({ timeout: 60_000 });
    await expect(shell).toHaveAttribute("data-tone", "friends");
  });

  test("Settings > Friends mode changes what friends see", async ({ page, loginAs, axe }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await loginAs(page, "owner@example.com");
    await page.goto("/app/settings/friends", { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    const form = page.getByTestId("friends-settings");
    await expect(form).toBeVisible();
    await expect(page.getByText("/julianjoseph?friends=1")).toBeVisible();
    await page.getByLabel("Greeting").fill("Yo, pal!");
    await page.getByLabel("Favorite 1").fill("Tacos");
    await page.getByLabel("Friendly name for 30 Minute Virtual").fill("Coffee chat");
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/settings.png`, fullPage: true });
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved")).toBeVisible();

    await page.goto("/julianjoseph?friends=1", { timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1, name: /Yo, pal!/ })).toBeVisible();
    await expect(page.getByTestId("friends-favorites")).toContainText("Tacos");
    await expect(page.getByRole("link", { name: /Coffee chat/ })).toBeVisible();

    await page.goto("/app/settings/friends", { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Reset to defaults" }).click();
    await expect(page.getByLabel("Greeting")).toHaveValue("Hey, friend!");
  });

  test("unknown event slugs are 404 in friends mode and on the old link", async ({ page }) => {
    expect((await page.goto("/julianjoseph/not-a-real-event?friends=1", { timeout: 60_000 }))?.status()).toBe(404);
    expect((await page.goto("/friends/not-a-real-event", { timeout: 60_000 }))?.status()).toBe(404);
  });
});
