// Dashboard shell (SPEC GEN-20, GEN-04, GEN-05, GEN-16, GEN-19, GEN-22, BR-15, ET-02, narrowed by docs/SCOPE.md): the
// sidebar lists the kept nav in order with the active pill on sub-pages (the event type editor and polls keep
// Scheduling active), collapses to a 72px rail that persists across reloads, never offers Admin center or Invite user
// (out of scope), turns into a drawer at 390px (focus trap, Escape closes, closes on navigation); the account, help and
// create menus open working destinations only; the cron warning opens its setup steps; shell pages never scroll
// horizontally at 320, 390, 768 or 1440px; the shell passes axe in the light and dark themes.
import type { Locator, Page } from "@playwright/test";
import { ALL_NAV } from "../../src/components/shell/nav";
import { expect, test } from "../fixtures";

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

const sidebar = (page: Page) => page.getByRole("complementary", { name: "Sidebar" });
const mainNav = (page: Page) => page.getByRole("navigation", { name: "Main" });

async function widthOf(locator: Locator): Promise<number> {
  return (await locator.boundingBox())?.width ?? -1;
}

test.describe("dashboard shell", () => {
  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await seed("team");
  });

  test("sidebar lists the nav in order and keeps the active pill on sub-pages", async ({ page, loginAs }) => {
    const errors = trackPageErrors(page);
    await loginAs(page, "owner@example.com");
    await page.goto("/app/scheduling");

    const names = await mainNav(page)
      .getByRole("link")
      .evaluateAll((links) => links.map((a) => (a.textContent ?? "").trim()));
    expect(names).toEqual(ALL_NAV.map((i) => i.label));
    await expect(mainNav(page).getByRole("button", { name: "Help", exact: true })).toBeVisible();

    const subPages: { path: string; active: string }[] = [
      { path: "/app/scheduling/meeting-polls", active: "Scheduling" },
      { path: "/app/event-types/new?kind=one_on_one", active: "Scheduling" },
      { path: "/app/polls/new", active: "Scheduling" },
      { path: "/app/availability/advanced", active: "Availability" },
      { path: "/app/integrations/calendars/google", active: "Integrations & apps" },
    ];
    for (const s of subPages) {
      await page.goto(s.path);
      const active = mainNav(page).locator('a[aria-current="page"]');
      await expect(active, s.path).toHaveCount(1);
      await expect(active, s.path).toHaveText(s.active);
      // Active pill: #F4F8FF fill with #004EBA text (GEN-03).
      const colors = await active.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, color: cs.color };
      });
      expect(colors, s.path).toEqual({ bg: "rgb(244, 248, 255)", color: "rgb(0, 78, 186)" });
    }
    expect(errors, "page errors").toEqual([]);
  });

  test("collapses to a 72px rail that persists across reloads", async ({ page, loginAs }) => {
    await loginAs(page, "owner@example.com");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/app/scheduling");
    await expect.poll(() => widthOf(sidebar(page))).toBe(240);

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect.poll(() => widthOf(sidebar(page))).toBe(72);
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
    // The rail keeps every destination reachable through icon links with accessible names.
    for (const item of ALL_NAV) await expect(mainNav(page).getByRole("link", { name: item.label, exact: true })).toBeVisible();
    await expect(sidebar(page).getByRole("button", { name: "Create" })).toBeVisible();

    // The preference is saved (users.preferences.sidebarCollapsed): wait for the server action, then reload.
    await expect.poll(async () => {
      await page.reload();
      return widthOf(sidebar(page));
    }).toBe(72);
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();

    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect.poll(() => widthOf(sidebar(page))).toBe(240);
    await expect.poll(async () => {
      await page.reload();
      return widthOf(sidebar(page));
    }).toBe(240);
  });

  test("no one is offered the out-of-scope Admin center or Invite user", async ({ page, loginAs }) => {
    // The instance admin owner, an organization admin and a plain member alike (docs/SCOPE.md skips both areas).
    for (const email of ["owner@example.com", "member1@example.com", "member2@example.com"]) {
      await loginAs(page, email);
      await page.goto("/app/scheduling");
      await expect(mainNav(page).getByRole("link", { name: "Scheduling", exact: true }), email).toHaveAttribute("aria-current", "page");
      for (const name of ["Admin center", "Analytics", "Contacts", "Workflows", "Routing"]) {
        await expect(mainNav(page).getByRole("link", { name, exact: true }), `${email}: ${name}`).toHaveCount(0);
      }
      await expect(page.getByRole("link", { name: "Invite user" }), email).toHaveCount(0);

      await page.getByRole("button", { name: "Account menu" }).click();
      const menu = page.getByRole("menu");
      await expect(menu.getByRole("menuitem", { name: "Profile" }), email).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Admin center" }), email).toHaveCount(0);
      await expect(menu.getByRole("menuitem", { name: "Invite users" }), email).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
  });

  test("phone drawer traps focus, closes on Escape and after navigation", async ({ page, loginAs }) => {
    await loginAs(page, "owner@example.com");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app/scheduling");
    await expect(sidebar(page)).toBeHidden();

    const open = page.getByRole("button", { name: "Open navigation" });
    await open.click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveCount(ALL_NAV.length);
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press("Tab");
      expect(await drawer.evaluate((el) => el.contains(document.activeElement)), `tab ${i}`).toBe(true);
    }
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await drawer.evaluate((el) => el.contains(document.activeElement)), `shift+tab ${i}`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(open).toBeFocused();

    await open.click();
    await expect(drawer).toBeVisible();
    await drawer.getByRole("link", { name: "Availability", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/availability$/);
    await expect(drawer).toBeHidden();

    await open.click();
    await drawer.getByRole("button", { name: "Close navigation" }).click();
    await expect(drawer).toBeHidden();
  });

  test("account menu items open their destinations", async ({ page, context, loginAs }) => {
    const errors = trackPageErrors(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await loginAs(page, "owner@example.com");
    await page.goto("/app/scheduling");

    const trigger = page.getByRole("button", { name: "Account menu" });
    await trigger.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByText("owner@example.com")).toBeVisible();
    const expected: [string, string][] = [
      ["Profile", "/app/settings/profile"],
      ["Branding", "/app/settings/branding"],
      ["My Link", "/app/settings/link"],
      ["Login and security", "/app/settings/login"],
      ["Calendar sync", "/app/availability/calendar-settings"],
    ];
    for (const [name, href] of expected) await expect(menu.getByRole("menuitem", { name, exact: true }), name).toHaveAttribute("href", href);
    await expect(menu.getByRole("menuitem", { name: "Share your link" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Help", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Log out" })).toBeVisible();
    // Only the kept destinations (docs/SCOPE.md): 5 links, Share your link, Help and Log out.
    await expect(menu.getByRole("menuitem")).toHaveCount(expected.length + 3);

    // Keyboard: arrows move through the items, Escape closes and returns focus to the avatar.
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();

    // Every destination answers.
    for (const [name, href] of expected) {
      const res = await page.request.get(href);
      expect(res.status(), name).toBe(200);
    }

    // Help opens the in-app Help center.
    await trigger.click();
    await page.getByRole("menuitem", { name: "Help", exact: true }).click();
    const helpCenter = page.getByRole("dialog", { name: "Help center" });
    await expect(helpCenter).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(helpCenter).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.getByRole("menuitem", { name: "Share your link" }).click();
    await expect(page.getByText("Link copied").first()).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/julianjoseph$/);

    await trigger.click();
    await page.getByRole("menuitem", { name: "Profile", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/settings\/profile$/);

    await trigger.click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/app/scheduling");
    await expect(page).toHaveURL(/\/login/);
    expect(errors, "page errors").toEqual([]);
  });

  test("help menu opens the help center, what's new and report a problem", async ({ page, loginAs }) => {
    await loginAs(page, "owner@example.com");
    await page.goto("/app/scheduling");

    const help = mainNav(page).getByRole("button", { name: "Help", exact: true });
    await help.click();
    const menu = page.getByRole("menu");
    // Report a problem mails the instance operator (the first instance admin when none is configured).
    await expect(menu.getByRole("menuitem", { name: "Report a problem" })).toHaveAttribute(
      "href",
      /^mailto:owner@example\.com\?subject=Report%20a%20problem%20with%20/,
    );
    // No "Getting started": the onboarding wizard is out of scope (docs/SCOPE.md).
    await expect(menu.getByRole("menuitem")).toHaveCount(3);

    await menu.getByRole("menuitem", { name: "Help center" }).click();
    const center = page.getByRole("dialog", { name: "Help center" });
    await expect(center).toBeVisible();
    const article = center.getByRole("button", { name: "Control how many meetings you get" });
    await article.click();
    await expect(article).toHaveAttribute("aria-expanded", "true");
    await expect(center.getByText(/meeting limits per day and per week/)).toBeVisible();
    await expect(center.getByRole("link", { name: "Report a problem" })).toHaveAttribute("href", /^mailto:owner@example\.com\?/);
    await page.keyboard.press("Escape");
    await expect(center).toBeHidden();
    // GEN-05: focus returns to the Help button (the menu item that opened the dialog is gone).
    await expect(help).toBeFocused();

    await help.click();
    await page.getByRole("menu").getByRole("menuitem", { name: "What's new" }).click();
    const dialog = page.getByRole("dialog", { name: "What's new" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Scheduling" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(help).toBeFocused();

    // Collapsed rail: the same flyout from the icon button.
    // (Keyboard: the dev-only Next.js indicator sits over the bottom-left corner of the rail.)
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect.poll(() => widthOf(sidebar(page))).toBe(72);
    const railHelp = mainNav(page).getByRole("button", { name: "Help", exact: true });
    await railHelp.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Help center" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(railHelp).toBeFocused();
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect.poll(() => widthOf(sidebar(page))).toBe(240);
  });

  test("create menu offers one-on-one event types and meeting polls only", async ({ page, loginAs }) => {
    await loginAs(page, "owner@example.com");
    await page.goto("/app/scheduling");

    const create = sidebar(page).getByRole("button", { name: "Create" });
    await create.click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: /^One-on-one/ })).toHaveAttribute("href", "/app/event-types/new?kind=one_on_one");
    await expect(menu.getByRole("menuitem", { name: /^Meeting poll/ })).toHaveAttribute("href", "/app/polls/new");
    await expect(menu.getByRole("menuitem", { name: /^One-on-one/ })).toContainText("1 host");
    await expect(menu.getByRole("menuitem", { name: /^One-on-one/ })).toContainText("1 invitee");
    await expect(menu.getByText("Event type", { exact: true })).toBeVisible();
    await expect(menu.getByText("More ways to meet", { exact: true })).toBeVisible();
    // Group, Round robin, Collective and One-off meeting are out of scope (docs/SCOPE.md).
    await expect(menu.getByRole("menuitem")).toHaveCount(2);
    await menu.getByRole("menuitem", { name: /^Meeting poll/ }).click();
    await expect(page).toHaveURL(/\/app\/polls\/new$/);

    // The Scheduling header carries the same menu, and its tabs are Event types and Meeting polls.
    await page.goto("/app/scheduling");
    const tabs = page.getByRole("navigation", { name: "Scheduling", exact: true }).getByRole("link");
    await expect(tabs).toHaveText(["Event types", "Meeting polls"]);
    await page.getByRole("main").getByRole("button", { name: "Create" }).click();
    await page.getByRole("menuitem", { name: /^One-on-one/ }).click();
    await expect(page).toHaveURL(/\/app\/event-types\/new\?kind=one_on_one$/);
  });

  test("the cron warning shows for the instance admin and opens the setup steps", async ({ page, api, loginAs }) => {
    // Record a cron tick, then let 16 minutes pass on the business clock.
    const tick = await page.request.get("/api/cron");
    expect(tick.status()).toBe(200);
    await api.advanceTime(16 * 60_000);

    await loginAs(page, "owner@example.com");
    await page.goto("/app/scheduling");
    const banner = page.getByRole("status").filter({ hasText: "Reminders may be sent late. Set up a pinger that calls /api/cron every 5 minutes." });
    await expect(banner).toBeVisible();
    const dialog = page.getByRole("dialog", { name: "Set up a pinger" });
    // The banner is server rendered: retry the click until the page has hydrated (slow first loads in next dev).
    await expect(async () => {
      await banner.getByRole("button", { name: "See setup steps" }).click();
      await expect(dialog).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(dialog.getByText(/\/api\/cron$/)).toBeVisible();
    await expect(dialog.getByText("Last run:")).toContainText("16 minutes ago");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await banner.getByRole("button", { name: "Dismiss" }).click();
    await expect(banner).toBeHidden();

    // Plain members never see it.
    await loginAs(page, "member2@example.com");
    await page.goto("/app/scheduling");
    await expect(page.getByText(/Reminders may be sent late/)).toHaveCount(0);
  });

  test("shell pages never scroll horizontally", async ({ page, loginAs }) => {
    await loginAs(page, "owner@example.com");
    const paths = ["/app/scheduling", "/app/meetings", "/app/availability", "/app/integrations", "/app/settings/profile", "/app/dev/ui"];
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of paths) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
      }
    }
  });

  test("the shell passes axe on desktop and in the phone drawer", async ({ page, loginAs, axe }) => {
    await loginAs(page, "owner@example.com");
    await page.goto("/app/integrations");
    await expect(page.getByRole("heading", { level: 1, name: "Integrations & apps" })).toBeVisible();
    await axe(page);

    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect.poll(() => widthOf(sidebar(page))).toBe(72);
    await axe(page);
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect.poll(() => widthOf(sidebar(page))).toBe(240);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
    await axe(page);
  });

  test("the dark theme (GEN-22) passes axe color contrast on shell pages and the UI kit", async ({ page, loginAs, axe }) => {
    await loginAs(page, "owner@example.com");
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const path of ["/app/integrations", "/app/dev/ui"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(canvas, path).toBe("rgb(14, 18, 23)");
      // Public replicas inside the gallery stay in the light classic theme by design (data-force-light).
      await axe(page);
    }
  });
});
