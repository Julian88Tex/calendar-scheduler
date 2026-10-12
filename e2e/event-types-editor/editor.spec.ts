// Event type editor (SPEC ET-10 to ET-29, ET-33; docs/SCOPE.md: one-on-one event types) on the seeded owner: create a
// one-on-one with locations and questions, the live preview, the unsaved changes guard, availability and limits,
// make secret, duplicate and delete from the editor kebab, the owner's meal event with 9 locations, and the phone
// layout with the preview toggle.
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

const OWNER = "owner@example.com";
const SLOW = { timeout: 60_000 };

type Seeded = { owner: { eventTypeIds: Record<string, string>; scheduleIds: Record<string, string> } };

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Navigates and waits for hydration (clicks before hydration are lost in dev mode). */
async function open(page: Page, url: string) {
  await page.goto(url, SLOW);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: "Save changes" }).or(page.getByRole("button", { name: "Close", exact: true }))).toBeVisible(SLOW);
}

/** Expands a section row (its button name starts with the title). */
async function section(page: Page, title: string) {
  const trigger = page.getByRole("button", { name: new RegExp(`^${title}`) }).first();
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
}

async function moreOptions(page: Page) {
  const more = page.getByRole("button", { name: "More options" }).first();
  if (await more.isVisible()) await more.click();
}

async function chooseOption(page: Page, comboboxName: string | RegExp, option: string) {
  await page.getByRole("combobox", { name: comboboxName }).first().click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved").first()).toBeVisible(SLOW);
}

