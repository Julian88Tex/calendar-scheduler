// UI kit gallery (ARCHITECTURE 20.2, SPEC GEN-03, GEN-05, GEN-06): /app/dev/ui shows every component family, passes axe
// with no violations, and its controls behave: dialogs trap focus and return it on Escape, the time input parses typed
// times, the color picker rejects invalid hex with the documented message, the time zone picker shows friendly names
// with the local time, and the booking calendar exposes day labels and roving arrow keys.
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test.describe("UI kit gallery", () => {
  test.beforeEach(async ({ api, seed, page, loginAs }) => {
    await api.reset();
    await seed("owner");
    await loginAs(page, "owner@example.com");
  });

  test("renders every section and passes axe", async ({ page, axe }) => {
    const errors = trackPageErrors(page);
    const res = await page.goto("/app/dev/ui");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "UI kit" })).toBeVisible();
    const sections = ["Buttons", "Form controls", "Time and dates", "Rich inputs", "Navigation and disclosure", "Overlays and feedback", "Data display", "Public pages"];
    for (const name of sections) await expect(page.getByRole("heading", { level: 2, name, exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Gallery sections" }).getByRole("link")).toHaveCount(sections.length);
    await axe(page);
    expect(errors, "page errors").toEqual([]);
  });

  test("dialogs trap focus and return it on Escape", async ({ page }) => {
    await page.goto("/app/dev/ui");
    const opener = page.getByRole("button", { name: "Open dialog" });
    await opener.click();
    const dialog = page.getByRole("dialog", { name: "Example dialog" });
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement)), `tab ${i}`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("time input parses typed times", async ({ page }) => {
    await page.goto("/app/dev/ui");
    const start = page.getByRole("combobox", { name: "Start time" });
    await start.click();
    await start.fill("930");
    await page.keyboard.press("Enter");
    await expect(start).toHaveValue("9:30am");
    await start.fill("9:30 pm");
    await page.keyboard.press("Tab");
    await expect(start).toHaveValue("9:30pm");
    await start.fill("noon");
    await page.keyboard.press("Enter");
    await expect(start).toHaveValue("12:00pm");
    // Arrow keys move through the 15 minute list.
    await start.click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(start).toHaveValue("12:15pm");
  });

  test("color picker rejects invalid hex values", async ({ page }) => {
    await page.goto("/app/dev/ui");
    const custom = page.getByRole("textbox", { name: "Custom" });
    await custom.fill("#12");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert").filter({ hasText: "Enter a valid color like #8247F5" })).toBeVisible();
    await expect(custom).toHaveAttribute("aria-invalid", "true");
    await custom.fill("#17e885");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Enter a valid color like #8247F5")).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: "Event color" }).getByRole("radio", { checked: true })).toHaveCount(1);
  });

  test("time zone picker lists friendly names with the local time", async ({ page }) => {
    await page.goto("/app/dev/ui");
    const time = page.locator("#time");
    const button = time.getByRole("button", { name: /^Time zone Eastern Time - US & Canada/ });
    await expect(button).toContainText(/\d{1,2}:\d{2}(am|pm)/);
    await button.click();
    await expect(page.getByRole("radiogroup", { name: "Time format" })).toBeVisible();
    await page.getByPlaceholder("Search...").fill("india");
    await expect(page.getByRole("option", { name: /India, Sri Lanka Time/ })).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("booking calendar labels days and moves focus with the arrow keys", async ({ page }) => {
    await page.goto("/app/dev/ui");
    const calendar = page.locator("#time").getByRole("table", { name: "Select a Day" }).first();
    await expect(calendar).toBeVisible();
    const day13 = calendar.getByRole("button", { name: "Tuesday, October 13 - Times available" });
    await expect(day13).toBeVisible();
    await expect(calendar.getByRole("button", { name: "Monday, October 12 - No times available" })).toBeDisabled();
    await day13.focus();
    await page.keyboard.press("ArrowRight");
    await expect(calendar.getByRole("button", { name: "Wednesday, October 14 - Times available" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(calendar.getByRole("button", { name: "Wednesday, October 21 - Times available" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(calendar.getByRole("button", { name: "Wednesday, October 21 - Times available" })).toHaveAttribute("aria-pressed", "true");

    const next = page.locator("#time").getByRole("button", { name: "Go to next month" }).first();
    await next.click();
    await expect(page.getByText("November is now displayed").first()).toBeAttached();
  });
});
