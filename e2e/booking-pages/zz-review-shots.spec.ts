// Temporary review screenshots (deleted before finishing).
import { expect, test } from "../fixtures";

const OUT = "/tmp/claude-0/-home-user-calendar-scheduler/c9812121-7c1c-586e-a5d4-c6110d4042e5/scratchpad/shots";
const SLOW = { timeout: 90_000 };

test.describe("review shots", () => {
  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await api.setTime("2030-10-07T13:00:00Z");
    await seed("owner");
  });
  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test("desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto("/julianjoseph", SLOW);
    await page.screenshot({ path: `${OUT}/01-landing.png` });
    await page.getByRole("link", { name: "30 Minute Virtual" }).click();
    await expect(page.getByRole("button", { name: "Tuesday, October 8 - Times available" })).toBeEnabled(SLOW);
    await page.screenshot({ path: `${OUT}/02-30min.png` });
    await page.getByRole("button", { name: "Tuesday, October 8 - Times available" }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/03-30min-date.png` });
    await page.getByRole("list", { name: "Select a time" }).getByRole("button").nth(2).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/04-30min-time.png` });
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Enter Details" })).toBeVisible(SLOW);
    await page.screenshot({ path: `${OUT}/05-details.png` });
    await page.getByRole("button", { name: "Schedule Event" }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/05b-details-errors.png`, fullPage: true });
    await page.waitForTimeout(2100);
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Ana Lima");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("ana@example.com");
    await page.getByRole("textbox", { name: "What would you like to discuss?", exact: true }).fill("Roadmap");
    await page.getByRole("button", { name: "Schedule Event" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "You are scheduled" })).toBeVisible(SLOW);
    await page.screenshot({ path: `${OUT}/06-confirmation.png`, fullPage: true });
  });

  test("meal", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/julianjoseph/meal", SLOW);
    await expect(page.getByRole("button", { name: "Tuesday, October 8 - Times available" })).toBeEnabled(SLOW);
    await page.screenshot({ path: `${OUT}/07-meal.png`, fullPage: true });
    await page.getByRole("button", { name: "Tuesday, October 8 - Times available" }).click();
    await page.getByRole("list", { name: "Select a time" }).getByRole("button").first().click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Enter Details" })).toBeVisible(SLOW);
    await page.screenshot({ path: `${OUT}/08-meal-details.png`, fullPage: true });
  });

  test("phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/julianjoseph", SLOW);
    await page.screenshot({ path: `${OUT}/09-phone-landing.png`, fullPage: true });
    await page.goto("/julianjoseph/30min", SLOW);
    await expect(page.getByRole("button", { name: "Tuesday, October 8 - Times available" })).toBeEnabled(SLOW);
    await page.screenshot({ path: `${OUT}/10-phone-cal.png`, fullPage: true });
    await page.getByRole("button", { name: "Tuesday, October 8 - Times available" }).click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/11-phone-times.png`, fullPage: true });
    await page.getByRole("list", { name: "Select a time" }).getByRole("button").first().click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Enter Details" })).toBeVisible(SLOW);
    await page.screenshot({ path: `${OUT}/12-phone-details.png`, fullPage: true });
  });

  test("owner", async ({ page, loginAs }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, "owner@example.com");
    await page.goto("/julianjoseph/30min", SLOW);
    await expect(page.getByRole("button", { name: "Tuesday, October 8 - Times available" })).toBeEnabled(SLOW);
    await page.screenshot({ path: `${OUT}/13-owner.png`, fullPage: true });
    await page.getByRole("button", { name: "Troubleshoot Availability" }).click();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /Monday, October 7/ }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/14-owner-troubleshoot.png`, fullPage: true });
    const href = await page.getByTestId("troubleshoot-link").getAttribute("href");
    console.log("TROUBLESHOOT HREF", href);
    await page.goto(href!, SLOW);
    console.log("TROUBLESHOOT LANDED", page.url());
    await page.screenshot({ path: `${OUT}/15-troubleshoot-route.png`, fullPage: true });
  });
});
