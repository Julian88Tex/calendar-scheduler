// Availability (SPEC AV-01 to AV-11, AV-14; docs/SCOPE.md priorities 2 and 4) on the seeded owner: weekly hours
// auto-save and survive reload, overlapping times show the error and are not saved, "Copy times to...", date-specific
// hours (specific hours, unavailable, delete), the schedule time zone, schedule create / set as default / delete with
// reassignment, meeting limits rows, the Troubleshoot view with a named calendar conflict, and the phone layout.
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

const OWNER = "owner@example.com";

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

const saved = (page: Page) => page.getByRole("status").filter({ hasText: "Saved" });

/** Navigates and waits until the client components hydrated (a click before hydration is lost in dev mode). */
async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.readyState === "complete");
}

async function reload(page: Page) {
  await page.reload();
  await page.waitForLoadState("networkidle");
}

async function setTime(page: Page, name: string, value: string) {
  const input = page.getByRole("combobox", { name, exact: true });
  await input.click();
  await input.fill(value);
  await input.press("Tab");
}

test.describe("availability schedules", () => {
  let seeded: { owner: { eventTypeIds: Record<string, string>; scheduleIds: Record<string, string> } };

  test.beforeEach(async ({ api, seed, page, loginAs }) => {
    await api.reset();
    seeded = (await seed("owner")) as typeof seeded;
    await loginAs(page, OWNER);
  });

  test("weekly hours auto-save, survive reload, and overlaps are not saved", async ({ page, axe }) => {
    // The first test of the run also compiles the page in dev mode.
    test.setTimeout(150_000);
    const errors = trackPageErrors(page);
    await open(page, "/app/availability");
    await expect(page.getByRole("heading", { name: "Availability", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Schedules" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: /Working hours \(default\)/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Weekly hours" })).toBeVisible();
    await expect(page.getByText("Set when you are typically available for meetings")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Monday start time", exact: true })).toHaveValue("12:00pm");
    await expect(page.getByRole("listitem", { name: "Saturday" }).getByText("Unavailable")).toBeVisible();
    await expect(page.getByRole("button", { name: /Active on: 2 event types/ })).toBeVisible();

    await setTime(page, "Monday start time", "9");
    await expect(page.getByRole("combobox", { name: "Monday start time", exact: true })).toHaveValue("9:00am");
    await expect(saved(page)).toBeVisible();
    await reload(page);
    await expect(page.getByRole("combobox", { name: "Monday start time", exact: true })).toHaveValue("9:00am");

    // "+" adds 6:00pm to 7:00pm after 9:00am to 5:00pm (saved); editing it to overlap shows the error and is not saved.
    await page.getByRole("button", { name: "Add new interval to Monday" }).click();
    await expect(page.getByRole("combobox", { name: "Monday start time 2", exact: true })).toHaveValue("6:00pm");
    await expect(saved(page)).toBeVisible();
    await setTime(page, "Monday start time 2", "3:00pm");
    await expect(page.getByText("Times overlap with another set of times.")).toBeVisible();
    await page.waitForTimeout(1200);
    await reload(page);
    await expect(page.getByRole("combobox", { name: "Monday start time 2", exact: true })).toHaveValue("6:00pm");

    // Inverted interval: the end must be later than the start.
    await setTime(page, "Monday end time 2", "5:30pm");
    await expect(page.getByText("Choose an end time later than the start time.")).toBeVisible();
    await page.getByRole("button", { name: /^Remove 6:00pm - 5:30pm from Monday$/ }).click();
    await expect(saved(page)).toBeVisible();
    await reload(page);
    await expect(page.getByRole("combobox", { name: "Monday start time 2", exact: true })).toHaveCount(0);

    await axe(page);
    expect(errors).toEqual([]);
  });

  test("copy times to other days", async ({ page }) => {
    await open(page, "/app/availability");
    await page.getByRole("button", { name: "Copy Monday times to other days" }).click();
    const pop = page.getByRole("dialog", { name: "Copy Monday times" });
    await expect(pop.getByText("Copy times to...")).toBeVisible();
    await expect(pop.getByRole("checkbox", { name: "Monday" })).toBeDisabled();
    for (const d of ["Tuesday", "Wednesday", "Thursday", "Friday"]) await pop.getByRole("checkbox", { name: d }).click();
    await pop.getByRole("button", { name: "Apply" }).click();
    await expect(saved(page)).toBeVisible();
    await reload(page);
    for (const d of ["Tuesday", "Wednesday", "Thursday", "Friday"]) {
      await expect(page.getByRole("combobox", { name: `${d} start time`, exact: true })).toHaveValue("12:00pm");
      await expect(page.getByRole("combobox", { name: `${d} end time`, exact: true })).toHaveValue("5:00pm");
    }
  });

  test("date-specific hours: add hours, mark unavailable, delete", async ({ page }) => {
    await open(page, "/app/availability");
    await expect(page.getByRole("heading", { name: "Date-specific hours" })).toBeVisible();
    await page.getByRole("button", { name: "Hours", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Select the date(s) you want to assign specific hours" });
    await modal.getByRole("button", { name: "Go to next month" }).click();
    const days = modal.getByRole("button", { pressed: false }).filter({ hasText: /^(15|16)$/ });
    await days.first().click();
    await days.first().click();
    await expect(modal.getByText("2 dates selected")).toBeVisible();
    await setTime(page, "Selected dates end time", "1:00pm");
    await modal.getByRole("button", { name: "Apply" }).click();
    await expect(modal).toBeHidden();
    const list = page.getByRole("list", { name: "Date-specific hours" });
    await expect(list.getByText("9:00am - 1:00pm")).toHaveCount(2);
    await reload(page);
    await expect(list.getByText("9:00am - 1:00pm")).toHaveCount(2);

    // Edit the first date: remove every interval to mark it unavailable.
    await list.getByRole("button", { name: /^Edit / }).first().click();
    const edit = page.getByRole("dialog", { name: "Select the date(s) you want to assign specific hours" });
    await edit.getByRole("button", { name: /^Remove 9:00am - 1:00pm/ }).click();
    await expect(edit.getByText("Unavailable")).toBeVisible();
    await edit.getByRole("button", { name: "Apply" }).click();
    await expect(list.getByText("Unavailable")).toHaveCount(1);
    await reload(page);
    await expect(list.getByText("Unavailable")).toHaveCount(1);

    await list.getByRole("button", { name: /^Delete / }).first().click();
    await expect(list.getByText("Unavailable")).toHaveCount(0);
    await reload(page);
    await expect(page.getByRole("list", { name: "Date-specific hours" }).getByText("9:00am - 1:00pm")).toHaveCount(1);
  });

  test("changing the schedule time zone saves", async ({ page }) => {
    await open(page, "/app/availability");
    await expect(page.getByText("Traveling? Add date-specific hours in the local time of your trip.")).toBeVisible();
    const zone = page.getByRole("button", { name: "Time zone", exact: true });
    await expect(zone).toContainText("Pacific Time - US & Canada");
    await zone.click();
    await page.getByRole("combobox", { name: "Search" }).fill("Eastern");
    await page.getByRole("option", { name: /Eastern Time - US & Canada/ }).click();
    await expect(saved(page)).toBeVisible();
    await reload(page);
    await expect(page.getByRole("button", { name: "Time zone", exact: true })).toContainText("Eastern Time - US & Canada");
    // Wall-clock hours stay the same.
    await expect(page.getByRole("combobox", { name: "Monday start time", exact: true })).toHaveValue("12:00pm");
  });

  test("create, set as default and delete schedules with reassignment", async ({ page }) => {
    await open(page, "/app/availability");
    await page.getByRole("button", { name: /Working hours \(default\)/ }).click();
    await page.getByRole("menuitem", { name: "Create schedule" }).click();
    const dialog = page.getByRole("dialog", { name: "New schedule" });
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog.getByText("Enter a schedule name.")).toBeVisible();
    await dialog.getByLabel("Schedule name").fill("Evenings");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page).toHaveURL(/schedule=/);
    await expect(page.getByRole("button", { name: /^Schedule Evenings$/ })).toBeVisible();
    // The new schedule starts with the default's hours.
    await expect(page.getByRole("combobox", { name: "Monday start time", exact: true })).toHaveValue("12:00pm");

    await page.getByRole("button", { name: "Schedule options" }).click();
    await page.getByRole("menuitem", { name: "Set as default" }).click();
    await expect(page.getByRole("button", { name: /Evenings \(default\)/ })).toBeVisible();
    await page.getByRole("button", { name: "Schedule options" }).click();
    await expect(page.getByRole("menuitem", { name: /Delete/ })).toHaveAttribute("data-disabled", "");
    await page.keyboard.press("Escape");

    // Block Off Work is used by the meal event type: deleting asks for a replacement.
    await page.getByRole("button", { name: /Evenings \(default\)/ }).click();
    await page.getByRole("menuitem", { name: "Block Off Work" }).click();
    await expect(page.getByRole("button", { name: /^Schedule Block Off Work$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Active on: 1 event type/ })).toBeVisible();
    await page.getByRole("button", { name: "Schedule options" }).click();
    await page.getByRole("menuitem", { name: /Delete/ }).click();
    const del = page.getByRole("dialog", { name: "Delete schedule?" });
    await expect(del.getByText("1 event type uses this schedule. Choose the schedule it should use instead:")).toBeVisible();
    await del.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Schedule deleted")).toBeVisible();
    await expect(page.getByRole("button", { name: /Evenings \(default\)/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Active on: 2 event types|Active on: 1 event type/ })).toBeVisible();
    await page.getByRole("button", { name: /Evenings \(default\)/ }).click();
    await expect(page.getByRole("menuitem", { name: "Block Off Work" })).toHaveCount(0);
  });

  test("Active on assigns an event type to a schedule", async ({ page }) => {
    await open(page, `/app/availability?schedule=${seeded.owner.scheduleIds.block_off_work}`);
    await page.getByRole("button", { name: /Active on: 1 event type/ }).click();
    const pop = page.getByRole("dialog", { name: "Active on" });
    await pop.getByRole("checkbox", { name: "60 Minute Virtual" }).click();
    await pop.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByRole("button", { name: /Active on: 2 event types/ })).toBeVisible();
    await open(page, "/app/availability");
    await expect(page.getByRole("button", { name: /Active on: 1 event type/ })).toBeVisible();
  });

  test("calendar view edits one date", async ({ page, api, loginAs }) => {
    // Moving the clock ends the session started in beforeEach: sign in again at the new time.
    await api.setTime("2030-10-08T15:00:00Z");
    await loginAs(page, OWNER);
    await open(page, "/app/availability?view=calendar");
    await expect(page.getByRole("radio", { name: "Calendar" })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("button", { name: "Go to next month" }).click();
    const cell = page.getByRole("button", { pressed: false }).filter({ hasText: /^20/ }).first();
    await cell.click();
    await expect(page.getByText("1 date selected")).toBeVisible();
    await page.getByRole("button", { name: "Edit date", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /^Remove / }).first().click();
    await dialog.getByRole("button", { name: "Apply" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("radio", { name: "List" }).click();
    await expect(page.getByRole("list", { name: "Date-specific hours" }).getByText("Unavailable")).toHaveCount(1);
  });
});

test.describe("advanced settings and troubleshoot", () => {
  test.beforeEach(async ({ api, seed, page, loginAs }) => {
    await api.reset();
    await seed("owner");
    await loginAs(page, OWNER);
  });

  test("meeting limit rows auto-save", async ({ page, axe }) => {
    await open(page, "/app/availability/advanced");
    await expect(page.getByRole("link", { name: "Advanced settings" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: "Meeting limits" })).toBeVisible();
    await page.getByRole("button", { name: "Add a meeting limit" }).click();
    const input = page.getByRole("textbox", { name: "Max number of meetings" });
    await expect(input).toHaveValue("1");
    await expect(saved(page)).toBeVisible();
    await input.fill("3");
    await expect(saved(page)).toBeVisible();
    await page.getByRole("button", { name: "Add a meeting limit" }).click();
    await expect(page.getByRole("textbox", { name: "Max number of meetings" })).toHaveCount(2);
    await page.getByRole("textbox", { name: "Max number of meetings" }).nth(1).fill("");
    await expect(page.getByText("Enter a number from 1 to 999.")).toBeVisible();
    await page.getByRole("textbox", { name: "Max number of meetings" }).nth(1).fill("10");
    await expect(saved(page)).toBeVisible();
    await reload(page);
    await expect(page.getByRole("textbox", { name: "Max number of meetings" }).first()).toHaveValue("3");
    await expect(page.getByRole("textbox", { name: "Max number of meetings" }).nth(1)).toHaveValue("10");
    await expect(page.getByText(/scheduled today/)).toBeVisible();
    await page.getByRole("button", { name: "Remove the limit per week" }).click();
    await expect(saved(page)).toBeVisible();
    await reload(page);
    await expect(page.getByRole("textbox", { name: "Max number of meetings" })).toHaveCount(1);
    await axe(page);
  });

  test("troubleshoot shows every start time with the reason", async ({ page, api, axe, loginAs }) => {
    test.setTimeout(120_000);
    const errors = trackPageErrors(page);
    const seededIds = (await api.seed("owner")) as { owner: { eventTypeIds: Record<string, string> } };
    // Tuesday 2030-10-08 08:00 in Los Angeles; Dentist 1:00pm to 2:00pm on the (fake) calendar. Moving the clock ends
    // the session started in beforeEach: sign in again at the new time.
    await api.setTime("2030-10-08T15:00:00Z");
    await loginAs(page, OWNER);
    await api.fakeCalendar({ email: OWNER, events: [{ start: "2030-10-08T20:00:00Z", end: "2030-10-08T21:00:00Z", title: "Dentist" }] });

    await open(page, "/app/availability");
    await page.getByRole("link", { name: "Troubleshoot" }).click();
    await expect(page.getByRole("heading", { name: "Troubleshoot availability" })).toBeVisible();

    await open(page, `/app/availability/advanced/troubleshoot?eventType=${seededIds.owner.eventTypeIds["30min"]}&date=2030-10-08`);
    await expect(page.getByRole("heading", { name: "Tuesday, October 8, 2030" })).toBeVisible();
    const card = page.getByRole("list", { name: "30 Minute Virtual start times" });
    await expect(card.getByRole("button", { name: /^12:00am to / })).toBeVisible();
    await expect(card.getByText(/Outside your working hours/).first()).toBeVisible();
    await expect(card.getByRole("button", { name: /^12:30pm, unavailable: Your 15 min buffer after this time overlaps "Dentist" \(1:00pm - 2:00pm\)\./ })).toBeVisible();
    await expect(card.getByRole("button", { name: /^2:00pm, unavailable: Your 15 min buffer before this time overlaps "Dentist"/ })).toBeVisible();
    await expect(card.getByRole("button", { name: /TOOSOON Too soon: invitees must schedule at least 4 hours in advance/ })).toBeVisible();
    // The starts the event covers collapse into one CALENDAR row; expanding it lists each start.
    const calendarRun = card.getByRole("button", { name: /^12:45pm to 1:45pm CALENDAR Conflicts with "Dentist" on your calendar \(1:00pm - 2:00pm\)\./ });
    await expect(calendarRun).toBeVisible();
    await calendarRun.click();
    await expect(calendarRun).toHaveAttribute("aria-expanded", "true");
    await card.getByRole("button", { name: /^1:00pm, unavailable: Conflicts with "Dentist"/ }).click();
    const sheet = page.getByRole("dialog", { name: /1:00pm · 30 Minute Virtual/ });
    await expect(sheet.getByText('Change the event to "Free" or remove it.')).toBeVisible();
    await expect(sheet.getByText("Dentist", { exact: true })).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).first().click();

    await page.getByRole("radio", { name: "Available", exact: true }).click();
    await expect(card.getByText("CALENDAR")).toHaveCount(0);
    await axe(page);
    expect(errors).toEqual([]);
  });
});

test.describe("phone layout", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("schedules and troubleshoot fit a phone without horizontal scroll", async ({ page, api, seed, loginAs }) => {
    await api.reset();
    await seed("owner");
    await loginAs(page, OWNER);
    for (const path of ["/app/availability", "/app/availability/advanced", "/app/availability/advanced/troubleshoot", "/app/availability?view=calendar"]) {
      await open(page, path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
    await open(page, "/app/availability");
    const weekly = await page.getByRole("heading", { name: "Weekly hours" }).boundingBox();
    const dates = await page.getByRole("heading", { name: "Date-specific hours" }).boundingBox();
    expect(dates!.y).toBeGreaterThan(weekly!.y);
    await setTime(page, "Monday start time", "10am");
    await expect(saved(page)).toBeVisible();
  });
});
