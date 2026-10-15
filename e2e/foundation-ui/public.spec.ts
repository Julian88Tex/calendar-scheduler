// Public components (SPEC section 8, GEN-03, GEN-14, GEN-21, BK-03, BK-26): the gallery's landing and booking replicas
// carry the Powered by ribbon with its exact geometry, the Report abuse mailto to the operator, the 44px day circles
// tinted from --primary-color (#E6F0FF fill, #004EBA text; primary_color=ff0000 turns them red), the split
// [time][Next] slot at 48.5% each; the cookie banner appears only when a tracker is configured and no tracker request
// leaves the page before consent; public pages without trackers never show it.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";

const TRACKER = "https://www.googletagmanager.com/**";

/** The rendered color of a CSS property composited over white, as #rrggbb. */
async function renderedColor(locator: Locator, prop: "background-color" | "color"): Promise<string> {
  return locator.evaluate(async (el, p) => {
    // Days and buttons fade between colors (transition-colors): read the color once the transition has ended.
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)));
    const value = getComputedStyle(el).getPropertyValue(p);
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillStyle = value;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r!, g!, b!].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  }, prop);
}

function expectColorNear(actual: string, expected: string, label: string, tolerance = 2) {
  const parse = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const a = parse(actual);
  const e = parse(expected);
  const ok = a.every((c, i) => Math.abs(c - e[i]!) <= tolerance);
  expect(ok, `${label}: ${actual} should be close to ${expected}`).toBe(true);
}

async function openGallery(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/dev/ui#public");
  await expect(page.getByRole("heading", { level: 2, name: "Public pages" })).toBeVisible();
}

