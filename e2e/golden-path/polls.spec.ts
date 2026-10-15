// Golden path, meeting polls (docs/SCOPE.md "the Doodle replacement"; SPEC MP-02 to MP-26): the host creates a poll on
// the week grid and shares it, a voter answers, the host closes and reopens voting (the voter is emailed), books the
// best time (the meeting lands in Meetings), the poll list shows the booked time, and deleting the booked poll names
// the meeting time with its end, can notify the voter, and the link then answers HTTP 410 "This poll is no longer
// available.". Real clock: the grid works in the browser's week.
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";
import { emailTo, open, OWNER, SLOW, trackPageErrors } from "./helpers";

async function gridDates(page: Page): Promise<string[]> {
  return page.locator("[data-date]").evaluateAll((els) => els.map((e) => e.getAttribute("data-date") ?? ""));
}

function cell(page: Page, date: string, time: string) {
  return page.locator(`[data-cell^="${date}:"][aria-label$=", ${time}"]`);
}

test.describe("golden path: meeting polls", () => {
  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await api.setTime(null);
    await seed("owner");
  });

  test("create, vote, close and reopen with an email, book, list, delete with notify, and the 410 link", async ({ page, browser, api, loginAs, baseURL }) => {
    test.setTimeout(300_000);
    const errors = trackPageErrors(page);
    await loginAs(page, OWNER);

    // Create on the week grid (next week, two times in the owner's zone).
    await open(page, "/app/scheduling/meeting-polls");
    await page.getByRole("link", { name: "New meeting poll" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Choose times to offer" })).toBeVisible(SLOW);
    await page.getByRole("button", { name: "Next week" }).click();
    const dates = await gridDates(page);
    expect(dates).toHaveLength(7);
    await cell(page, dates[2]!, "10am").click();
    await cell(page, dates[3]!, "2pm").click();
    await expect(page.getByTestId("grid-option")).toHaveCount(2);
    await page.getByTestId("wizard-next").click();
    await expect(page.getByRole("heading", { level: 1, name: "Meeting details" })).toBeVisible(SLOW);
    await page.getByTestId("poll-title").fill("Quarterly planning");
    await page.getByTestId("share-poll").click();
    await expect(page.getByRole("heading", { name: "Your meeting poll is ready" })).toBeVisible(SLOW);
    const link = (await page.getByTestId("poll-link").textContent())!.trim();
    expect(link).toMatch(new RegExp(`^${baseURL}/p/[a-z0-9-]+$`));
    await page.getByTestId("share-done").click();
    await expect(page.getByTestId("results-title")).toHaveText("Quarterly planning", SLOW);
    const resultsUrl = page.url();

    // A voter in New York answers Yes to both times.
    const voterCtx = await browser.newContext({ baseURL, timezoneId: "America/New_York", locale: "en-US" });
    const voter = await voterCtx.newPage();
    await voter.goto(link, SLOW);
    await expect(voter.getByRole("heading", { name: "Select all the times you're available to meet" })).toBeVisible(SLOW);
    const controls = voter.getByTestId("answer-control");
    await expect(controls).toHaveCount(2);
    await controls.nth(0).click();
    await controls.nth(1).click();
    await voter.waitForTimeout(2_100);
    await voter.getByTestId("share-times").click();
    await voter.getByLabel("Name").fill("Iris Novak");
    await voter.getByLabel("Email").fill("iris.golden@example.com");
    await voter.getByTestId("submit-vote").click();
    await expect(voter.getByRole("heading", { name: "Thanks for voting!" })).toBeVisible(SLOW);

    // Close voting, then reopen it with the email to the voter (on by default).
    await open(page, resultsUrl);
    await expect(async () => {
      await page.getByTestId("close-voting").click();
      await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 2_000 });
    }).toPass(SLOW);
    await page.getByRole("alertdialog").getByRole("button", { name: "Close voting" }).click();
    await expect(page.getByTestId("poll-status")).toHaveText("Closed", SLOW);
    await page.getByRole("button", { name: "Reopen voting" }).click();
    const reopen = page.getByRole("dialog", { name: "Reopen voting" });
    const notify = reopen.getByRole("checkbox", { name: "Email the people who voted that the poll is open again" });
    await expect(notify).toBeChecked();
    await reopen.getByRole("button", { name: "Reopen", exact: true }).click();
    const toasts = page.getByRole("region", { name: "Notifications" });
    await expect(toasts.getByText("Voting reopened")).toBeVisible(SLOW);
    const reopened = await emailTo(api, "iris.golden@example.com", "polls.reopened");
    expect(reopened.subject).toBe("Julian Joseph reopened the poll for Quarterly planning");

    // Book the best time: the meeting is created and the voter is invited.
    await page.reload();
    await page.getByTestId("book-option").first().click();
    await expect(page.getByTestId("book-dialog")).toContainText("Iris Novak", SLOW);
    await page.getByTestId("book-submit").click();
    await expect(page.getByTestId("booked-banner")).toBeVisible(SLOW);
    await emailTo(api, "iris.golden@example.com", "lifecycle.invitee_confirmation");
    await voter.goto(link, SLOW);
    await expect(voter.getByRole("heading", { name: "This meeting has been scheduled." })).toBeVisible(SLOW);
    await open(page, "/app/meetings");
    await expect(page.getByTestId("meetings-list")).toContainText("Iris Novak", SLOW);

    // The list shows the booked time; Delete names the meeting with its end time and offers the voter email.
    await open(page, "/app/scheduling/meeting-polls?filter=booked");
    const card = page.getByTestId("poll-card");
    await expect(card).toHaveCount(1, SLOW);
    await expect(card).toContainText("Booked for");
    await card.getByTestId("poll-menu").click();
    await page.getByRole("menuitem", { name: "Delete poll" }).click();
    const del = page.getByRole("alertdialog", { name: "Delete this poll?" });
    await expect(del).toContainText(/This poll has a scheduled meeting at .+, \d{1,2}:\d{2}(am|pm) - \d{1,2}:\d{2}(am|pm)\./);
    await expect(del.getByRole("radio", { name: "Keep the scheduled meeting" })).toBeChecked();
    const notifyVoter = del.getByRole("checkbox", { name: "Notify the person who voted" });
    await expect(notifyVoter).not.toBeChecked(); // the meeting stays, so the email is opt in
    await notifyVoter.click();
    await del.getByRole("button", { name: "Delete poll" }).click();
    await expect(toasts.getByText("Poll deleted")).toBeVisible(SLOW);
    const canceled = await emailTo(api, "iris.golden@example.com", "polls.canceled");
    expect(canceled.subject).toBe("Julian Joseph canceled the poll Quarterly planning");

    // The link of the deleted poll: a real 410 with the "no longer available" page; the meeting stays.
    const gone = await voter.goto(link, SLOW);
    expect(gone?.status()).toBe(410);
    await expect(voter.getByText("This poll is no longer available.")).toBeVisible();
    await expect(voter.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    const head = await page.request.fetch(link, { method: "HEAD" });
    expect(head.status()).toBe(410);
    expect((await page.request.get(`/api/public/polls/${link.split("/p/")[1]}/state`)).status()).toBe(410);
    expect((await page.request.get("/p/no-such-poll-here")).status()).toBe(404);
    await open(page, "/app/meetings");
    await expect(page.getByTestId("meetings-list")).toContainText("Iris Novak", SLOW);
    await voterCtx.close();
    expect(errors).toEqual([]);
  });
});
