// Reminder emails end to end in the real Next server (SPEC NT-09, NT-15 backfill, NT-23, ADM-10; docs/SCOPE.md
// priority 5): the demo seed turns on "Email reminders" (24 hours before) for the owner's event types, the backfill
// schedules reminders for the demo meetings already booked, and after the fake clock reaches 24 hours before the
// first meeting the invitee's Calendly-style reminder is in the outbox with its Cancel and Reschedule links. A
// reminder processed after its meeting started is skipped (too_late). The last test drives the event type editor's
// reminder rows once the editor mounts them.
import { expect, test } from "../fixtures";

type Seeded = {
  owner: { userId: string; email: string; slug: string; eventTypeIds: Record<string, string> };
  demoData: { scheduledEventIds: string[]; inviteeIds: string[] };
};

const START = "2030-10-07T13:00:00Z"; // Monday 06:00 in Los Angeles
// Demo meeting 1: 30 Minute Virtual, Wednesday October 9, 2030 at 11:00 Los Angeles (18:00 UTC), invitee Maya Patel
// (America/New_York). Its reminder is due on October 8 at 18:00 UTC.
const MEETING_1_REMINDER = "2030-10-08T18:00:00Z";
// Demo meeting 2: 60 Minute Virtual, Monday October 14, 2030 at 13:00 Los Angeles (20:00 UTC).
const AFTER_MEETING_2_START = "2030-10-14T20:30:00Z";

test.describe("workflows: email reminders", () => {
  let seeded: Seeded;

  test.beforeEach(async ({ api }) => {
    await api.reset();
    await api.setTime(START);
    seeded = (await api.seed("owner", { demo: true })) as unknown as Seeded;
    // The seed's backfill jobs schedule the demo meetings' reminders.
    await api.runJobs({ types: ["workflows.*"] });
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test("sends the invitee reminder 24 hours before the meeting with cancel and reschedule links", async ({ api }) => {
    expect(await api.outbox({ template: "workflows.invitee_reminder" })).toHaveLength(0);

    // One minute before the reminder time: nothing yet.
    await api.setTime(new Date(Date.parse(MEETING_1_REMINDER) - 60_000));
    await api.runJobs({ types: ["workflows.*"] });
    expect(await api.outbox({ template: "workflows.invitee_reminder" })).toHaveLength(0);

    await api.setTime(new Date(Date.parse(MEETING_1_REMINDER) + 30_000));
    await api.runJobs({ types: ["workflows.*"] });
    const emails = await api.outbox({ template: "workflows.invitee_reminder" });
    expect(emails).toHaveLength(1);
    const [email] = emails;
    expect(email!.to).toEqual(["maya.patel@example.com"]);
    expect(email!.subject).toBe("Reminder: 30 Minute Virtual with Julian Joseph at 2:00pm Wednesday, October 9, 2030");
    expect(email!.category).toBe("workflow");
    expect(email!.text).toContain("Hi Maya,");
    expect(email!.text).toContain("This is a friendly reminder that 30 Minute Virtual with Julian Joseph is at 2:00pm on Wednesday, October 9, 2030.");
    expect(email!.text).toContain("Need to make changes to this event?");
    const inviteeId = email!.inviteeId!;
    expect(seeded.demoData.inviteeIds).toContain(inviteeId);
    expect(email!.links.some((l) => l.endsWith(`/cancellations/${inviteeId}`))).toBe(true);
    expect(email!.links.some((l) => l.endsWith(`/reschedulings/${inviteeId}`))).toBe(true);
    expect(email!.hasIcs).toBe(false);

    // Running the jobs again never sends a second copy.
    await api.runJobs({ types: ["workflows.*"] });
    expect(await api.outbox({ template: "workflows.invitee_reminder" })).toHaveLength(1);
  });

  test("skips a reminder whose meeting already started (too_late)", async ({ api }) => {
    // Nothing ran between now and after meeting 2 started: meeting 1's and meeting 2's reminders are both processed
    // late; both meetings have started, so neither is sent.
    await api.setTime(AFTER_MEETING_2_START);
    await api.runJobs({ types: ["workflows.*"] });
    expect(await api.outbox({ template: "workflows.invitee_reminder" })).toHaveLength(0);
  });

  test("the event type editor shows the reminder rows and edits them", async ({ api, page, loginAs, axe }) => {
    await api.setTime(null);
    await loginAs(page, seeded.owner.email);
    const id = seeded.owner.eventTypeIds["30min"]!;
    await page.goto(`/app/event-types/${id}?section=notifications`);
    // The editor keeps Calendly's collapsed "More options" sections; ?section=notifications opens and scrolls to it.
    const section = page.getByTestId("event-type-reminders");
    await expect(section).toBeVisible({ timeout: 15_000 });

    await expect(section.getByText("Email reminders", { exact: true })).toBeVisible();
    await expect(section.getByText("Sent 24 hours before event")).toBeVisible();
    await expect(section.getByText("Email reminders to host", { exact: true })).toBeVisible();

    // Turn on host reminders from the row menu.
    await section.getByRole("button", { name: "Email reminders to host options" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Send reminders" }).click();
    await expect(page.getByText("Email reminders to host turned on")).toBeVisible();
    await page.keyboard.press("Escape");

    // Edit the invitee reminders: add a second timing.
    await section.getByRole("button", { name: "Email reminders", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Email reminders" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Add another reminder" }).click();
    await dialog.getByLabel("Reminder 2 amount").fill("1");
    await dialog.getByLabel("Reminder 2 unit").selectOption("hours");
    await axe(page, { include: '[role="dialog"]' });
    await dialog.getByRole("button", { name: "Save and close" }).click();
    await expect(dialog).toBeHidden();
    await expect(section.getByText("Sent 24 hours and 1 hour before event")).toBeVisible();
  });
});
