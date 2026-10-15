// Golden path, the email outbox with Gmail sending (production sends from the owner's Gmail): run with
// EMAIL_PROVIDER=gmail so the server sends through Gmail, which is not connected in tests. Every email then waits in
// the outbox as "Waiting for Gmail" with a link to reconnect Google (the internal "Waiting for Gmail: " prefix never
// shows in the reason), and the page banner counts them. After 24 hours the email.retry job gives them up for good
// ("Not sent: ...", without the internal "permanent: " prefix) and "Resend" sends a new copy, which waits for Gmail
// again. Skipped in the default run (no EMAIL_PROVIDER).
//
//   EMAIL_PROVIDER=gmail E2E_PORT=3499 PGLITE_DIR=.data/pglite-e2e-golden-gmail NEXT_DIST_DIR=.next-e2e-golden \
//     scripts/heavy.sh server npx playwright test e2e/golden-path/gmail-hold.spec.ts
import { expect, test } from "../fixtures";
import { book, emailTo, NOW, open, OWNER, SLOW } from "./helpers";

test.describe("golden path: emails waiting for Gmail", () => {
  test.skip(process.env.EMAIL_PROVIDER !== "gmail", "needs EMAIL_PROVIDER=gmail on the server");

  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await api.setTime(NOW);
    await seed("owner");
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test("held emails link to the Google reconnect; given up ones can be resent", async ({ page, api, loginAs, axe }) => {
    test.setTimeout(180_000);
    await book(page, { slug: "30min", dayLabel: "Monday, October 7 - Times available", time: "3:00pm", name: "Kim Ross", email: "kim.golden@example.com" });
    const held = await emailTo(api, "kim.golden@example.com", "lifecycle.invitee_confirmation");
    expect(held.status).toBe("failed");

    await loginAs(page, OWNER);
    await open(page, "/app/settings/email-outbox");
    await expect(page.getByTestId("email-transport")).toHaveText("Waiting for Gmail: connect Google and allow Gmail sending", SLOW);
    // The invitee confirmation, the host's "New Event" and (no Google account) the host's Meet link notice.
    const rows = page.getByRole("table", { name: "Emails, newest first" }).locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(page.getByRole("status").filter({ hasText: "3 emails are waiting for Gmail" })).toBeVisible();
    const confirmation = rows.filter({ hasText: "lifecycle.invitee_confirmation" });
    await expect(confirmation).toContainText("Waiting for Gmail");
    await expect(confirmation).toContainText("Gmail sending is not set up yet.");
    await expect(confirmation).not.toContainText("Waiting for Gmail: ");
    await expect(confirmation.getByRole("link", { name: "Reconnect Google" })).toHaveAttribute("href", "/app/integrations/calendars/google");
    await expect(confirmation.getByRole("button", { name: /^Resend / })).toHaveCount(0);
    await axe(page);

    // A day later the held emails are given up for good: "Failed" with the reason, and "Resend".
    await api.setTime("2030-10-08T13:10:00Z");
    await api.runJobs({ types: ["email.*"] });
    await loginAs(page, OWNER);
    await open(page, "/app/settings/email-outbox?status=failed");
    await expect(rows).toHaveCount(3, SLOW);
    await expect(page.getByRole("status").filter({ hasText: "waiting for Gmail" })).toHaveCount(0);
    const failed = rows.filter({ hasText: "lifecycle.invitee_confirmation" });
    await expect(failed).toContainText("Failed");
    await expect(failed).toContainText("Not sent:");
    await expect(failed).not.toContainText("permanent:");
    await failed.getByRole("button", { name: /^Resend / }).click();
    await expect(page.getByText("The new copy could not be sent either. Its reason is at the top of the list.")).toBeVisible(SLOW);

    // The copy is a new row at the top, waiting for Gmail again; the original says it was resent.
    await open(page, "/app/settings/email-outbox");
    await expect(rows).toHaveCount(4, SLOW);
    await expect(rows.nth(0)).toContainText("lifecycle.invitee_confirmation");
    await expect(rows.nth(0)).toContainText("Waiting for Gmail");
    await expect(rows.filter({ hasText: "Resent as a new email." })).toHaveCount(1);
    const copies = await api.outbox({ to: "kim.golden@example.com", template: "lifecycle.invitee_confirmation" });
    expect(copies).toHaveLength(2);
  });
});
