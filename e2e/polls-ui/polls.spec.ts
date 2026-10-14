// Meeting polls end to end through the real pages (SPEC MP-02 to MP-18, MP-26, MP-29; research meeting-polls.md F3):
// the host creates a poll by clicking three slots in the week grid (two of them overlapping) in Europe/Berlin and
// shares it; two voters in Asia/Kolkata and America/Los_Angeles vote (one answers If need be); the first one edits
// later through the "Review or change your response" magic link from the outbox; the host sees Top times with the Best
// star and books it; the voter page then shows "This meeting has been scheduled.". Also: a phone (390x844) vote with
// the sticky footer, the unsubscribe page that changes nothing until its button is pressed, and axe on the voter page
// and the results grid.
import type { Browser, Page } from "@playwright/test";
import { expect, test, type OutboxEmail } from "../fixtures";

const POLL_ZONE = "Europe/Berlin";

/** Local "YYYY-MM-DD" dates of the grid's visible week. */
async function gridDates(page: Page): Promise<string[]> {
  return page.locator("[data-date]").evaluateAll((els) => els.map((e) => e.getAttribute("data-date") ?? ""));
}

function cell(page: Page, date: string, time: string) {
  return page.locator(`[data-cell^="${date}:"][aria-label$=", ${time}"]`);
}

/** Screenshots for visual review when POLLS_UI_SHOTS names a directory. */
async function shot(page: Page, name: string) {
  const dir = process.env.POLLS_UI_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
}

async function voterContext(browser: Browser, baseURL: string, timezoneId: string, mobile = false) {
  return browser.newContext({
    baseURL,
    timezoneId,
    locale: "en-US",
    ...(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}),
  });
}

async function vote(page: Page, p: { url: string; picks: { index: number; clicks: number }[]; name: string; email: string }) {
  await page.goto(p.url);
  await expect(page.getByRole("heading", { name: "Select all the times you're available to meet" })).toBeVisible({ timeout: 60_000 });
  const controls = page.getByTestId("answer-control");
  for (const pick of p.picks) for (let i = 0; i < pick.clicks; i++) await controls.nth(pick.index).click();
  // The bot check wants at least 2 seconds between render and submit.
  await page.waitForTimeout(2_100);
  await page.getByTestId("share-times").click();
  await expect(page.getByRole("heading", { name: "Share your preferred times" })).toBeVisible();
  await page.getByLabel("Name").fill(p.name);
  await page.getByLabel("Email").fill(p.email);
  await page.getByTestId("submit-vote").click();
  await expect(page.getByRole("heading", { name: "Thanks for voting!" })).toBeVisible({ timeout: 30_000 });
}

