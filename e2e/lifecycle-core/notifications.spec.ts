// Booking notifications in the real Next server (SPEC NT-01, NT-02, NT-05, NT-06, NT-20, NT-23; docs/SCOPE.md priority 5):
// a booking through the public page sends, right after the response (after(), no cron), the invitee confirmation with
// the invite in the invitee's zone and the Cancel and Reschedule links, and the host's "New Event" email. The seeded
// owner has no writable calendar, so the meeting uses email confirmations.
import { expect, test } from "../fixtures";

const NOW = "2030-10-07T13:00:00Z"; // Monday 06:00 Los Angeles
const SLOW = { timeout: 60_000 };

test.describe("lifecycle notifications", () => {
  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await api.setTime(NOW);
    await seed("owner");
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test("a booking emails the invitee and the host right after the response", async ({ page, api }) => {
    await page.goto("/julianjoseph/30min", SLOW);
    const day = page.getByRole("button", { name: "Monday, October 7 - Times available" });
    await expect(day).toBeEnabled(SLOW);
    await day.click();
    await page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: "3:00pm" }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Enter Details" })).toBeVisible(SLOW);
    await page.waitForTimeout(2100); // BK-18: the form refuses submissions within 2 seconds of rendering
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Ana Lima");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("ana.e2e@example.com");
    await page.getByRole("textbox", { name: "What would you like to discuss?", exact: true }).fill("Roadmap review");
    await page.getByRole("button", { name: "Schedule Event" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "You are scheduled" })).toBeVisible(SLOW);
    const inviteeId = /\/booking\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
    expect(inviteeId).toBeTruthy();

    // No /api/test/run-jobs here: the jobs ran in after() (NT-23).
    let emails = await api.outbox();
    for (let i = 0; i < 30 && emails.filter((e) => e.template.startsWith("lifecycle.")).length < 2; i++) {
      await page.waitForTimeout(500);
      emails = await api.outbox();
    }
    const confirmation = emails.find((e) => e.template === "lifecycle.invitee_confirmation");
    expect(confirmation).toBeDefined();
    expect(confirmation!.to).toEqual(["ana.e2e@example.com"]);
    expect(confirmation!.subject).toBe("Confirmed: 30 Minute Virtual with Julian Joseph on Monday, October 7, 2030");
    expect(confirmation!.text).toContain("3:00pm - Monday, October 7, 2030 (Eastern Time - US & Canada)");
    expect(confirmation!.text).toContain(`/cancellations/${inviteeId}`);
    expect(confirmation!.text).toContain(`/reschedulings/${inviteeId}`);
    expect(confirmation!.hasIcs).toBe(true);
    expect(confirmation!.icsMethod).toBe("REQUEST");

    const host = emails.find((e) => e.template === "lifecycle.host_new_event");
    expect(host).toBeDefined();
    expect(host!.subject).toBe("New Event: Ana Lima - 12:00pm Monday, October 7, 2030 - 30 Minute Virtual");
    expect(host!.replyTo).toBe("ana.e2e@example.com");
    expect(host!.text).toContain("Roadmap review");
  });
});
