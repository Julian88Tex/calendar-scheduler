// Meetings page on the seeded owner with the demo meetings (SPEC MT-01, MT-02, MT-05, MT-06, MT-08, MT-11, MT-15,
// CR-06, CR-11; walkthrough 10.1): tabs in the URL, date headers and rows, Details with ?event= and its blocks, cancel
// with a message, "Mark as no-show" on a past meeting, filters and search, the CSV export, empty states and the phone
// layout with the details sheet.
//
// Demo meetings (scripts/seed-data.ts, owner zone Los Angeles, clock Monday, October 7, 2030 at 6:00am):
// 1) 30 Minute Virtual with Maya Patel, Wednesday, October 9 at 11:00am; 2) 60 Minute Virtual with Daniel Okafor,
// Monday, October 14 at 1:00pm; 3) In-Person Meal or Coffee with Maya Patel, Wednesday, October 16 at 5:30pm.
import fs from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

const NOW = "2030-10-07T13:00:00Z";
const OWNER = "owner@example.com";
const SLOW = { timeout: 60_000 };

type Seeded = { demoData: { scheduledEventIds: string[]; inviteeIds: string[] } };

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** Opens a page and waits for hydration (clicks before hydration are lost in dev mode). */
async function open(page: Page, url = "/app/meetings") {
  await page.goto(url, SLOW);
  await page.waitForLoadState("networkidle");
}

const row = (page: Page, id: string) => page.getByTestId(`meeting-row-${id}`);