test.describe("meeting polls UI", () => {
  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await seed("owner");
  });

  test("create, vote from two zones, edit later, book, and the booked voter page", async ({ page, browser, api, loginAs, axe, baseURL }) => {
    test.setTimeout(300_000);
    await loginAs(page, "owner@example.com");

    // Meeting polls tab: empty state, then "New meeting poll".
    await page.goto("/app/scheduling/meeting-polls");
    await expect(page.getByRole("heading", { name: "Find the best time for everyone." })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("link", { name: "New meeting poll" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Choose times to offer" })).toBeVisible({ timeout: 60_000 });

    // Step 1: Europe/Berlin, next week, three slots (10:00 and 10:15 overlap with 30 minute times).
    await page.getByRole("button", { name: /Time zone/ }).first().click();
    await page.getByRole("combobox", { name: "Search" }).fill("Berlin");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Time zone/ }).first()).toContainText(/Central European/);
    await page.getByRole("button", { name: "Next week" }).click();
    const dates = await gridDates(page);
    expect(dates).toHaveLength(7);
    const [tue, wed] = [dates[2]!, dates[3]!];
    await cell(page, tue, "10am").click();
    // 10:15 lies under the 10:00 option: a click there adds an overlapping time (they sit side by side).
    await cell(page, tue, "10:15am").click({ force: true });
    await cell(page, wed, "2pm").click();
    await expect(page.getByTestId("grid-option")).toHaveCount(3);
    await expect(page.getByTestId("selected-count")).toHaveText("3/100 times selected");
    // Clicking a time's own start again toggles it off; the keyboard adds it back (Enter on the focused slot).
    await cell(page, wed, "2pm").click({ force: true });
    await expect(page.getByTestId("grid-option")).toHaveCount(2);
    await cell(page, wed, "2pm").focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("grid-option")).toHaveCount(3);
    await shot(page, "wizard-times");
    await page.getByTestId("wizard-next").click();

    // Step 2: details with If need be on (More settings; MP-04 default is off).
    await expect(page.getByRole("heading", { level: 1, name: "Meeting details" })).toBeVisible();
    await page.getByTestId("poll-title").fill("Roadmap sync");
    await page.getByTestId("more-settings").click();
    const ifNeedBe = page.getByTestId("setting-if-need-be").getByRole("switch");
    await expect(ifNeedBe).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("setting-hide-invitees").getByRole("switch")).toHaveAttribute("aria-checked", "false");
    await ifNeedBe.click();
    await page.getByTestId("setting-show-votes").getByRole("switch").click();
    await shot(page, "wizard-details");
    await page.getByTestId("share-poll").click();

    // Share screen.
    await expect(page.getByRole("heading", { name: "Your meeting poll is ready" })).toBeVisible({ timeout: 30_000 });
    const link = (await page.getByTestId("poll-link").textContent())!.trim();
    expect(link).toMatch(new RegExp(`^${baseURL}/p/[a-z0-9-]+$`));
    const slug = link.split("/p/")[1]!;
    await shot(page, "wizard-share");
    await page.getByTestId("share-done").click();
    await expect(page.getByTestId("results-title")).toHaveText("Roadmap sync", { timeout: 60_000 });
    const pollUrl = page.url();

    // Voter 1 in Asia/Kolkata: Yes on the first time, If need be on the last.
    const ctx1 = await voterContext(browser, baseURL!, "Asia/Kolkata");
    const v1 = await ctx1.newPage();
    await v1.goto(link);
    await expect(v1.getByTestId("poll-label")).toHaveText("Meeting poll", { timeout: 60_000 });
    await expect(v1.getByRole("button", { name: /Time zone/ }).first()).toContainText(/India/);
    // 10:00 in Berlin is 13:30 or 14:30 in Kolkata (CEST/CET).
    await expect(v1.getByTestId("poll-option").first()).toContainText(/(1|2):30pm/);
    await expect(v1.getByTestId("answer-legend")).toBeVisible();
    await shot(v1, "voter");
    await axe(v1);
    await vote(v1, { url: link, picks: [{ index: 0, clicks: 1 }, { index: 2, clicks: 2 }], name: "Priya Raman", email: "priya@example.com" });
    await expect(v1.getByTestId("answer-summary")).toContainText("If need be");

    // Voter 2 in America/Los_Angeles: Yes on the first and the last.
    const ctx2 = await voterContext(browser, baseURL!, "America/Los_Angeles");
    const v2 = await ctx2.newPage();
    await vote(v2, { url: link, picks: [{ index: 0, clicks: 1 }, { index: 2, clicks: 1 }], name: "Leo Park", email: "leo@example.com" });
    await expect(v2.getByTestId("poll-option")).toHaveCount(0);

    // Same browser later: "Edit your preferred times" with the saved answers.
    await v2.goto(link);
    await expect(v2.getByRole("button", { name: "Edit your preferred times" })).toBeVisible({ timeout: 30_000 });

    // Voter 1 edits on another device through the magic link from the outbox.
    const confirmation: OutboxEmail = await api.waitForEmail((e) => e.template === "polls.confirmation", { to: "priya@example.com", timeoutMs: 30_000 });
    const editUrl = confirmation.links.find((l) => l.includes(`/api/public/polls/${slug}/edit?t=`));
    expect(editUrl, "magic edit link").toBeTruthy();
    const ctx3 = await voterContext(browser, baseURL!, "Asia/Kolkata");
    const v3 = await ctx3.newPage();
    await v3.goto(editUrl!);
    await expect(v3).toHaveURL(new RegExp(`/p/${slug}$`));
    await v3.getByRole("button", { name: "Edit your preferred times" }).click();
    const controls = v3.getByTestId("answer-control");
    await expect(controls.nth(0)).toHaveAttribute("aria-checked", "true");
    await expect(controls.nth(2)).toHaveAttribute("aria-checked", "mixed");
    await controls.nth(1).click(); // add the overlapping 10:15 time
    await v3.waitForTimeout(2_100);
    await v3.getByTestId("share-times").click();
    await expect(v3.getByLabel("Email")).toHaveValue("priya@example.com");
    await v3.getByTestId("submit-vote").click();
    await expect(v3.getByRole("heading", { name: "Thanks for voting!" })).toBeVisible({ timeout: 30_000 });

    // Host results: Top times with the Best star on the first time (2 Yes), grid with both voters, axe.
    await page.goto(pollUrl);
    await expect(page.getByTestId("top-time").first()).toHaveAttribute("data-best", "true", { timeout: 30_000 });
    await expect(page.getByTestId("best-badge").first()).toBeVisible();
    await expect(page.getByTestId("top-time-counts").first()).toContainText("2 Yes");
    await shot(page, "results-top");
    await page.getByRole("tab", { name: "Grid" }).click();
    await expect(page.getByTestId("grid-participant")).toHaveCount(2);
    await shot(page, "results-grid");
    await axe(page, { include: "[data-testid=results-grid]" });
    await page.getByRole("tab", { name: "Top times" }).click();

    // Book the best time.
    await page.getByTestId("book-option").first().click();
    await expect(page.getByTestId("book-dialog")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("book-dialog")).toContainText("Priya Raman");
    await shot(page, "book-dialog");
    await page.getByTestId("book-submit").click();
    await expect(page.getByText("Meeting booked. Invitations are on their way.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("booked-banner")).toBeVisible({ timeout: 30_000 });
    await api.runJobs();

    // Voters see the booked state; invitees get the join link and "Add to calendar".
    await v2.goto(link);
    await expect(v2.getByRole("heading", { name: "This meeting has been scheduled." })).toBeVisible({ timeout: 30_000 });
    // The poll shows votes, so the results stay visible read only (MP-15), with this voter's answers in them.
    await expect(v2.getByTestId("readonly-results").getByTestId("poll-option")).toHaveCount(3);
    await expect(v2.getByTestId("readonly-results").getByTestId("answer-control").first()).toHaveAttribute("aria-checked", "true");
    await shot(v2, "voter-booked");
    await expect(v2.getByRole("link", { name: /Google/ }).first()).toBeVisible();
    await ctx1.close();
    await ctx2.close();
    await ctx3.close();

    // The list shows the booked poll.
    await page.goto("/app/scheduling/meeting-polls?filter=booked");
    await expect(page.getByTestId("poll-card")).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId("poll-card")).toContainText("Booked for");
    await shot(page, "list");
  });

  test("phone vote with the sticky footer, closed voting, and the unsubscribe page", async ({ page, browser, api, loginAs, axe, baseURL }) => {
    test.setTimeout(240_000);
    await loginAs(page, "owner@example.com");
    // Create a poll quickly through the API (the UI flow is covered above).
    const start = new Date(Date.now() + 3 * 86_400_000);
    start.setUTCHours(15, 0, 0, 0);
    const res = await page.context().request.post("/api/polls", {
      headers: { origin: baseURL! },
      data: {
        title: "Lunch and learn",
        timezone: POLL_ZONE,
        defaultDurationMinutes: 60,
        options: [0, 1, 2].map((d) => ({ start: new Date(start.getTime() + d * 86_400_000).toISOString(), end: new Date(start.getTime() + d * 86_400_000 + 3_600_000).toISOString() })),
      },
    });
    expect(res.status()).toBe(201);
    const poll = (await res.json()) as { pollId: string; slug: string; link: string };

    // Invite someone (for the unsubscribe link).
    await page.goto(`/app/polls/${poll.pollId}`);
    await expect(page.getByTestId("results-title")).toHaveText("Lunch and learn", { timeout: 60_000 });
    // A click before the page hydrates is lost in dev mode: retry until the dialog is open.
    await expect(async () => {
      await page.getByRole("button", { name: "Invite people" }).click();
      await expect(page.getByTestId("invite-recipients")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByTestId("invite-recipients").fill("Mia Chen <mia@example.com>");
    await page.getByTestId("invite-send").click();
    await expect(page.getByText("Invitation sent")).toBeVisible({ timeout: 30_000 });
    const invitation = await api.waitForEmail((e) => e.template === "polls.invitation", { to: "mia@example.com", timeoutMs: 30_000 });
    const unsubscribe = invitation.links.find((l) => l.includes(`/p/${poll.slug}/unsubscribe?t=`));
    expect(unsubscribe, "unsubscribe link").toBeTruthy();

    // Phone voter.
    const phone = await voterContext(browser, baseURL!, "America/Los_Angeles", true);
    const m = await phone.newPage();
    await m.goto(poll.link);
    await expect(m.getByRole("heading", { name: "Select all the times you're available to meet" })).toBeVisible({ timeout: 60_000 });
    const footer = m.getByTestId("vote-footer");
    await expect(footer).toBeVisible();
    await m.getByTestId("answer-control").nth(1).tap();
    await expect(m.getByTestId("preferred-count")).toHaveText("1 preferred time");
    await expect(m.getByText("Reminder: Voting for multiple times helps the poll host find the best meeting time for everyone.")).toBeVisible();
    const box = await footer.boundingBox();
    expect(box && box.y + box.height).toBeLessThanOrEqual(845);
    await shot(m, "voter-phone");
    const width = await m.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await axe(m);
    await m.waitForTimeout(2_100);
    await m.getByTestId("share-times").tap();
    await m.getByLabel("Name").fill("Sam Ortiz");
    await m.getByLabel("Email").fill("sam@example.com");
    await m.getByTestId("submit-vote").tap();
    await expect(m.getByRole("heading", { name: "Thanks for voting!" })).toBeVisible({ timeout: 30_000 });

    // The unsubscribe page changes nothing until its button is pressed.
    const u = await phone.newPage();
    await u.goto(unsubscribe!);
    await expect(u.getByRole("heading", { name: "Unsubscribe from this poll?" })).toBeVisible({ timeout: 60_000 });
    await u.reload();
    await expect(u.getByRole("button", { name: "Unsubscribe" })).toBeVisible();
    await u.getByRole("button", { name: "Unsubscribe" }).click();
    await expect(u.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible({ timeout: 30_000 });
    // A hand-made ?done=1 link never claims an unsubscribe: the page reads the stored state.
    const fake = new URL(unsubscribe!);
    fake.searchParams.set("t", "not-a-token");
    fake.searchParams.set("done", "1");
    await u.goto(fake.toString());
    await expect(u.getByTestId("unsubscribe-invalid")).toBeVisible({ timeout: 30_000 });

    // The voter page is never indexed (MP-30).
    await expect(m.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    // The host replaces every time of the poll (one has Sam's vote) in the edit wizard: the new time is saved before
    // the old ones go, so the poll never runs out of times (it used to fail with "A poll needs at least one time.").
    await page.goto(`/app/polls/${poll.pollId}/edit`);
    await expect(page.getByRole("heading", { level: 1, name: "Choose times to offer" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("selected-count")).toHaveText("3/100 times selected");
    await page.getByTestId("selected-count").click();
    await page.getByRole("button", { name: "Clear all" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Clear all" }).click();
    await expect(page.getByTestId("selected-count")).toHaveText("0/100 times selected");
    await page.keyboard.press("Escape"); // the times list popover, if it is still open
    const firstDay = new Intl.DateTimeFormat("en-CA", { timeZone: POLL_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(start);
    await cell(page, firstDay, "9am").click();
    await expect(page.getByTestId("selected-count")).toHaveText("1/100 times selected");
    await page.getByTestId("wizard-save").click();
    const removeDialog = page.getByRole("alertdialog");
    await expect(removeDialog).toContainText("Sam Ortiz", { timeout: 30_000 });
    await removeDialog.getByRole("button", { name: "Remove times" }).click();
    await expect(page.getByTestId("results-title")).toHaveText("Lunch and learn", { timeout: 60_000 });
    await expect(page.getByTestId("top-time")).toHaveCount(1, { timeout: 30_000 });
    // Sam's answers on the removed times are gone; the new time has none yet.
    await expect(page.getByTestId("top-time").first()).toContainText("No answers yet");

    // Close voting: the voter page turns read only.
    await page.reload();
    await expect(async () => {
      await page.getByTestId("close-voting").click();
      await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
    await page.getByRole("alertdialog").getByRole("button", { name: "Close voting" }).click();
    await expect(page.getByTestId("poll-status")).toHaveText("Closed", { timeout: 30_000 });
    await m.goto(poll.link);
    await expect(m.getByRole("heading", { name: "Voting for this poll has closed." })).toBeVisible({ timeout: 30_000 });
    await phone.close();

    // Unknown slugs are the 404 page.
    const missing = await page.goto("/p/no-such-poll-here");
    expect(missing?.status()).toBe(404);
  });
});
