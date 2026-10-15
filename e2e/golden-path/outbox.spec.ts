// Golden path, the email outbox page (docs/SCOPE.md item 15; SPEC GEN-15, ADM-04): with no email provider every email
// is stored in the outbox; the owner finds the page in the settings navigation, sees the booking's emails newest
// first with their status, provider, template, recipient and time, filters and searches them (a page number past the
// end shows the last page), and reads one rendered in a sandboxed frame (and as plain text). A member who is not an
// owner or instance admin gets neither the entry nor the page.
import { expect, test } from "../fixtures";
import { book, emailTo, NOW, open, OWNER, SLOW, trackPageErrors } from "./helpers";

test.describe("golden path: email outbox", () => {
  test.skip(process.env.EMAIL_PROVIDER === "gmail", "the Gmail run checks held emails in gmail-hold.spec.ts");

  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await api.setTime(NOW);
    await seed("owner");
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test("lists, filters, searches and previews the stored emails", async ({ page, api, loginAs, axe }) => {
    test.setTimeout(180_000);
    const errors = trackPageErrors(page);
    await book(page, { slug: "30min", dayLabel: "Monday, October 7 - Times available", time: "3:00pm", name: "Jon Bell", email: "jon.golden@example.com" });
    await emailTo(api, "jon.golden@example.com", "lifecycle.invitee_confirmation");
    await emailTo(api, OWNER, "lifecycle.host_new_event");

    await loginAs(page, OWNER);
    await open(page, "/app/settings/profile");
    const nav = page.getByRole("navigation", { name: "Account settings" });
    await nav.getByRole("link", { name: "Email outbox" }).click();
    await expect(page).toHaveURL(/\/app\/settings\/email-outbox$/, SLOW);
    await expect(page.getByRole("heading", { level: 1, name: "Email outbox" })).toBeVisible(SLOW);
    await expect(nav.getByRole("link", { name: "Email outbox" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("email-transport")).toHaveText("Stored in the outbox (no email provider configured)");

    const table = page.getByRole("table", { name: "Emails, newest first" });
    const rows = table.locator("tbody tr");
    // The invitee confirmation, the host's "New Event" and (no Google account in tests) the host's "couldn't create a
    // Google Meet link" notice; the business clock is frozen, so they share one time.
    await expect(rows).toHaveCount(3);
    const invitee = rows.filter({ hasText: "lifecycle.invitee_confirmation" });
    await expect(invitee).toContainText("Confirmed: 30 Minute Virtual with Julian Joseph on Monday, October 7, 2030");
    await expect(invitee).toContainText("jon.golden@example.com");
    await expect(invitee).toContainText("Stored");
    await expect(invitee).toContainText("Outbox");
    await expect(invitee.locator("time")).toHaveText(/^Oct 7, \d{1,2}:\d{2}(am|pm)$/);
    await expect(rows.filter({ hasText: "lifecycle.host_new_event" })).toContainText(OWNER);
    await expect(table.getByRole("button", { name: /^Resend / })).toHaveCount(0); // nothing failed
    await axe(page);

    // Search, then a status filter with no match.
    await page.getByRole("searchbox", { name: "Search emails" }).fill("jon.golden");
    await expect(page).toHaveURL(/q=jon\.golden/, SLOW);
    await expect(rows).toHaveCount(1, SLOW);
    await page.getByRole("combobox", { name: "Status" }).selectOption("failed");
    await expect(page).toHaveURL(/status=failed/, SLOW);
    await expect(page.getByRole("heading", { name: "No emails match these filters" })).toBeVisible(SLOW);
    await page.getByRole("link", { name: "Show all emails" }).click();
    await expect(rows).toHaveCount(3, SLOW);

    // A page past the end (a stale link, or a typed page number far beyond bigint) shows the last page.
    for (const n of ["2", "1000000000000000000"]) {
      await page.goto(`/app/settings/email-outbox?page=${n}`, SLOW);
      await expect(page).toHaveURL(/\/app\/settings\/email-outbox$/, SLOW);
      await expect(rows).toHaveCount(3, SLOW);
    }

    // View: the rendered email in a sandboxed frame, then the plain text.
    await invitee.getByRole("link", { name: /^View / }).click();
    await expect(page).toHaveURL(/view=[0-9a-f-]{36}/, SLOW);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("lifecycle.invitee_confirmation", SLOW);
    await expect(dialog).toContainText("Calendar invitation (invite.ics)");
    const frame = dialog.locator("iframe");
    await expect(frame).toHaveAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    await expect(page.frameLocator('[role="dialog"] iframe').locator("body")).toContainText("Jon", SLOW);
    await dialog.getByRole("radio", { name: "Plain text" }).click();
    await expect(dialog.locator("pre")).toContainText("Jon");
    await axe(page);
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/view=/, SLOW);
    expect(errors).toEqual([]);
  });

  test("a member who is not an owner or admin gets no entry and the not found page", async ({ page, seed, loginAs }) => {
    await seed("team");
    await loginAs(page, "member2@example.com");
    await open(page, "/app/settings/profile");
    await expect(page.getByRole("navigation", { name: "Account settings" }).getByRole("link", { name: "Profile" })).toBeVisible(SLOW);
    await expect(page.getByRole("navigation", { name: "Account settings" }).getByRole("link", { name: "Email outbox" })).toHaveCount(0);
    // The dashboard streams its shell first (loading.tsx), so the not found page answers with status 200 and noindex.
    await page.goto("/app/settings/email-outbox", SLOW);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible(SLOW);
    await expect(page.getByRole("heading", { name: "Email outbox" })).toHaveCount(0);
  });
});
