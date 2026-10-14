// Invitee cancel and reschedule pages in the real Next server (SPEC CR-02, CR-03, CR-05, SCH-24, BK-07, BK-08, BK-09,
// GEN-04, GEN-05, GEN-08; docs/SCOPE.md priority 6): book the seeded 30 minute event, follow the Reschedule link of
// the confirmation email (Former Time struck through, prefilled details, "Reason for change", "Update Event", no
// verification), land on "You are rescheduled", open the old links (redirected to the new invitee), cancel through the
// Cancel link ("Cancellation Confirmed") and see the slot free again; the event type turned off refuses the reschedule
// while the cancel page still cancels; both pages deny framing; axe and the phone layout.
import type { Page } from "@playwright/test";
import { expect, test, type OutboxEmail, type TestApi } from "../fixtures";

const NOW = "2030-10-07T13:00:00Z"; // Monday 06:00 Los Angeles, 09:00 New York (the browser zone)
const SLOW = { timeout: 60_000 };
const OWNER = "owner@example.com";

type Seeded = { owner: { userId: string; slug: string; eventTypeIds: Record<string, string> } };

async function book(page: Page, email: string, dayLabel: string, time: string): Promise<string> {
  await page.goto("/julianjoseph/30min", SLOW);
  const day = page.getByRole("button", { name: dayLabel });
  await expect(day).toBeEnabled(SLOW);
  await day.click();
  await page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: time }).click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Enter Details" })).toBeVisible(SLOW);
  await page.waitForTimeout(2100); // BK-18: the booking form refuses submissions within 2 seconds of rendering
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("Ana Lima");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByRole("textbox", { name: "What would you like to discuss?", exact: true }).fill("Roadmap review");
  await page.getByRole("button", { name: "Schedule Event" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "You are scheduled" })).toBeVisible(SLOW);
  const id = /\/booking\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
  expect(id).toBeTruthy();
  return id!;
}

async function emailTo(api: TestApi, to: string, template: string): Promise<OutboxEmail> {
  return api.waitForEmail((e) => e.template === template && e.to.includes(to), { to, timeoutMs: 30_000 });
}

function linkOf(email: OutboxEmail, part: string): string {
  const link = email.links.find((l) => l.includes(part));
  expect(link, `${part} link in ${email.template}`).toBeTruthy();
  return new URL(link!).pathname;
}