/** Turns the gallery's tracker switch on (a click before the page hydrates does nothing: retry until it is checked). */
async function enableTracker(page: Page) {
  const toggle = page.getByRole("switch", { name: "Simulate a configured tracker (GA4)" });
  await expect(async () => {
    if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("public components", () => {
  test.beforeEach(async ({ api, seed, page, loginAs }) => {
    await api.reset();
    await seed("owner");
    await loginAs(page, "owner@example.com");
  });

  test("ribbon geometry and footer links on the landing replica", async ({ page }) => {
    await openGallery(page);
    const landing = page.getByTestId("landing-replica");
    const ribbon = landing.getByTestId("powered-by-ribbon");
    await expect(ribbon).toHaveAccessibleName(/^Powered by /);
    // top -5px and right -5px from the card's padding box (inside its 1px border). Both rectangles are read in one
    // evaluate so a late scroll to #public cannot shift one measurement against the other.
    const geometry = await ribbon.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const card = el.parentElement!;
      const r = card.getBoundingClientRect();
      const cs = getComputedStyle(card);
      return {
        width: box.width,
        height: box.height,
        overRight: box.right - (r.right - parseFloat(cs.borderRightWidth)),
        overTop: r.top + parseFloat(cs.borderTopWidth) - box.top,
        border: cs.borderTopWidth,
      };
    });
    expect(Math.round(geometry.width)).toBe(105);
    expect(Math.round(geometry.height)).toBe(105);
    expect(geometry.border).toBe("1px");
    expect(Math.round(geometry.overRight)).toBe(5);
    expect(Math.round(geometry.overTop)).toBe(5);
    const band = await ribbon.evaluate((el) => {
      const b = el.querySelector("span:last-child") as HTMLElement;
      const cs = getComputedStyle(b);
      return { width: cs.width, height: cs.height, rotate: cs.rotate, transform: cs.transform, top: cs.top, left: cs.left };
    });
    // Calendly parity (live captures, commit 78253ee): the band is 40px thick, not 32px, and sits at top 18.5px and
    // left -13.9px so its inner edge still runs corner to corner (it meets the box top 56px from the corner).
    expect(band.width).toBe("160px");
    expect(band.height).toBe("40px");
    expect(band.top).toBe("18.5px");
    expect(band.left).toBe("-13.9px");
    // Tailwind's rotate-45 sets the individual `rotate` property (or a matrix(cos, sin, -sin, cos, 0, 0) transform).
    expect(band.rotate === "45deg" || /^matrix\(0\.707\d*, 0\.707\d*, -0\.707\d*, 0\.707\d*, 0, 0\)$/.test(band.transform), JSON.stringify(band)).toBe(true);
    await expect(ribbon).toContainText(/Powered by/i);

    const footer = landing.getByRole("navigation", { name: "Footer" });
    const abuse = footer.getByRole("link", { name: "Report abuse" });
    const href = (await abuse.getAttribute("href"))!;
    expect(href.startsWith("mailto:operator@example.com?subject=")).toBe(true);
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(params.get("subject")).toBe("Report abuse: https://kairos.example/julianjoseph");
    expect(params.get("body")).toContain("Please describe what happened");
    await expect(footer.getByRole("link", { name: "Privacy Policy" })).toHaveCount(0);

    await footer.getByRole("button", { name: "Cookie settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Cookie settings" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("switch", { name: "Analytics cookies" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // Phones: the card is full-bleed and the ribbon sits flush in the corner (no horizontal scroll).
    await page.setViewportSize({ width: 390, height: 844 });
    const flush = await ribbon.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const card = el.parentElement!.getBoundingClientRect();
      return { right: Math.round(box.right - card.right), top: Math.round(box.top - card.top) };
    });
    expect(flush).toEqual({ right: 0, top: 0 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("booking calendar circles, tints and the split time slot", async ({ page }) => {
    await openGallery(page);
    const booking = page.getByTestId("booking-replica");
    const calendar = booking.getByRole("table", { name: "Select a Day" });
    const day = calendar.getByRole("button", { name: "Tuesday, October 13 - Times available" });
    const dayBox = (await day.boundingBox())!;
    expect(Math.round(dayBox.width)).toBe(44);
    expect(Math.round(dayBox.height)).toBe(44);
    expectColorNear(await renderedColor(day, "background-color"), "#e6f0ff", "available day fill");
    expectColorNear(await renderedColor(day, "color"), "#004eba", "available day text");
    const off = calendar.getByRole("button", { name: "Monday, October 12 - No times available" });
    await expect(off).toBeDisabled();
    expectColorNear(await renderedColor(off, "color"), "#476788", "unavailable day text");
    // Available days read at a glance: bold numbers on a #E6F0FF fill, unavailable ones regular with no fill.
    expect(await off.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("400");
    expect(await day.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("700");

    // The heading and time zone row use the classic ink.
    expectColorNear(await renderedColor(booking.getByRole("heading", { name: "Select a Date & Time" }), "color"), "#0a2540", "heading");

    const card = booking.getByRole("heading", { name: "Select a Date & Time" }).locator("xpath=ancestor::*[@data-booking-card]");
    const narrow = (await card.boundingBox())!.width;
    expect(Math.round(narrow)).toBe(800);

    await day.click();
    await expect(day).toHaveAttribute("aria-pressed", "true");
    expectColorNear(await renderedColor(day, "background-color"), "#006bff", "selected day fill");
    await expect.poll(async () => Math.round((await card.boundingBox())!.width)).toBeGreaterThan(900);

    const times = booking.getByRole("list", { name: "Select a time" });
    const slot = times.getByRole("button", { name: "9:00am", exact: true });
    expect(Math.round((await slot.boundingBox())!.height)).toBe(52);
    expectColorNear(await renderedColor(slot, "color"), "#004eba", "slot text");
    await slot.click();
    const next = times.getByRole("button", { name: "Next" });
    await expect(next).toBeVisible();
    await expect(next).toBeFocused();
    await expect(next).toHaveAccessibleDescription(/9:00am/);
    const row = next.locator("..");
    await expect.poll(async () => {
      const rowBox = (await row.boundingBox())!;
      const nextBox = (await next.boundingBox())!;
      return Math.abs(nextBox.width / rowBox.width - 0.485) < 0.01;
    }).toBe(true);
    const timeChip = row.locator("div").first();
    const chipBox = (await timeChip.boundingBox())!;
    const rowBox = (await row.boundingBox())!;
    expect(Math.abs(chipBox.width / rowBox.width - 0.485)).toBeLessThan(0.01);
    // GEN-05: navy at 65% (white text 5:1) instead of Calendly's 50% (3.2:1).
    expectColorNear(await renderedColor(timeChip, "background-color"), "#607183", "selected time chip (navy at 65%)", 3);
    expectColorNear(await renderedColor(next, "background-color"), "#006bff", "Next button");

    // Branding: primary_color=ff0000 recolors every blue.
    await page.getByRole("radiogroup", { name: "Branding color" }).getByRole("radio", { name: "Red (ff0000)" }).click();
    expectColorNear(await renderedColor(next, "background-color"), "#ff0000", "branded Next");
    const day14 = calendar.getByRole("button", { name: "Wednesday, October 14 - Times available" });
    expectColorNear(await renderedColor(day14, "color"), "#ba0000", "branded day text");
    expectColorNear(await renderedColor(day14, "background-color"), "#ffe6e6", "branded day fill");
  });

  test("cookie banner appears only with a tracker and nothing loads before consent", async ({ page }) => {
    const requests: string[] = [];
    await page.route(TRACKER, async (route) => {
      requests.push(route.request().url());
      await route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
    });
    await openGallery(page);
    const banner = page.getByRole("region", { name: "Cookie consent" });
    const state = page.getByTestId("consent-state");
    await expect(state).toHaveText("Consent: unknown. Tracker not loaded.");
    await expect(banner).toHaveCount(0);

    await enableTracker(page);
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("button", { name: "Reject non-essential" })).toBeVisible();
    await expect(banner.getByRole("button", { name: "Cookie settings" })).toBeVisible();
    await page.waitForTimeout(500);
    expect(requests, "no tracker request before consent").toEqual([]);
    expect(await page.locator('script[src*="googletagmanager"]').count()).toBe(0);

    await banner.getByRole("button", { name: "Accept all" }).click();
    await expect(banner).toBeHidden();
    await expect(state).toHaveText("Consent: granted. Tracker loaded.");
    await expect.poll(() => requests.length).toBeGreaterThan(0);

    // The choice persists: after a reload the banner stays hidden and the tracker loads right away.
    await page.reload();
    await expect(page.getByRole("heading", { level: 2, name: "Public pages" })).toBeVisible();
    await enableTracker(page);
    await expect(state).toHaveText("Consent: granted. Tracker loaded.");
    await expect(banner).toHaveCount(0);
  });

  test("rejecting non-essential cookies keeps trackers off", async ({ page }) => {
    const requests: string[] = [];
    await page.route(TRACKER, async (route) => {
      requests.push(route.request().url());
      await route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
    });
    await openGallery(page);
    await enableTracker(page);
    const banner = page.getByRole("region", { name: "Cookie consent" });
    await banner.getByRole("button", { name: "Cookie settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Cookie settings" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Reject non-essential" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("consent-state")).toHaveText("Consent: denied. Tracker not loaded.");
    await expect(banner).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(requests).toEqual([]);
  });

  test("public pages without trackers show no cookie banner", async ({ page }) => {
    const res = await page.goto("/julianjoseph");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Cookie consent" })).toHaveCount(0);
    // Public pages always use the light classic canvas.
    expectColorNear(await renderedColor(page.locator("[data-public-shell]"), "background-color"), "#fafafa", "public canvas");
  });
});
