// Scheduling page, Event types tab (SPEC ET-02 to ET-09, ET-12, ET-33; walkthrough 5.1 and 5.2; docs/SCOPE.md) on the
// seeded owner (30 Minute Virtual, 60 Minute Virtual, In-Person Meal or Coffee): the card parts and Copy link, the
// kebab menu order, create from the "+ Create" menu, turn off, make secret, internal note, duplicate and delete,
// keyboard, mouse and touch reorder reflected on the landing page, search and filters in the URL, bulk toggle and bulk
// delete with one confirmation, focus after deletes, stale lists (a change made in another tab), the empty state, and
// the phone layout.
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../fixtures";

const OWNER = "owner@example.com";
const SLOW = { timeout: 60_000 };
const NAMES = ["30 Minute Virtual", "60 Minute Virtual", "In-Person Meal or Coffee"];

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Opens a page and waits for hydration (clicks before hydration are lost in dev mode). */
async function open(page: Page, url = "/app/scheduling") {
  await page.goto(url, SLOW);
  await page.waitForLoadState("networkidle");
}

const list = (page: Page) => page.getByRole("list", { name: "Personal event types" });
const card = (page: Page, name: string) => list(page).getByRole("listitem", { name, exact: true });
const cardNames = (page: Page) => list(page).getByRole("heading", { level: 3 }).allInnerTexts();

