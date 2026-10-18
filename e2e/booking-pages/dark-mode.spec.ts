// Public pages follow the visitor's device setting (owner request, October 15): in dark mode they render their own
// dark theme and ask the Dark Reader extension to leave it alone (<meta name="darkreader-lock">), so extensions do
// not have to guess. Light mode is unchanged. Contrast is checked with axe in both modes.
import { expect, test } from "../fixtures";

const NOW = "2030-10-07T13:00:00Z";
const OPEN_DAY = "Monday, October 7 - Times available";
const SHOTS = process.env.DARK_MODE_SHOTS;

test.describe("public pages dark mode", () => {
  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await api.setTime(NOW);
    await seed("owner");
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test.setTimeout(120_000);

  test("dark device setting: dark canvas and card, Dark Reader locked, readable calendar and form", async ({ page, axe }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/julianjoseph", { timeout: 60_000 });
    const shell = page.locator("[data-public-shell]");
    await expect(shell).toHaveAttribute("data-public-auto", "");
    await expect(shell).toHaveCSS("background-color", "rgb(14, 18, 23)");
    // Same brand blue as light mode (owner request, October 18): the purple-leaning #2563eb read off on the dark card.
    expect(await shell.evaluate((el) => getComputedStyle(el).getPropertyValue("--primary").trim())).toBe("#006bff");
    await expect(page.locator('meta[name="darkreader-lock"]')).toHaveCount(1);
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dark-1-landing.png` });

    await page.getByRole("link", { name: "30 Minute Virtual" }).click();
    const day = page.getByRole("button", { name: OPEN_DAY });
    await expect(day).toBeEnabled({ timeout: 60_000 });
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dark-2-calendar.png` });

    await day.click();
    await page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: "3:00pm" }).click();
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dark-3-times.png` });

    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Enter Details" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Schedule Event" }).click();
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dark-4-details.png`, fullPage: true });

    await page.getByLabel("Name").fill("Dark Mode Tester");
    await page.getByLabel("Email").fill("dark@example.com");
    await page.getByLabel("What would you like to discuss?").fill("Dark mode");
    await page.getByRole("button", { name: "Schedule Event" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "You are scheduled" })).toBeVisible({ timeout: 60_000 });
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/dark-5-confirmed.png`, fullPage: true });
  });

  test("light device setting: the classic light page, no Dark Reader lock", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/julianjoseph/30min", { timeout: 60_000 });
    await expect(page.getByRole("button", { name: OPEN_DAY })).toBeEnabled({ timeout: 60_000 });
    await expect(page.locator("[data-public-shell]")).toHaveCSS("background-color", "rgb(250, 250, 250)");
    await expect(page.locator('meta[name="darkreader-lock"]')).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/light-2-calendar.png` });

    // Switching the device to dark mode while the page is open switches the page and adds the lock.
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("[data-public-shell]")).toHaveCSS("background-color", "rgb(14, 18, 23)");
    await expect(page.locator('meta[name="darkreader-lock"]')).toHaveCount(1);
  });

  test("theme toggle: the visitor's choice overrides the device setting and is remembered", async ({ page, axe }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/julianjoseph", { timeout: 60_000 });
    const shell = page.locator("[data-public-shell]");
    await expect(shell).toHaveCSS("background-color", "rgb(14, 18, 23)");

    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(shell).toHaveCSS("background-color", "rgb(250, 250, 250)");
    await expect(page.locator('meta[name="darkreader-lock"]')).toHaveCount(0);
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/toggle-1-light-on-dark-device.png` });

    // The choice survives a reload (cookie, set on <html> by the server) and a device setting change.
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-public-theme", "light");
    await expect(shell).toHaveCSS("background-color", "rgb(250, 250, 250)");
    await page.emulateMedia({ colorScheme: "light" });
    await page.getByRole("button", { name: "Switch to dark mode" }).click();
    await expect(shell).toHaveCSS("background-color", "rgb(14, 18, 23)");
    await expect(page.locator('meta[name="darkreader-lock"]')).toHaveCount(1);
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/toggle-2-dark-on-light-device.png` });

    // The friends persona has the theme toggle too, in its warm palette.
    await page.goto("/friends", { timeout: 60_000 });
    await expect(page.locator("[data-public-shell]")).toHaveCSS("background-color", "rgb(20, 18, 17)");
    await page.getByRole("button", { name: "Switch to light mode" }).click();
    await expect(page.locator("[data-public-shell]")).toHaveCSS("background-color", "rgb(251, 243, 232)");
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/toggle-3-friends-light.png` });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/julianjoseph/30min", { timeout: 60_000 });
      await expect(page.getByRole("button", { name: OPEN_DAY })).toBeEnabled({ timeout: 60_000 });
      await page.screenshot({ path: `${SHOTS}/toggle-4-phone.png` });
    }
  });
});