test.describe("event type editor", () => {
  let seeded: Seeded;

  test.beforeEach(async ({ api, seed, page, loginAs }) => {
    await api.reset();
    seeded = (await seed("owner")) as Seeded;
    await loginAs(page, OWNER);
  });

  test("creates a one-on-one with locations and questions; the preview follows the draft", async ({ page, axe }) => {
    test.setTimeout(240_000);
    const errors = trackPageErrors(page);
    await open(page, "/app/event-types/new?kind=one_on_one");
    await expect(page.getByText("One-on-One", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "New Meeting" })).toBeVisible();

    // Live preview of the unsaved type (ARCHITECTURE 17.1).
    const preview = page.frameLocator('iframe[title="Booking page preview"]');
    await expect(preview.getByTestId("preview-banner")).toBeVisible(SLOW);
    await page.getByLabel("Event name").fill("Strategy Session");
    await expect(preview.getByRole("heading", { level: 1, name: "Strategy Session" })).toBeVisible({ timeout: 5_000 });

    // Duration: 45 min default plus a 15 min option (the first common duration not offered yet).
    await section(page, "Duration");
    await chooseOption(page, "Duration", "45 min");
    await page.getByRole("button", { name: "Add duration option" }).click();
    await expect(page.getByRole("combobox", { name: "Duration option 2" })).toBeVisible();

    // Location: an in-person venue with notes and address, then Google Meet.
    await section(page, "Location");
    await page.getByRole("group", { name: "Location types" }).getByRole("button", { name: "In-person" }).click();
    const dialog = page.getByRole("dialog", { name: "In-person meeting" });
    await dialog.getByRole("textbox", { name: "Location", exact: true }).fill("Harbor Bistro - Waterfront\n[Business Casual Dress Code]");
    await dialog.getByRole("textbox", { name: "Additional information" }).fill("250 Embarcadero, San Francisco, CA 94111");
    await dialog.getByRole("button", { name: "Add location" }).click();
    await expect(page.getByRole("list", { name: "Locations" }).getByText("Harbor Bistro - Waterfront")).toBeVisible();
    await page.getByRole("button", { name: "Add a location" }).click();
    await page.getByRole("menuitem", { name: "Google Meet" }).click();
    await expect(page.getByRole("list", { name: "Locations" }).getByRole("listitem")).toHaveCount(2);
    await expect(page.getByText("Invitees choose one of these locations when they book.")).toBeVisible();

    // Invitee form: a required radio question.
    await moreOptions(page);
    await section(page, "Invitee form");
    await page.getByRole("button", { name: "Add new question" }).click();
    const q = page.getByRole("dialog", { name: "Add new question" });
    await q.getByRole("textbox", { name: "Question", exact: true }).fill("Which topic?");
    await q.getByRole("checkbox", { name: "Required" }).check();
    await chooseOption(page, "Answer type", "Radio buttons");
    await q.getByRole("textbox", { name: "Answer choice 1" }).fill("Pricing");
    await q.getByRole("button", { name: "Add another" }).click();
    await q.getByRole("textbox", { name: "Answer choice 2" }).fill("Roadmap");
    await q.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("list", { name: "Questions" }).getByText("Which topic?")).toBeVisible();

    await axe(page, { exclude: ['iframe[title="Booking page preview"]'] });
    await save(page);
    await expect(page).toHaveURL(/\/app\/event-types\/[0-9a-f-]{36}$/, SLOW);

    // Everything survives a reload.
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name: "Strategy Session" })).toBeVisible(SLOW);
    await expect(page.getByRole("button", { name: /^Duration/ })).toContainText("45 min, 15 min");
    await expect(page.getByRole("button", { name: /^Location/ })).toContainText("In-person meeting, Google Meet");
    await moreOptions(page);
    await section(page, "Booking page options");
    await expect(page.getByRole("textbox", { name: "Event link" })).toHaveValue("strategy-session");
    await section(page, "Invitee form");
    await expect(page.getByRole("list", { name: "Questions" }).getByRole("listitem")).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test("unsaved changes ask before leaving; reload without saving keeps the old values", async ({ page }) => {
    test.setTimeout(180_000);
    await open(page, `/app/event-types/${seeded.owner.eventTypeIds["30min"]}`);
    await section(page, "Event name and color");
    await page.getByLabel("Event name").fill("Renamed but not saved");
    await page.getByRole("link", { name: "Event types" }).click();
    const guard = page.getByRole("alertdialog", { name: "You have unsaved changes" });
    await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: "Keep editing" }).click();
    await expect(page.getByLabel("Event name")).toHaveValue("Renamed but not saved");
    await page.getByRole("button", { name: "Cancel" }).click();
    await guard.getByRole("button", { name: "Discard changes" }).click();
    await expect(page).toHaveURL(/\/app\/scheduling$/, SLOW);
    await open(page, `/app/event-types/${seeded.owner.eventTypeIds["30min"]}`);
    await expect(page.getByRole("heading", { level: 1, name: "30 Minute Virtual" })).toBeVisible();
  });

  test("edits availability, limits and buffers", async ({ page }) => {
    test.setTimeout(180_000);
    const id = seeded.owner.eventTypeIds["30min"]!;
    await open(page, `/app/event-types/${id}`);
    await section(page, "Availability");
    await expect(page.getByText("Invitees can schedule")).toBeVisible();
    await chooseOption(page, "Schedule", "Block Off Work");
    await expect(page.getByRole("status").filter({ hasText: "Save to update availability" })).toBeVisible();

    await page.getByRole("button", { name: /^Minimum notice:/ }).click();
    await page.getByLabel("Notice amount").fill("1");
    await page.getByLabel("Notice unit").selectOption("days");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^Minimum notice:/ })).toHaveText(/1 day/);

    await page.getByRole("button", { name: /^Date range:/ }).click();
    await page.getByRole("spinbutton", { name: "Number of days" }).fill("30");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^Date range:/ })).toHaveText(/30 days/);

    await moreOptions(page);
    await section(page, "Limits and buffers");
    await chooseOption(page, "Before event", "30 min");
    await page.getByRole("button", { name: "Set limit" }).click();
    await page.getByLabel("Max number of meetings").fill("2");
    await expect(page.getByText("Meeting limits across all event types")).toBeVisible();
    await expect(page.getByRole("link", { name: "Set in Availability" })).toHaveAttribute("href", "/app/availability/advanced");
    await save(page);

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: /^Limits and buffers/ }).or(page.getByRole("button", { name: "More options" }).first())).toBeVisible(SLOW);
    await moreOptions(page);
    await expect(page.getByRole("button", { name: /^Limits and buffers/ })).toContainText("30 min before, 15 min after, max 2 per day");
    await section(page, "Availability");
    await expect(page.getByRole("button", { name: /^Minimum notice:/ })).toHaveText(/1 day/);
    await expect(page.getByRole("combobox", { name: "Schedule" })).toContainText("Block Off Work");
  });

  test("make secret, duplicate and delete from the editor kebab", async ({ page }) => {
    test.setTimeout(180_000);
    const id = seeded.owner.eventTypeIds["60min"]!;
    await open(page, `/app/event-types/${id}`);
    await page.getByRole("button", { name: "Event type actions" }).click();
    await page.getByRole("menuitem", { name: "Make secret" }).click();
    await expect(page.getByText("Event type is now secret").first()).toBeVisible();
    await expect(page.getByText("Secret", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Event type actions" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "60 Minute Virtual (copy)" })).toBeVisible(SLOW);
    expect(page.url()).not.toContain(id);

    await page.getByRole("button", { name: "Event type actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Delete event type?" });
    await expect(confirm).toContainText("Users will be unable to schedule further meetings with deleted event types.");
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(/\/app\/scheduling$/, SLOW);
  });

  test("the owner's meal event lists its 9 locations", async ({ page }) => {
    test.setTimeout(120_000);
    await open(page, `/app/event-types/${seeded.owner.eventTypeIds.meal}`);
    await expect(page.getByRole("button", { name: /^Location/ })).toContainText("In-person meeting (8), Ask invitee");
    await section(page, "Location");
    await expect(page.getByRole("list", { name: "Locations" }).getByRole("listitem")).toHaveCount(9);
    await expect(page.getByText("[Business Casual Dress Code]")).toBeVisible();
  });

  test("phone layout: full-width panel with a preview toggle", async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `/app/event-types/${seeded.owner.eventTypeIds["30min"]}`);
    const panel = page.getByRole("region", { name: "Event type settings" });
    const box = await panel.boundingBox();
    expect(Math.round(box?.width ?? 0)).toBe(390);
    await expect(page.locator('iframe[title="Booking page preview"]')).toBeHidden();
    await page.getByRole("button", { name: "Preview" }).click();
    await expect(page.locator('iframe[title="Booking page preview"]')).toBeVisible();
    await page.getByRole("button", { name: "Back to editor" }).click();
    await expect(panel).toBeVisible();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(390);
  });
});
