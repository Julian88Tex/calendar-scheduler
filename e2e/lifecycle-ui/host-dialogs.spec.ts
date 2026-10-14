// Host meeting dialogs on the E2E fixture page /reschedulings/host-dialogs-fixture against the seeded demo meetings
// (SPEC CR-06, CR-07, CR-08, CR-11, CR-14): "Cancel event" with a message that reaches the invitee as the reason,
// "Reschedule meeting now" with the host's slot picker (one reschedule email), "Share new times to meet" (cancels and
// emails a "Pick a new time" link that opens the rebook flow), "Mark as no-show" only after the start with undo, and
// host-only meeting notes that never show on the invitee's pages.
import type { Locator, Page } from "@playwright/test";
import { expect, test, type TestApi } from "../fixtures";

const NOW = "2030-10-07T13:00:00Z"; // Monday 06:00 Los Angeles
const SLOW = { timeout: 60_000 };
const OWNER = "owner@example.com";
const FIXTURE = "/reschedulings/host-dialogs-fixture";

type Seeded = { demoData: { scheduledEventIds: string[]; inviteeIds: string[] } };

// Demo meetings (scripts/seed-data.ts, owner zone Los Angeles): 1) 30 Minute Virtual with Maya Patel on Wednesday,
// October 9 at 11:00am; 2) 60 Minute Virtual with Daniel Okafor on Monday, October 14 at 1:00pm; 3) In-Person Meal
// or Coffee with Maya Patel on Wednesday, October 16 at 5:30pm.
function card(page: Page, scheduledEventId: string): Locator {
  return page.getByTestId(`fixture-meeting-${scheduledEventId}`);
}

async function waitEmail(api: TestApi, to: string, template: string) {
  return api.waitForEmail((e) => e.template === template && e.to.includes(to), { to, timeoutMs: 30_000 });
}