async function menuOf(page: Page, name: string): Promise<Locator> {
  await card(page, name).getByRole("button", { name: `${name} actions` }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

async function landingNames(page: Page): Promise<string[]> {
  await page.goto("/julianjoseph", SLOW);
  return page.getByRole("list", { name: "Event types" }).getByRole("link").allInnerTexts();
}

test.describe("scheduling: event types", () => {
  test.beforeEach(async ({ api, seed, page, loginAs }) => {
    await api.reset();
    await seed("owner");
    await loginAs(page, OWNER);
  });

  test("shows Calendly's card parts, copies links and lists the kebab items in order", async ({ page, axe, baseURL }) => {
    const errors = trackPageErrors(page);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
    await open(page);
    await expect(page.getByRole("heading", { level: 1, name: "Scheduling" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Event types" })).toHaveAttribute("aria-current", "page");
    expect(await cardNames(page)).toEqual(NAMES);

    // Section header: the user's name, link with copy, "View landing page".
    const host = new URL(baseURL!).host;
    await expect(page.getByText("Julian Joseph", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: `${host}/julianjoseph` })).toHaveAttribute("href", `${baseURL}/julianjoseph`);
    await expect(page.getByRole("link", { name: "View landing page" })).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("link", { name: "Manage availability" })).toHaveAttribute("href", "/app/availability");

    // Card: meta line, availability summary, View booking page.
    const thirty = card(page, "30 Minute Virtual");
    await expect(thirty).toContainText("30 min, Google Meet, One-on-One");
    await expect(thirty.getByRole("link", { name: "View booking page for 30 Minute Virtual" })).toHaveAttribute("href", `${baseURL}/julianjoseph/30min`);
    await expect(card(page, "In-Person Meal or Coffee")).toContainText(/2 hrs?, In-person meeting \(8\), Ask invitee, One-on-One/);

    // Copy link: "Copied" for 2 seconds, "Link copied" toast, the event URL on the clipboard (ET-04).
    await thirty.getByRole("button", { name: "Copy link" }).click();
    await expect(thirty.getByRole("button", { name: "Copied" })).toBeVisible();
    await expect(page.getByText("Link copied").first()).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${baseURL}/julianjoseph/30min`);
    await expect(thirty.getByRole("button", { name: "Copy link" })).toBeVisible({ timeout: 5_000 });

    // Share modal: the link and its own Copy link button.
    await thirty.getByRole("button", { name: "Share 30 Minute Virtual" }).click();
    const share = page.getByRole("dialog", { name: "Share 30 Minute Virtual" });
    await expect(share.getByRole("textbox", { name: "Booking link" })).toHaveValue(`${baseURL}/julianjoseph/30min`);
    await share.getByRole("button", { name: "Done" }).click();
    await expect(share).toBeHidden();

    // Kebab menu in the ET-05 order (minus the skipped team, embed and language items), keyboard navigable.
    const menu = await menuOf(page, "60 Minute Virtual");
    const items = await menu.locator('[role="menuitem"], [role="menuitemcheckbox"]').allInnerTexts();
    expect(items.map((t) => t.replace(/\s+/g, " ").trim())).toEqual([
      "View booking page",
      "Edit",
      "Add internal note",
      "Make secret",
      "Duplicate",
      "Delete",
      "On/Off On",
    ]);
    await expect(menu.getByRole("menuitemcheckbox", { name: "On/Off" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: "Edit" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(card(page, "60 Minute Virtual").getByRole("button", { name: "60 Minute Virtual actions" })).toBeFocused();

    await axe(page);

    // The card opens the editor (outside its controls) and Edit does too.
    await card(page, "60 Minute Virtual").getByText("1 hr, Google Meet, One-on-One").click();
    await expect(page).toHaveURL(/\/app\/event-types\/[0-9a-f-]{36}$/, SLOW);
    expect(errors).toEqual([]);
  });

  test("creates a one-on-one from the + Create menu", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Create" }).first().click();
    await page.getByRole("menuitem", { name: /One-on-one/ }).click();
    await expect(page).toHaveURL(/\/app\/event-types\/new\?kind=one_on_one$/, SLOW);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name: "New Meeting" })).toBeVisible(SLOW);
    await page.getByLabel("Event name").fill("Strategy Session");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/app\/event-types\/[0-9a-f-]{36}$/, SLOW);
    await open(page);
    expect(await cardNames(page)).toEqual([...NAMES, "Strategy Session"]);
    await expect(card(page, "Strategy Session")).toContainText("30 min, One-on-One");
  });

  test("turns off, makes secret, adds a note, duplicates and deletes from the kebab menu", async ({ page, browser, baseURL, axe }) => {
    await open(page);

    // On/Off (ET-09): Off badge, hidden from the landing page, the booking link shows the unavailable state.
    let menu = await menuOf(page, "60 Minute Virtual");
    await menu.getByRole("menuitemcheckbox", { name: "On/Off" }).click();
    await expect(menu.getByRole("menuitemcheckbox", { name: "On/Off" })).toHaveAttribute("aria-checked", "false");
    await page.keyboard.press("Escape");
    await expect(card(page, "60 Minute Virtual").getByText("Off", { exact: true })).toBeVisible();
    await expect(page.getByText("Event type turned off").first()).toBeVisible();

    // Make secret (ET-10): the slashed eye, hidden from the landing page.
    menu = await menuOf(page, "30 Minute Virtual");
    await menu.getByRole("menuitem", { name: "Make secret" }).click();
    await expect(card(page, "30 Minute Virtual").getByRole("img", { name: "Secret event type" })).toBeVisible();
    await expect(page.getByText("Event type is now secret").first()).toBeVisible();
    menu = await menuOf(page, "30 Minute Virtual");
    await expect(menu.getByRole("menuitem", { name: "Make public" })).toBeVisible();
    await page.keyboard.press("Escape");

    // Internal note (ET-13).
    menu = await menuOf(page, "In-Person Meal or Coffee");
    await menu.getByRole("menuitem", { name: "Add internal note" }).click();
    const note = page.getByRole("dialog", { name: "Add internal note" });
    await note.getByRole("textbox", { name: "Internal note" }).fill("Pick a quiet place");
    await note.getByRole("button", { name: "Save" }).click();
    await expect(card(page, "In-Person Meal or Coffee")).toContainText("Pick a quiet place");

    // Survives a reload.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(card(page, "60 Minute Virtual").getByText("Off", { exact: true })).toBeVisible();
    await expect(card(page, "30 Minute Virtual").getByRole("img", { name: "Secret event type" })).toBeVisible();
    await expect(card(page, "In-Person Meal or Coffee")).toContainText("Pick a quiet place");
    // The Off and secret states keep AA contrast.
    await axe(page);
    // What invitees see (signed out): only the public, active event type, and the off one is unavailable.
    const visitor = await browser.newContext({ baseURL });
    const invitee = await visitor.newPage();
    expect(await landingNames(invitee)).toEqual(["In-Person Meal or Coffee"]);
    await invitee.goto("/julianjoseph/60min", SLOW);
    await expect(invitee.getByText("This event type is not currently available")).toBeVisible();
    await visitor.close();

    // Duplicate (ET-11): the copy appears right after the original.
    await open(page);
    menu = await menuOf(page, "In-Person Meal or Coffee");
    await menu.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.getByText("Event type duplicated").first()).toBeVisible();
    await expect(card(page, "In-Person Meal or Coffee (copy)")).toBeVisible(SLOW);
    expect(await cardNames(page)).toEqual([...NAMES, "In-Person Meal or Coffee (copy)"]);

    // Delete (ET-12) with Calendly's confirmation.
    menu = await menuOf(page, "In-Person Meal or Coffee (copy)");
    await menu.getByRole("menuitem", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete event type?" });
    await expect(confirm).toContainText("Users will be unable to schedule further meetings with deleted event types. Meetings previously scheduled will not be affected.");
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(confirm).toBeHidden();
    await expect(card(page, "In-Person Meal or Coffee (copy)")).toHaveCount(0);
    // Focus moves to the closest remaining card instead of falling back to the page (GEN-05).
    await expect(card(page, "In-Person Meal or Coffee").getByRole("link", { name: "In-Person Meal or Coffee", exact: true })).toBeFocused();
    await page.reload();
    expect(await cardNames(page)).toEqual(NAMES);
  });

  test("reorders with the keyboard and the mouse; the landing page follows", async ({ page }) => {
    await open(page);
    const handle = page.getByRole("button", { name: "Reorder In-Person Meal or Coffee" });

    // Escape cancels a keyboard move.
    await handle.focus();
    await page.keyboard.press("Space");
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowUp");
    expect(await cardNames(page)).toEqual(["30 Minute Virtual", "In-Person Meal or Coffee", "60 Minute Virtual"]);
    await page.keyboard.press("Escape");
    expect(await cardNames(page)).toEqual(NAMES);
    await expect(page.getByText("Reorder canceled.", { exact: false })).toBeAttached();

    // Space lifts, arrows move, Space drops; focus stays on the handle.
    await handle.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(handle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(handle).toHaveAttribute("aria-pressed", "false");
    expect(await cardNames(page)).toEqual(["In-Person Meal or Coffee", "30 Minute Virtual", "60 Minute Virtual"]);
    await expect(page.getByText("In-Person Meal or Coffee dropped at position 1 of 3.")).toBeAttached();

    await expect.poll(async () => {
      await open(page);
      return cardNames(page);
    }, SLOW).toEqual(["In-Person Meal or Coffee", "30 Minute Virtual", "60 Minute Virtual"]);
    expect(await landingNames(page)).toEqual(["In-Person Meal or Coffee", "30 Minute Virtual", "60 Minute Virtual"]);

    // Mouse: Escape during a drag puts the card back.
    await open(page);
    await card(page, "30 Minute Virtual").hover();
    const grip = (await page.getByRole("button", { name: "Reorder 30 Minute Virtual" }).boundingBox())!;
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y - 120, { steps: 4 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await cardNames(page)).toEqual(["In-Person Meal or Coffee", "30 Minute Virtual", "60 Minute Virtual"]);
    // A short drag released over its own card neither moves it nor opens the editor.
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 60, grip.y + grip.height / 2 + 10, { steps: 3 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/app\/scheduling$/);
    expect(await cardNames(page)).toEqual(["In-Person Meal or Coffee", "30 Minute Virtual", "60 Minute Virtual"]);

    // Mouse: drag 60 Minute Virtual onto the top half of the first card.
    await card(page, "60 Minute Virtual").hover();
    const first = card(page, "In-Person Meal or Coffee");
    const box = (await first.boundingBox())!;
    await page.getByRole("button", { name: "Reorder 60 Minute Virtual" }).dragTo(first, { targetPosition: { x: box.width / 2, y: 8 } });
    await expect.poll(() => cardNames(page)).toEqual(["60 Minute Virtual", "In-Person Meal or Coffee", "30 Minute Virtual"]);
    await expect.poll(async () => {
      await open(page);
      return cardNames(page);
    }, SLOW).toEqual(["60 Minute Virtual", "In-Person Meal or Coffee", "30 Minute Virtual"]);
  });

  test("search filters by name or link as you type and the filters live in the URL", async ({ page }) => {
    await open(page);
    const search = page.getByRole("searchbox", { name: "Search event types" });
    await search.fill("virtual");
    await expect.poll(() => cardNames(page)).toEqual(["30 Minute Virtual", "60 Minute Virtual"]);
    await expect(page).toHaveURL(/\/app\/scheduling\?q=virtual$/);
    // Reorder is off while a search hides part of the list.
    await expect(page.getByRole("button", { name: /^Reorder / })).toHaveCount(0);
    await search.fill("meal");
    await expect.poll(() => cardNames(page)).toEqual(["In-Person Meal or Coffee"]);

    // Filter menu: Status Off (none are off yet), then the empty result and Clear.
    await search.fill("");
    await expect.poll(() => cardNames(page)).toEqual(NAMES);
    await page.getByRole("button", { name: "Filter" }).click();
    await page.getByRole("radio", { name: "Off" }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "No event types match your search." })).toBeVisible();
    await expect(page).toHaveURL(/\?status=off$/);

    // The URL restores the view.
    await open(page, "/app/scheduling?q=60min&status=on");
    await expect(search).toHaveValue("60min");
    expect(await cardNames(page)).toEqual(["60 Minute Virtual"]);
    await expect(page.getByRole("button", { name: "Filter, 1 applied" })).toBeVisible();
    await page.getByRole("button", { name: "Clear search and filters" }).first().click();
    await expect.poll(() => cardNames(page)).toEqual(NAMES);
    await expect(page).toHaveURL(/\/app\/scheduling$/);
  });

  test("bulk toggles and bulk deletes with one confirmation, then shows the empty state", async ({ page, axe }) => {
    await open(page);
    await card(page, "30 Minute Virtual").getByRole("checkbox", { name: "Select 30 Minute Virtual" }).click();
    await card(page, "60 Minute Virtual").getByRole("checkbox", { name: "Select 60 Minute Virtual" }).click();
    const bar = page.getByRole("toolbar", { name: "Bulk actions" });
    await expect(bar).toContainText("2 selected");

    // Toggle on/off: all on, so all off; again: all on.
    await bar.getByRole("button", { name: /Toggle on\/off/ }).click();
    await expect(page.getByText("2 event types turned off").first()).toBeVisible();
    await expect(card(page, "30 Minute Virtual").getByText("Off", { exact: true })).toBeVisible();
    await expect(card(page, "60 Minute Virtual").getByText("Off", { exact: true })).toBeVisible();
    await expect(card(page, "In-Person Meal or Coffee").getByText("Off", { exact: true })).toHaveCount(0);
    await bar.getByRole("button", { name: /Toggle on\/off/ }).click();
    await expect(page.getByText("2 event types turned on").first()).toBeVisible();
    await expect(list(page).getByText("Off", { exact: true })).toHaveCount(0);

    // Clear empties the selection.
    await bar.getByRole("button", { name: "Clear" }).click();
    await expect(bar).toBeHidden();

    // Delete all three: one confirmation.
    for (const name of NAMES) await card(page, name).getByRole("checkbox", { name: `Select ${name}` }).click();
    await expect(bar).toContainText("3 selected");
    await bar.getByRole("button", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete 3 event types?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("3 event types deleted").first()).toBeVisible();

    // ET-33 empty state, with focus on its call to action.
    await expect(page.getByRole("heading", { name: "Create scheduling links with event types" })).toBeVisible();
    await expect(page.getByRole("link", { name: "New event type" })).toBeFocused();
    await expect(page.getByText("Event types are templates for meetings you'll want to schedule regularly, like product demos, customer calls, or office hours.")).toBeVisible();
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: "Create scheduling links with event types" })).toBeVisible();
    await axe(page);
    await page.getByRole("link", { name: "New event type" }).click();
    await expect(page).toHaveURL(/\/app\/event-types\/new\?kind=one_on_one$/, SLOW);
  });

  test("phone layout: cards stack without horizontal scrolling, with 40px tap targets and keyboard reorder", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    expect(await cardNames(page)).toEqual(NAMES);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const thirty = card(page, "30 Minute Virtual");
    const targets = [
      thirty.getByRole("button", { name: "Copy link" }),
      thirty.getByRole("button", { name: "Share 30 Minute Virtual" }),
      thirty.getByRole("button", { name: "30 Minute Virtual actions" }),
      thirty.getByRole("button", { name: "Reorder 30 Minute Virtual" }),
      thirty.locator("label").filter({ has: page.getByRole("checkbox", { name: "Select 30 Minute Virtual" }) }),
    ];
    for (const target of targets) {
      const b = (await target.boundingBox())!;
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(40);
    }
    const box = (await thirty.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    const menu = await menuOf(page, "30 Minute Virtual");
    await expect(menu.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
    await page.keyboard.press("Escape");

    // The reorder handle is reachable at phone widths too (keyboard).
    const handle = page.getByRole("button", { name: "Reorder 30 Minute Virtual" });
    await handle.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    expect(await cardNames(page)).toEqual(["60 Minute Virtual", "30 Minute Virtual", "In-Person Meal or Coffee"]);

    await thirty.getByRole("checkbox", { name: "Select 30 Minute Virtual" }).click();
    const bar = page.getByRole("toolbar", { name: "Bulk actions" });
    await expect(bar).toBeVisible();
    const barBox = (await bar.boundingBox())!;
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(390);
    await expect.poll(async () => {
      await open(page);
      return cardNames(page);
    }, SLOW).toEqual(["60 Minute Virtual", "30 Minute Virtual", "In-Person Meal or Coffee"]);
  });

  test("a list made stale by another tab: refused changes reload it and bulk actions skip what is gone", async ({ page }) => {
    await open(page);
    const deleteInOtherTab = async (name: string) => {
      const other = await page.context().newPage();
      await open(other);
      const m = await menuOf(other, name);
      await m.getByRole("menuitem", { name: "Delete" }).click();
      const confirm = other.getByRole("alertdialog", { name: "Delete event type?" });
      await confirm.getByRole("button", { name: "Delete" }).click();
      await expect(confirm).toBeHidden();
      await expect(card(other, name)).toHaveCount(0);
      await other.close();
    };

    // This tab still shows a type deleted elsewhere: turning it off is refused and the list reloads without it.
    await deleteInOtherTab("60 Minute Virtual");
    expect(await cardNames(page)).toEqual(NAMES);
    const menu = await menuOf(page, "60 Minute Virtual");
    await menu.getByRole("menuitemcheckbox", { name: "On/Off" }).click();
    await expect(page.getByText("This event type could not be found.").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect.poll(() => cardNames(page), SLOW).toEqual(["30 Minute Virtual", "In-Person Meal or Coffee"]);

    // A bulk delete whose selection includes a type deleted elsewhere still deletes the rest.
    await deleteInOtherTab("In-Person Meal or Coffee");
    for (const name of ["30 Minute Virtual", "In-Person Meal or Coffee"]) await card(page, name).getByRole("checkbox", { name: `Select ${name}` }).click();
    const bar = page.getByRole("toolbar", { name: "Bulk actions" });
    await bar.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("alertdialog", { name: "Delete 2 event types?" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("2 event types deleted").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Create scheduling links with event types" })).toBeVisible();
  });

  test.describe("touch screen", () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test("drags a card by its handle with a finger; the landing page follows", async ({ page }) => {
      await open(page);
      const expected = ["60 Minute Virtual", "30 Minute Virtual", "In-Person Meal or Coffee"];
      const handle = page.getByRole("button", { name: "Reorder 60 Minute Virtual" });
      // No hover on touch screens: the handle always shows.
      await expect(handle).toHaveCSS("opacity", "1");
      await card(page, "30 Minute Virtual").evaluate((el) => el.scrollIntoView({ block: "start" }));
      const from = (await handle.boundingBox())!;
      const first = (await card(page, "30 Minute Virtual").boundingBox())!;
      const x = from.x + from.width / 2;
      const y = from.y + from.height / 2;
      const toY = first.y + 6;
      expect(y).toBeLessThan(844);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let i = 1; i <= 6; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + ((toY - y) * i) / 6 }] });
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect.poll(() => cardNames(page)).toEqual(expected);
      await expect(page.getByText("60 Minute Virtual dropped at position 1 of 3.")).toBeAttached();
      await expect.poll(async () => {
        await open(page);
        return cardNames(page);
      }, SLOW).toEqual(expected);
      expect(await landingNames(page)).toEqual(expected);
    });

    test("a tap on the handle is not a drag", async ({ page }) => {
      await open(page);
      await page.getByRole("button", { name: "Reorder 60 Minute Virtual" }).tap();
      expect(await cardNames(page)).toEqual(NAMES);
      await expect(page).toHaveURL(/\/app\/scheduling$/);
    });
  });
});