test.describe("meetings page", () => {
  let seeded: Seeded;

  test.beforeEach(async ({ api, seed, page, loginAs }) => {
    await api.reset();
    await api.setTime(NOW);
    seeded = (await seed("owner", { demo: true })) as unknown as Seeded;
    await loginAs(page, OWNER);
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test("lists upcoming meetings by day, switches tabs and expands details (MT-01, MT-05, MT-06)", async ({ page, axe }) => {
    const errors = trackPageErrors(page);
    const [first, second, third] = seeded.demoData.scheduledEventIds;
    await open(page);
    await expect(page.getByRole("heading", { level: 1, name: "Meetings" })).toBeVisible();
    await expect(page.getByTestId("meetings-counter")).toHaveText("Displaying 1 - 3 of 3 Events");
    await expect(page.getByRole("heading", { level: 2, name: "Wednesday, October 9, 2030" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Monday, October 14, 2030" })).toBeVisible();
    const r1 = row(page, first!);
    await expect(r1).toContainText("11:00am - 11:30am");
    await expect(r1).toContainText("Maya Patel");
    await expect(r1).toContainText("Event type 30 Minute Virtual");
    await expect(r1).toContainText("1 host | 0 non-hosts");
    await expect(row(page, second!)).toContainText("Daniel Okafor");
    await expect(row(page, third!)).toContainText("In-Person Meal or Coffee");
    await axe(page);

    // Details: inline, deep linked.
    await r1.getByTestId("meeting-details-toggle").click();
    await expect(page).toHaveURL(new RegExp(`event=${first}`));
    const details = r1.getByTestId("meeting-details");
    await expect(details.getByTestId("meeting-email")).toContainText("maya.patel@example.com");
    await expect(details.getByTestId("meeting-location")).toContainText("Google Meet");
    await expect(details).toContainText("Eastern Time - US & Canada");
    await expect(details.getByTestId("meeting-questions")).toContainText("What would you like to discuss?");
    await expect(details.getByTestId("meeting-questions")).toContainText("Roadmap review for the Q4 launch.");
    await expect(details.getByTestId("meeting-hosts")).toContainText("Julian Joseph");
    await expect(details.getByRole("button", { name: "Reschedule" })).toBeVisible();
    await expect(details.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
    await expect(details.getByRole("button", { name: "Mark as no-show" })).toHaveCount(0);
    await expect(details).toContainText(/Created \d{2}\/\d{2}\/\d{4} by Maya Patel/);
    await axe(page);

    // The deep link survives a reload.
    await page.reload();
    await expect(row(page, first!).getByTestId("meeting-details")).toBeVisible(SLOW);

    // The venue of the in-person meeting.
    await row(page, third!).getByTestId("meeting-details-toggle").click();
    await expect(row(page, third!).getByTestId("meeting-location")).toContainText("Sunrise Coffee House - Noe Valley - $");
    await expect(row(page, third!).getByTestId("meeting-location")).toContainText("4001 24th Street, San Francisco, CA 94114");

    await page.getByTestId("meetings-tab-past").click();
    await expect(page).toHaveURL(/tab=past/);
    await expect(page.getByRole("heading", { name: "No Past Events" })).toBeVisible(SLOW);
    await expect(page.getByRole("button", { name: "Share your link" })).toBeVisible();

    await page.getByTestId("meetings-tab-range").click();
    await expect(page).toHaveURL(/tab=range/);
    await expect(page.getByTestId("meetings-range")).toBeVisible(SLOW);
    await expect(page.getByTestId("meetings-counter")).toHaveText("Displaying 1 - 3 of 3 Events");
    await page.getByRole("button", { name: /^Date range/ }).click();
    await page.getByRole("button", { name: "Next week" }).click();
    await expect(page).toHaveURL(/start=2030-10-13&end=2030-10-19/);
    await expect(page.getByTestId("meetings-counter")).toHaveText("Displaying 1 - 2 of 2 Events", SLOW);
    expect(errors).toEqual([]);
  });

  test("cancels a meeting with a message (CR-06) and finds it under Canceled events", async ({ page, api }) => {
    const [, second] = seeded.demoData.scheduledEventIds;
    await open(page, `/app/meetings?event=${second}`);
    const r = row(page, second!);
    await r.getByRole("button", { name: "Cancel", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel event" });
    await expect(dialog.getByTestId("meeting-brief")).toContainText("1:00pm - 2:00pm, Monday, October 14, 2030");
    await dialog.getByRole("textbox", { name: "Add a cancellation message" }).fill("Something urgent came up");
    await dialog.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(page.getByText("Event canceled")).toBeVisible(SLOW);
    await expect(row(page, second!)).toHaveCount(0, SLOW);
    await expect(page.getByTestId("meetings-counter")).toHaveText("Displaying 1 - 2 of 2 Events");
    // The focus is not lost with the removed row, and the deep link's own "Canceled events" did not open the filters.
    await expect(page.getByTestId("meetings-list")).toBeFocused();
    await expect(page.getByTestId("meetings-filters")).toHaveCount(0);

    // Status filter: Canceled events.
    await page.getByTestId("meetings-filter-toggle").click();
    await page.getByRole("button", { name: /^Status/ }).click();
    await page.getByRole("checkbox", { name: "Canceled events" }).click();
    await expect(page).toHaveURL(/status=active%2Ccanceled|status=active,canceled/, SLOW);
    await page.keyboard.press("Escape");
    const canceled = row(page, second!);
    await expect(canceled).toContainText("Canceled", SLOW);
    await canceled.getByTestId("meeting-details-toggle").click();
    await expect(canceled.getByTestId("notice-canceled")).toContainText("Canceled by Julian Joseph (host)");
    await expect(canceled.getByTestId("notice-canceled")).toContainText("Reason: Something urgent came up");
    await expect(canceled.getByRole("link", { name: /Schedule Invitee Again/ })).toHaveAttribute("href", /\/julianjoseph\/60min\?name=Daniel\+Okafor&email=daniel\.okafor%40example\.com/);
    const email = await api.waitForEmail((e) => e.template === "lifecycle.invitee_canceled" && e.to.includes("daniel.okafor@example.com"), { to: "daniel.okafor@example.com", timeoutMs: 30_000 });
    expect(email.text).toContain("Something urgent came up");
  });

  test("reschedules from the details and opens the new meeting (CR-07)", async ({ page }) => {
    const [first] = seeded.demoData.scheduledEventIds;
    await open(page, `/app/meetings?event=${first}`);
    await row(page, first!).getByRole("button", { name: "Reschedule" }).click();
    const dialog = page.getByRole("dialog", { name: "Reschedule event" });
    await dialog.getByRole("button", { name: "Next" }).click();
    const picker = page.getByRole("dialog", { name: "Reschedule meeting now" });
    const day = picker.getByRole("button", { name: "Thursday, October 10 - Times available" });
    await expect(day).toBeEnabled(SLOW);
    await day.click();
    await picker.getByRole("list", { name: "Select a time" }).getByRole("button", { name: "1:00pm" }).click();
    await picker.getByRole("button", { name: "Reschedule", exact: true }).click();
    await expect(page.getByText("Meeting rescheduled")).toBeVisible(SLOW);
    await expect(page).toHaveURL(/event=/, SLOW);
    await expect(row(page, first!)).toHaveCount(0, SLOW);
    const fresh = page.getByTestId("meeting-details");
    await expect(fresh.getByTestId("notice-rescheduled_from")).toContainText("Rescheduled from 11:00am - 11:30am, Wednesday, October 9, 2030", SLOW);
    await expect(page.getByTestId("meeting-details-panel")).toBeFocused();
    await expect(page.getByRole("heading", { level: 2, name: "Thursday, October 10, 2030" })).toBeVisible();

    // The former meeting is canceled with the "Rescheduled" badge and links to the new time.
    await fresh.getByRole("button", { name: "View former time" }).click();
    const old = row(page, first!);
    await expect(old).toContainText("Rescheduled", SLOW);
    await expect(old.getByTestId("notice-rescheduled_to")).toContainText("Rescheduled to 1:00pm - 1:30pm, Thursday, October 10, 2030");
  });

  test("marks a past meeting as a no-show and adds notes (CR-11, CR-14)", async ({ page, api }) => {
    const [first] = seeded.demoData.scheduledEventIds;
    // Wednesday, October 9 at noon in Los Angeles: the 11:00am meeting has ended.
    await api.setTime("2030-10-09T19:00:00Z");
    await open(page, "/app/meetings?tab=past");
    const r = row(page, first!);
    await expect(r).toContainText("Maya Patel");
    await r.getByTestId("meeting-details-toggle").click();
    await expect(r.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
    await r.getByRole("button", { name: "Mark as no-show" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Mark Maya Patel as a no-show?" });
    await confirm.getByRole("button", { name: "Mark as no-show" }).click();
    await expect(r.getByTestId("no-show-marked")).toContainText("No-show", SLOW);

    await r.getByRole("button", { name: "Add meeting notes" }).click();
    const editor = r.getByRole("textbox", { name: "Meeting notes" });
    await editor.click();
    await page.keyboard.type("Follow up next week.");
    await r.getByTestId("notes-save").click();
    await expect(page.getByText("Notes saved")).toBeVisible(SLOW);
    await page.reload();
    await expect(row(page, first!).getByTestId("meeting-notes-html")).toContainText("Follow up next week.", SLOW);
    await expect(row(page, first!).getByTestId("no-show-marked")).toBeVisible();
  });

  test("filters by event type and searches (MT-08)", async ({ page }) => {
    const [first, second, third] = seeded.demoData.scheduledEventIds;
    await open(page);
    await page.getByTestId("meetings-filter-toggle").click();
    await page.getByRole("searchbox", { name: "Search by invitee name, invitee email or event name" }).fill("daniel");
    await expect(page).toHaveURL(/q=daniel/, SLOW);
    await expect(row(page, second!)).toBeVisible();
    await expect(row(page, first!)).toHaveCount(0);
    await page.getByRole("button", { name: "Clear all filters" }).click();
    await expect(row(page, first!)).toBeVisible(SLOW);

    // "Filter by Event Type" from the details.
    await row(page, third!).getByTestId("meeting-details-toggle").click();
    await row(page, third!).getByRole("button", { name: "Filter by Event Type" }).click();
    await expect(page).toHaveURL(/eventTypes=/, SLOW);
    await expect(page.getByTestId("meetings-counter")).toHaveText("Displaying 1 - 1 of 1 Events");
    await expect(page.getByRole("button", { name: /^Event Types: In-Person Meal or Coffee/ })).toBeVisible();
  });

  test("exports the current tab as CSV (MT-11)", async ({ page }) => {
    await open(page);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("meetings-export").click()]);
    expect(download.suggestedFilename()).toBe("meetings-upcoming-2030-10-07.csv");
    const text = fs.readFileSync((await download.path())!, "utf8").replace(/^﻿/, "");
    const lines = text.split("\r\n").filter(Boolean);
    expect(lines[0]!.startsWith("User Name,Team,Invitee Name,Invitee First Name,Invitee Last Name,Invitee Email,")).toBe(true);
    expect(lines[0]!.endsWith("User Email,Event UUID,Invitee UUID,Invitee scheduled by,Scheduling method")).toBe(true);
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("Maya Patel");
    expect(lines[1]).toContain("2030-10-09 11:00:00 -07:00");
  });

  test("phone layout opens details in a sheet", async ({ page, axe }) => {
    const [first] = seeded.demoData.scheduledEventIds;
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await expect(row(page, first!)).toContainText("Maya Patel");
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await row(page, first!).getByTestId("meeting-details-toggle").click();
    const sheet = page.getByRole("dialog", { name: "Maya Patel" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("meeting-email")).toContainText("maya.patel@example.com");
    await expect(sheet.getByRole("button", { name: "Reschedule" })).toBeVisible();
    await axe(page, { include: "[role=dialog]" });
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    await expect(page).not.toHaveURL(/event=/);

    // A deep link on a phone opens the sheet; the inline panel is for wider screens only.
    await open(page, `/app/meetings?event=${first}`);
    await expect(page.getByRole("dialog", { name: "Maya Patel" })).toBeVisible(SLOW);
    await expect(page.getByTestId("meeting-details-panel")).toHaveCount(0);
  });
});
