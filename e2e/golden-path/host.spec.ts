// Golden path, host side (docs/SCOPE.md priorities 2 to 5; SPEC MT-01, CR-06, CR-11, AV-01, AV-14, AV-18, NT-09,
// GEN-16): a booking shows in the Meetings list, the host cancels a meeting with a message and marks a past one as a
// no-show; weekly hours edits and a host meeting limit change what invitees can book; the Troubleshoot view names the
// reason of every blocked time (outside hours, the calendar event by title, buffers, notice, the meeting limit); and a
// booking's 24 hour reminder is scheduled in the jobs table (the instance admin's "past its send time" notice reads it
// when the dispatcher is late), sent once with its links, and moved when the invitee reschedules.
import { expect, test } from "../fixtures";
import { book, emailTo, linkOf, NOW, open, openDay, OWNER, SLOW, trackPageErrors, type Seeded } from "./helpers";

const saved = (page: import("@playwright/test").Page) => page.getByRole("status").filter({ hasText: "Saved" });

test.describe("golden path: host", () => {
  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test("meetings list: a new booking, cancel with a message, and a no-show", async ({ page, api, seed, loginAs }) => {
    test.setTimeout(240_000);
    await api.reset();
    await api.setTime(NOW);
    const seeded = (await seed("owner", { demo: true })) as unknown as Seeded;
    const errors = trackPageErrors(page);
    await book(page, { slug: "30min", dayLabel: "Monday, October 7 - Times available", time: "3:00pm", name: "Fay Wong", email: "fay.golden@example.com", answer: "Budget" });

    await loginAs(page, OWNER);
    await open(page, "/app/meetings");
    await expect(page.getByRole("heading", { level: 1, name: "Meetings" })).toBeVisible();
    await expect(page.getByTestId("meetings-counter")).toHaveText("Displaying 1 - 4 of 4 Events", SLOW);
    await expect(page.getByRole("heading", { level: 2, name: "Monday, October 7, 2030" })).toBeVisible();
    await expect(page.getByTestId("meetings-list")).toContainText("Fay Wong");

    // Cancel the 60 minute demo meeting with a message: the invitee is told why.
    const [, second] = seeded.demoData!.scheduledEventIds;
    await open(page, `/app/meetings?event=${second}`);
    const row = page.getByTestId(`meeting-row-${second}`);
    await row.getByRole("button", { name: "Cancel", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Cancel event" });
    await dialog.getByRole("textbox", { name: "Add a cancellation message" }).fill("Out sick today");
    await dialog.getByRole("button", { name: "Yes, cancel" }).click();
    await expect(page.getByText("Event canceled")).toBeVisible(SLOW);
    await expect(page.getByTestId(`meeting-row-${second}`)).toHaveCount(0, SLOW);
    const canceled = await emailTo(api, "daniel.okafor@example.com", "lifecycle.invitee_canceled");
    expect(canceled.text).toContain("Out sick today");
    expect(canceled.icsMethod).toBe("CANCEL");

    // After Monday's meeting: "Mark as no-show" in Past.
    await api.setTime("2030-10-07T20:00:00Z");
    await loginAs(page, OWNER);
    await open(page, "/app/meetings?tab=past");
    const past = page.getByTestId("meetings-list").getByTestId(/^meeting-row-/).filter({ hasText: "Fay Wong" });
    await expect(past).toHaveCount(1, SLOW);
    await past.getByTestId("meeting-details-toggle").click();
    await past.getByRole("button", { name: "Mark as no-show" }).click();
    await page.getByRole("alertdialog", { name: "Mark Fay Wong as a no-show?" }).getByRole("button", { name: "Mark as no-show" }).click();
    await expect(past.getByTestId("no-show-marked")).toContainText("No-show", SLOW);
    expect(errors).toEqual([]);
  });

  test("availability edits and a host meeting limit change what invitees can book; troubleshoot names the reasons", async ({ page, api, seed, loginAs, axe }) => {
    test.setTimeout(300_000);
    await api.reset();
    await api.setTime(NOW);
    const seeded = (await seed("owner")) as unknown as Seeded;
    await api.fakeCalendar({ email: OWNER, events: [{ start: "2030-10-09T19:00:00Z", end: "2030-10-09T20:00:00Z", title: "Dentist" }] });
    await loginAs(page, OWNER);

    // Monday's hours start at 1:00pm instead of 12:00pm (Los Angeles): the first start becomes 4:00pm in New York.
    await open(page, "/app/availability");
    const monday = page.getByRole("combobox", { name: "Monday start time", exact: true });
    await expect(monday).toHaveValue("12:00pm", SLOW);
    await monday.click();
    await monday.fill("1:00pm");
    await monday.press("Tab");
    await expect(saved(page)).toBeVisible(SLOW);
    const times = await openDay(page, "/julianjoseph/30min", "Monday, October 7 - Times available");
    await expect(times.getByRole("button").first()).toHaveText("4:00pm", SLOW);

    // A host meeting limit of 1 per day (Availability > Advanced): one Tuesday booking fills Tuesday for every type.
    await open(page, "/app/availability/advanced");
    await expect(page.getByRole("heading", { name: "Meeting limits" })).toBeVisible();
    await page.getByRole("button", { name: "Add a meeting limit" }).click();
    await expect(page.getByRole("textbox", { name: "Max number of meetings" })).toHaveValue("1");
    await expect(saved(page)).toBeVisible(SLOW);
    await page.context().clearCookies();
    await book(page, { slug: "60min", dayLabel: "Tuesday, October 8 - Times available", time: "2:00pm", name: "Gus Lee", email: "gus.golden@example.com" });
    await page.goto("/julianjoseph/30min?month=2030-10", SLOW);
    await expect(page.getByRole("button", { name: "Tuesday, October 8 - No times available" })).toBeDisabled(SLOW);
    await expect(page.getByRole("button", { name: "Wednesday, October 9 - Times available" })).toBeEnabled();

    // Troubleshoot Tuesday: the meeting limit; Wednesday: outside hours, too soon is gone, the calendar event by name
    // and the buffers around it.
    await loginAs(page, OWNER);
    await open(page, `/app/availability/advanced/troubleshoot?eventType=${seeded.owner.eventTypeIds["30min"]}&date=2030-10-08`);
    await expect(page.getByRole("heading", { name: "Tuesday, October 8, 2030" })).toBeVisible(SLOW);
    const card = page.getByRole("list", { name: "30 Minute Virtual start times" });
    await expect(card.getByRole("button", { name: /MEETING LIMIT/ }).first()).toBeVisible(SLOW);
    await expect(card.getByText(/Outside your working hours/).first()).toBeVisible();
    await page.getByRole("button", { name: "Next day" }).click();
    await expect(page.getByRole("heading", { name: "Wednesday, October 9, 2030" })).toBeVisible(SLOW);
    await expect(card.getByRole("button", { name: /CALENDAR Conflicts with "Dentist" on your calendar/ }).first()).toBeVisible(SLOW);
    await expect(card.getByRole("button", { name: /buffer after this time overlaps "Dentist"/ }).first()).toBeVisible();
    await expect(card.getByRole("button", { name: /buffer before this time overlaps "Dentist"/ }).first()).toBeVisible();
    await axe(page);

    // The public page agrees: Dentist is 3:00pm to 4:00pm in New York; with the 15 minute buffers the last start
    // before it is 2:15pm and the first one after it 4:15pm.
    await page.context().clearCookies();
    const wednesday = await openDay(page, "/julianjoseph/30min?month=2030-10", "Wednesday, October 9 - Times available");
    await expect(wednesday.getByRole("button", { name: "2:15pm", exact: true })).toBeVisible(SLOW);
    for (const blocked of ["2:30pm", "3:00pm", "3:30pm", "4:00pm"]) await expect(wednesday.getByRole("button", { name: blocked, exact: true })).toHaveCount(0);
    await expect(wednesday.getByRole("button", { name: "4:15pm", exact: true })).toBeVisible();
  });

  test("a booking's 24 hour reminder is scheduled, flagged when the dispatcher is late, sent once, and moved by a reschedule", async ({ page, api, seed, loginAs }) => {
    test.setTimeout(300_000);
    await api.reset();
    await api.setTime(NOW);
    await seed("owner", { demo: true }); // turns on "Email reminders" (24 hours before) for the three event types
    await api.runJobs({ types: ["workflows.*"] });
    const email = "hana.golden@example.com";
    // Tuesday 2:00pm New York (18:00 UTC): the reminder is due Monday 18:00 UTC.
    await book(page, { slug: "30min", dayLabel: "Tuesday, October 8 - Times available", time: "2:00pm", name: "Hana Sato", email });
    const confirmation = await emailTo(api, email, "lifecycle.invitee_confirmation");
    await api.runJobs({ types: ["workflows.*"] }); // the booking's subscriber schedules the reminder job

    // Nothing before its time.
    await api.setTime("2030-10-07T17:59:00Z");
    await api.runJobs({ types: ["workflows.*"] });
    expect(await api.outbox({ to: email, template: "workflows.invitee_reminder" })).toHaveLength(0);

    // 20 minutes late without a dispatcher run: the pending job shows on the dashboard for the instance admin.
    await api.setTime("2030-10-07T18:20:00Z");
    await loginAs(page, OWNER);
    await page.goto("/app/scheduling", SLOW);
    await expect(page.getByText("1 reminder is past its send time.")).toBeVisible(SLOW);

    // The dispatcher runs: one reminder with cancel and reschedule links, never a second copy.
    await api.runJobs({ types: ["workflows.*"] });
    const reminders = await api.outbox({ to: email, template: "workflows.invitee_reminder" });
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.subject).toBe("Reminder: 30 Minute Virtual with Julian Joseph at 2:00pm Tuesday, October 8, 2030");
    expect(reminders[0]!.links.some((l) => l.includes("/cancellations/"))).toBe(true);
    expect(reminders[0]!.links.some((l) => l.includes("/reschedulings/"))).toBe(true);
    await api.runJobs({ types: ["workflows.*"] });
    expect(await api.outbox({ to: email, template: "workflows.invitee_reminder" })).toHaveLength(1);
    await page.reload();
    await expect(page.getByText("1 reminder is past its send time.")).toHaveCount(0, SLOW);

    // The invitee moves the meeting to Thursday 3:00pm New York: the reminder moves to Wednesday 19:00 UTC.
    await page.context().clearCookies();
    await open(page, linkOf(confirmation, "/reschedulings/"));
    const thursday = page.getByRole("button", { name: "Thursday, October 10 - Times available" });
    await expect(thursday).toBeEnabled(SLOW);
    await thursday.click();
    await page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: "3:00pm", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("button", { name: "Update Event" })).toBeVisible(SLOW);
    await page.waitForTimeout(2100);
    await page.getByRole("button", { name: "Update Event" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "You are rescheduled" })).toBeVisible(SLOW);
    await api.runJobs({ types: ["workflows.*"] });
    await api.setTime("2030-10-09T18:59:00Z");
    await api.runJobs({ types: ["workflows.*"] });
    expect(await api.outbox({ to: email, template: "workflows.invitee_reminder" })).toHaveLength(1);
    await api.setTime("2030-10-09T19:01:00Z");
    await api.runJobs({ types: ["workflows.*"] });
    const moved = await api.outbox({ to: email, template: "workflows.invitee_reminder" });
    expect(moved).toHaveLength(2);
    expect(moved[0]!.subject).toBe("Reminder: 30 Minute Virtual with Julian Joseph at 3:00pm Thursday, October 10, 2030");
  });
});