test.describe("host meeting dialogs", () => {
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

  test("the fixture page is behind a sign-in", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(FIXTURE, SLOW);
    await expect(page).toHaveURL(/\/login/);
  });

  test("cancels with a message to the invitee (CR-06)", async ({ page, api, axe }) => {
    const [, second] = seeded.demoData.scheduledEventIds;
    await page.goto(FIXTURE, SLOW);
    const c = card(page, second!);
    await expect(c.getByTestId("meeting-brief")).toContainText("60 Minute Virtual");
    await c.getByRole("button", { name: "Cancel", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel event" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("meeting-brief")).toContainText("1:00pm - 2:00pm, Monday, October 14, 2030");
    await expect(dialog.getByTestId("meeting-brief")).toContainText("Daniel Okafor");
    await axe(page, { include: "[role=dialog]" });
    await dialog.getByRole("textbox", { name: "Add a cancellation message" }).fill("Something urgent came up");
    await dialog.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(page.getByText("Event canceled")).toBeVisible(SLOW);
    await expect(dialog).toBeHidden();
    await expect(c.getByText("Canceled", { exact: true })).toBeVisible(SLOW);
    const email = await waitEmail(api, "daniel.okafor@example.com", "lifecycle.invitee_canceled");
    expect(email.text).toContain("Something urgent came up");
  });

  test("reschedules now with the host's slot picker (CR-07)", async ({ page, api, axe }) => {
    const [first] = seeded.demoData.scheduledEventIds;
    await page.goto(FIXTURE, SLOW);
    await card(page, first!).getByRole("button", { name: "Reschedule" }).click();
    const dialog = page.getByRole("dialog", { name: "Reschedule event" });
    await expect(dialog.getByRole("radio", { name: /Reschedule meeting now/ })).toBeChecked();
    await expect(dialog.getByRole("radio", { name: /Share new times to meet/ })).toBeEnabled();
    await axe(page, { include: "[role=dialog]" });
    await dialog.getByRole("button", { name: "Next" }).click();
    const picker = page.getByRole("dialog", { name: "Reschedule meeting now" });
    await expect(picker.getByText("Times are shown in Pacific Time - US & Canada.")).toBeVisible();
    // The invitee's zone toggle (Maya Patel is in New York).
    await picker.getByRole("button", { name: "Switch to your invitee's time zone" }).click();
    await expect(picker.getByText("Times are shown in Eastern Time - US & Canada.")).toBeVisible();
    await picker.getByRole("button", { name: "Switch to my time zone" }).click();
    const day = picker.getByRole("button", { name: "Thursday, October 10 - Times available" });
    await expect(day).toBeEnabled(SLOW);
    await day.click();
    await picker.getByRole("list", { name: "Select a time" }).getByRole("button", { name: "1:00pm" }).click();
    await expect(picker.getByTestId("new-time")).toHaveText("New time: 1:00pm - 1:30pm, Thursday, October 10, 2030");
    await axe(page, { include: "[role=dialog]" });
    await picker.getByRole("button", { name: "Reschedule", exact: true }).click();
    await expect(page.getByText("Meeting rescheduled")).toBeVisible(SLOW);
    const email = await waitEmail(api, "maya.patel@example.com", "lifecycle.invitee_rescheduled");
    expect(email.subject).toContain("Thursday, October 10, 2030");
    const all = (await api.outbox({ to: "maya.patel@example.com" })).filter((e) => e.template === "lifecycle.invitee_rescheduled");
    expect(all).toHaveLength(1);
  });

  test("shares new times to meet and the invitee picks a new time (CR-08)", async ({ page, api }) => {
    const [, , third] = seeded.demoData.scheduledEventIds;
    await page.goto(FIXTURE, SLOW);
    await card(page, third!).getByRole("button", { name: "Reschedule" }).click();
    const dialog = page.getByRole("dialog", { name: "Reschedule event" });
    await dialog.getByRole("radio", { name: /Share new times to meet/ }).click();
    await dialog.getByRole("button", { name: "Next" }).click();
    const share = page.getByRole("dialog", { name: "Share new times to meet" });
    await share.getByRole("textbox", { name: "Message to Maya Patel" }).fill("My week changed, sorry!");
    await share.getByRole("combobox", { name: "Reminder" }).selectOption("3");
    await share.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Request sent to Maya Patel")).toBeVisible(SLOW);
    const email = await waitEmail(api, "maya.patel@example.com", "lifecycle.request_reschedule");
    expect(email.subject).toBe("Julian Joseph would like to reschedule");
    expect(email.text).toContain("My week changed, sorry!");
    const link = email.links.find((l) => l.includes("/reschedulings/"));
    expect(link).toBeTruthy();

    // The invitee opens "Pick a new time": the booking flow of the same event type, booking again.
    await page.context().clearCookies();
    await page.goto(new URL(link!).pathname, SLOW);
    await expect(page.getByText("Julian Joseph asked you to pick a new time for this meeting.")).toBeVisible(SLOW);
    await expect(page.getByTestId("former-when")).toHaveText("8:30pm - 10:30pm, Wednesday, October 16, 2030");
    await expect(page.getByRole("heading", { name: "Select a Date & Time" })).toBeVisible();
  });

  test("marks a no-show only after the start, with undo, and keeps notes host-only (CR-11, CR-14)", async ({ page, api }) => {
    const [first] = seeded.demoData.scheduledEventIds;
    const [firstInvitee] = seeded.demoData.inviteeIds;
    await page.goto(FIXTURE, SLOW);
    const c = card(page, first!);
    await expect(c.getByTestId("meeting-brief")).toBeVisible(SLOW);
    // Before the start time there is no no-show control.
    await expect(c.getByTestId("mark-no-show")).toHaveCount(0);

    // Notes: add, save, see them after a reload.
    await c.getByRole("button", { name: "Add meeting notes" }).click();
    const editor = c.getByRole("textbox", { name: "Meeting notes" });
    await editor.click();
    await page.keyboard.type("Prepare the Q4 roadmap deck");
    await c.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Notes saved")).toBeVisible(SLOW);
    await page.reload();
    await expect(card(page, first!).getByTestId("meeting-notes-html")).toHaveText("Prepare the Q4 roadmap deck", SLOW);
    // Never on the invitee's pages.
    await page.goto(`/cancellations/${firstInvitee}`, SLOW);
    await expect(page.getByRole("heading", { name: "Cancel Event?" })).toBeVisible(SLOW);
    await expect(page.getByText("Prepare the Q4 roadmap deck")).toHaveCount(0);

    // After the start: mark, then undo.
    await api.setTime("2030-10-09T18:05:00Z"); // 11:05am Los Angeles
    await page.goto(FIXTURE, SLOW);
    const after = card(page, first!);
    await after.getByTestId("mark-no-show").click();
    const confirm = page.getByRole("alertdialog", { name: "Mark Maya Patel as a no-show?" });
    await confirm.getByRole("button", { name: "Mark as no-show" }).click();
    await expect(page.getByText("Marked Maya Patel as a no-show")).toBeVisible(SLOW);
    await expect(after.getByTestId("no-show-marked")).toContainText("No-show");
    await page.reload();
    await expect(card(page, first!).getByTestId("no-show-marked")).toBeVisible(SLOW);
    await card(page, first!).getByRole("button", { name: "Undo no-show for Maya Patel" }).click();
    await expect(page.getByText("No-show removed")).toBeVisible(SLOW);
    await expect(card(page, first!).getByTestId("mark-no-show")).toBeVisible();
  });
});