test.describe("invitee cancel and reschedule pages", () => {
  let seeded: Seeded;

  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await api.setTime(NOW);
    seeded = (await seed("owner")) as unknown as Seeded;
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test("reschedules from the email link, redirects old links, then cancels from the email link", async ({ page, api, axe }) => {
    const email = "ana.lifecycle@example.com";
    const firstId = await book(page, email, "Monday, October 7 - Times available", "3:00pm");
    const confirmation = await emailTo(api, email, "lifecycle.invitee_confirmation");
    const reschedulePath = linkOf(confirmation, "/reschedulings/");
    expect(reschedulePath).toBe(`/reschedulings/${firstId}`);

    // The reschedule page: never framed, the booking calendar with the former time struck through.
    const res = await page.goto(reschedulePath, SLOW);
    expect(res?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res?.headers()["x-frame-options"]).toBe("DENY");
    await expect(page.getByRole("heading", { name: "Select a Date & Time" })).toBeVisible(SLOW);
    const former = page.getByTestId("former-time");
    await expect(former).toContainText("Former Time");
    await expect(page.getByTestId("former-when")).toHaveText("3:00pm - 3:30pm, Monday, October 7, 2030");
    expect(await page.getByTestId("former-when").evaluate((el) => el.tagName)).toBe("S");
    await expect(page.getByRole("heading", { level: 1, name: "30 Minute Virtual" })).toBeVisible();
    await axe(page);

    // SCH-24: the meeting being moved does not block its own day; pick a new time.
    const day = page.getByRole("button", { name: "Tuesday, October 8 - Times available" });
    await expect(day).toBeEnabled(SLOW);
    await day.click();
    await page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: "2:00pm" }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/reschedulings/${firstId}/2030-10-08T18:00:00Z\\?month=2030-10&date=2030-10-08$`));
    await expect(page.getByRole("heading", { name: "Enter Details" })).toBeVisible();
    await expect(page.getByTestId("details-when")).toHaveText("2:00pm - 2:30pm, Tuesday, October 8, 2030");
    await expect(page.getByTestId("former-when")).toHaveText("3:00pm - 3:30pm, Monday, October 7, 2030");
    // Prefilled from the booking (all editable), no email verification step.
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Ana Lima");
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveValue(email);
    await expect(page.getByRole("textbox", { name: "What would you like to discuss?", exact: true })).toHaveValue("Roadmap review");
    await page.getByRole("textbox", { name: "Reason for change" }).fill("A conflict came up");
    await axe(page);
    await page.getByRole("button", { name: "Update Event" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "You are rescheduled" })).toBeVisible(SLOW);
    const newId = /\/booking\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(firstId);
    await expect(page.getByTestId("confirmation-when")).toHaveText("2:00pm - 2:30pm, Tuesday, October 8, 2030");
    const updated = await emailTo(api, email, "lifecycle.invitee_rescheduled");
    expect(updated.subject).toBe("Updated: 30 Minute Virtual with Julian Joseph on Tuesday, October 8, 2030");
    expect(updated.text).toContain("A conflict came up");

    // Old links follow the reschedule chain to the active invitee (CR-02).
    await page.goto(reschedulePath, SLOW);
    await expect(page).toHaveURL(new RegExp(`/reschedulings/${newId}$`));
    await expect(page.getByTestId("former-when")).toHaveText("2:00pm - 2:30pm, Tuesday, October 8, 2030");
    const oldCancel = linkOf(confirmation, "/cancellations/");
    await page.goto(oldCancel, SLOW);
    await expect(page).toHaveURL(new RegExp(`/cancellations/${newId}$`));

    // The cancel page: summary in the invitee's zone, "Cancel Event?", reason, "Cancel Event".
    await expect(page.getByRole("heading", { name: "Cancel Event?" })).toBeVisible(SLOW);
    await expect(page.getByTestId("summary-when")).toHaveText("2:00pm - 2:30pm, Tuesday, October 8, 2030");
    await expect(page.getByTestId("summary-zone")).toHaveText("Eastern Time - US & Canada");
    await axe(page);
    await page.getByRole("textbox", { name: "Reason for canceling" }).fill("Plans changed");
    await page.getByRole("button", { name: "Cancel Event" }).click();
    await expect(page.getByRole("heading", { name: "Cancellation Confirmed" })).toBeVisible(SLOW);
    await expect(page.getByText("Your meeting with Julian Joseph has been canceled.")).toBeVisible();
    await expect(page.getByTestId("schedule-another")).toHaveAttribute("href", "/julianjoseph/30min");
    const canceledEmail = await emailTo(api, email, "lifecycle.invitee_canceled");
    expect(canceledEmail.text).toContain("Plans changed");

    // The slot is free again on the booking page.
    await page.goto("/julianjoseph/30min?month=2030-10&date=2030-10-08", SLOW);
    await expect(page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: "2:00pm" })).toBeVisible(SLOW);

    // Coming back: the canceled state (cancel) and "can no longer be rescheduled" (reschedule).
    await page.goto(`/cancellations/${newId}`, SLOW);
    await expect(page.getByRole("heading", { name: "This event has already been canceled." })).toBeVisible(SLOW);
    await page.goto(`/reschedulings/${newId}`, SLOW);
    await expect(page.getByRole("heading", { name: "This event can no longer be rescheduled." })).toBeVisible(SLOW);
    await expect(page.getByText("This event has already been canceled.")).toBeVisible();
  });

  test("an event type turned off refuses the reschedule while the cancel page still cancels", async ({ page, api, loginAs, axe }) => {
    const email = "ben.lifecycle@example.com";
    const id = await book(page, email, "Monday, October 7 - Times available", "4:00pm");
    await emailTo(api, email, "lifecycle.invitee_confirmation");

    // The host turns the event type off in the editor.
    await loginAs(page, OWNER);
    await page.goto(`/app/event-types/${seeded.owner.eventTypeIds["30min"]}`, SLOW);
    await page.getByRole("button", { name: "Event type actions" }).click();
    await page.getByRole("menuitemcheckbox", { name: "On/Off" }).click();
    await expect(page.getByText("Event type turned off")).toBeVisible(SLOW);
    await page.context().clearCookies();

    const res = await page.goto(`/reschedulings/${id}`, SLOW);
    expect(res?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
    await expect(page.getByRole("heading", { name: "This event can no longer be rescheduled." })).toBeVisible(SLOW);
    await expect(page.getByTestId("summary-when")).toHaveText("4:00pm - 4:30pm, Monday, October 7, 2030");
    await axe(page);
    await page.getByRole("link", { name: "Cancel Event" }).click();
    await expect(page).toHaveURL(new RegExp(`/cancellations/${id}$`));
    await expect(page.getByRole("heading", { name: "Cancel Event?" })).toBeVisible(SLOW);
    await page.getByRole("button", { name: "Cancel Event" }).click();
    await expect(page.getByRole("heading", { name: "Cancellation Confirmed" })).toBeVisible(SLOW);
    // The booking page is off: "Schedule another event" opens the landing page.
    await expect(page.getByTestId("schedule-another")).toHaveAttribute("href", "/julianjoseph");
  });

  test("unknown ids are 404, past meetings say they already occurred, and the phone layout works", async ({ page, api }) => {
    const missing = await page.goto("/cancellations/4b0c9f3e-0000-4000-8000-000000000000", SLOW);
    expect(missing?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "This page isn't available" })).toBeVisible();
    await expect(page.getByText("The link may be broken or the meeting may have been removed.")).toBeVisible();
    expect((await page.goto("/reschedulings/not-an-id", SLOW))?.status()).toBe(404);
    expect((await page.goto("/reschedulings/4b0c9f3e-0000-4000-8000-000000000000/not-a-start", SLOW))?.status()).toBe(404);

    const email = "cy.lifecycle@example.com";
    await page.setViewportSize({ width: 390, height: 844 });
    const id = await book(page, email, "Monday, October 7 - Times available", "3:00pm");

    // Phone: the reschedule calendar, then the separate times view, without horizontal scrolling.
    await page.goto(`/reschedulings/${id}`, SLOW);
    await expect(page.getByTestId("former-when")).toBeVisible(SLOW);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const day = page.getByRole("button", { name: "Wednesday, October 9 - Times available" });
    await expect(day).toBeEnabled(SLOW);
    await day.click();
    await expect(page.getByRole("list", { name: "Select a time" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto(`/cancellations/${id}`, SLOW);
    await expect(page.getByRole("button", { name: "Cancel Event" })).toBeVisible(SLOW);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // After the start time: "This event has already occurred." (CR-02), and no reschedule.
    await api.setTime("2030-10-07T19:05:00Z");
    await page.goto(`/cancellations/${id}`, SLOW);
    await expect(page.getByRole("heading", { name: "This event has already occurred." })).toBeVisible(SLOW);
    await page.goto(`/reschedulings/${id}`, SLOW);
    await expect(page.getByRole("heading", { name: "This event can no longer be rescheduled." })).toBeVisible(SLOW);
    await expect(page.getByText("This event has already occurred.")).toBeVisible();
  });
});
