// Foundation shell (SPEC GEN-20, ARCHITECTURE section 3.1): with the seeded owner (ADM-10) signed in, every sidebar
// link opens its page (active link marked, page title as h1, placeholder body), section tabs and the admin sub-navigation
// work, non-admin members do not get the Admin center, and the /app/dev/ui gallery renders and reacts.
import type { Page } from "@playwright/test";
import { ALL_NAV } from "../../src/components/shell/nav";
import { expect, test } from "../fixtures";

const PLACEHOLDER = "This page is being built.";

/** Collects uncaught page errors (React render or hydration failures) for the current test. */
function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test.describe("dashboard shell", () => {
  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await seed("team");
  });

  test("every sidebar link renders its page", async ({ page, loginAs }) => {
    const errors = trackPageErrors(page);
    await loginAs(page, "owner@example.com");
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app\/scheduling$/);

    const sidebar = page.getByRole("navigation", { name: "Main" });
    for (const item of ALL_NAV) {
      const link = sidebar.getByRole("link", { name: item.label, exact: true });
      await link.click();
      await expect(page, item.label).toHaveURL(new RegExp(`${item.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
      await expect(page.getByRole("heading", { level: 1, name: item.label, exact: true }), item.label).toBeVisible();
      await expect(link, item.label).toHaveAttribute("aria-current", "page");
      if (item.href === "/app/integrations") {
        // The integrations hub lists the catalog tiles instead of a placeholder.
        await expect(page.getByRole("link", { name: "Google Calendar" }).first()).toBeVisible();
      } else {
        await expect(page.getByText(PLACEHOLDER).first(), item.label).toBeVisible();
      }
    }
    expect(errors, "page errors").toEqual([]);
  });

  test("section tabs and the admin sub-navigation open their placeholders", async ({ page, loginAs }) => {
    const errors = trackPageErrors(page);
    await loginAs(page, "owner@example.com");
    const sections: { start: string; nav: string }[] = [
      { start: "/app/scheduling", nav: "Scheduling" },
      { start: "/app/availability", nav: "Availability" },
      { start: "/app/admin", nav: "Admin center" },
    ];
    for (const s of sections) {
      await page.goto(s.start);
      const tabs = page.getByRole("navigation", { name: s.nav, exact: true });
      const hrefs = await tabs.getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
      expect(hrefs.length, s.nav).toBeGreaterThan(1);
      for (const href of hrefs) {
        const res = await page.goto(href);
        expect(res?.status(), href).toBe(200);
        await expect(page.getByRole("heading", { level: 1 }).first(), href).toBeVisible();
        await expect(page.getByText(PLACEHOLDER).first(), href).toBeVisible();
        await expect(
          page.getByRole("navigation", { name: s.nav, exact: true }).locator(`a[href="${href}"]`),
          href,
        ).toHaveAttribute("aria-current", "page");
      }
    }
    expect(errors, "page errors").toEqual([]);
  });

  test("members without an admin role do not see the Admin center", async ({ page, loginAs }) => {
    await loginAs(page, "member2@example.com");
    await page.goto("/app/scheduling");
    const sidebar = page.getByRole("navigation", { name: "Main" });
    await expect(sidebar.getByRole("link", { name: "Scheduling", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(sidebar.getByRole("link", { name: "Analytics", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Admin center", exact: true })).toHaveCount(0);
    await page.goto("/app/admin/people");
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toHaveCount(0);
  });
});

test.describe("UI kit gallery", () => {
  test("/app/dev/ui renders and its controls work", async ({ page, api, seed, loginAs }) => {
    const errors = trackPageErrors(page);
    await api.reset();
    await seed("owner");
    await loginAs(page, "owner@example.com");
    const res = await page.goto("/app/dev/ui");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "UI kit" })).toBeVisible();
    for (const name of ["Primary", "Secondary", "Destructive"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }
    await expect(page.getByLabel("Name")).toBeVisible();

    await page.getByRole("button", { name: "Open dialog" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Show toast" }).click();
    await expect(page.getByText("Changes saved").first()).toBeVisible();
    expect(errors, "page errors").toEqual([]);
  });
});
