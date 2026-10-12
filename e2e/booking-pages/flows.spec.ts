// Booking page behaviors (SPEC BK-05 to BK-08, BK-15, BK-17, BK-19, BK-24 to BK-26, BK-30, BK-33): time zone switch and
// 12h/24h toggle, invitee zone persistence, URL state and back navigation, deep links, prefill, display parameters,
// embeds, the slot taken banner, verification and error answers, owner troubleshoot, mutual availability and the
// phone layout.
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

type Seeded = { owner: { userId: string; slug: string; email: string; eventTypeIds: Record<string, string> } };

const NOW = "2030-10-07T13:00:00Z"; // Monday 06:00 Los Angeles
const SLOW = { timeout: 60_000 };

async function openDay(page: Page, path: string, dayLabel: string) {
  await page.goto(path, SLOW);
  const day = page.getByRole("button", { name: dayLabel });
  await expect(day).toBeEnabled(SLOW);
  await day.click();
  return page.getByRole("list", { name: "Select a time" });
}

async function fillDetails(page: Page, name = "Ana Lima", email = "ana@example.com") {
  // The form refuses submissions within 2 seconds of rendering (BK-18).
  await page.waitForTimeout(2100);
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByRole("textbox", { name: "What would you like to discuss?", exact: true }).fill("Planning");
}

test.describe("booking flows", () => {
  let seeded: Seeded;

  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await api.setTime(NOW);
    seeded = (await seed("owner")) as unknown as Seeded;
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test("switches the time zone and the 12h/24h format", async ({ page, axe }) => {
    const times = await openDay(page, "/julianjoseph/30min", "Monday, October 7 - Times available");
    await expect(times.getByRole("button").first()).toHaveText("3:00pm");
    await page.getByRole("button", { name: /Time zone/ }).click();
    await axe(page);
    await page.getByRole("radiogroup", { name: "Time format" }).getByRole("radio", { name: "24h" }).click();
    await page.getByPlaceholder("Search...").fill("Pacific");
    await page.getByRole("option", { name: /Pacific Time - US & Canada/ }).click();
    await expect(times.getByRole("button").first()).toHaveText("12:00");
    await expect(page.getByRole("button", { name: /Time zone/ })).toContainText("Pacific Time - US & Canada");
    // The choice is remembered for the next page (GEN-06).
    await page.reload();
    await page.getByRole("button", { name: "Monday, October 7 - Times available" }).click();
    await expect(page.getByRole("list", { name: "Select a time" }).getByRole("button").first()).toHaveText("15:00");
  });

  test("keeps month and date in the URL and returns from the details step", async ({ page }) => {
    await page.goto("/julianjoseph/30min?month=2030-11", SLOW);
    await expect(page.getByRole("table", { name: "Select a Day" })).toContainText("November 2030", SLOW);
    await page.getByRole("button", { name: "Go to previous month" }).click();
    await expect(page.getByRole("table", { name: "Select a Day" })).toContainText("October 2030");
    await expect(page).toHaveURL(/month=2030-10/);
    const times = page.getByRole("list", { name: "Select a time" });
    await page.getByRole("button", { name: "Tuesday, October 8 - Times available" }).click();
    await times.getByRole("button", { name: "2:00pm" }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page).toHaveURL(/\/julianjoseph\/30min\/2030-10-08T18:00:00Z\?month=2030-10&date=2030-10-08$/);
    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Kept Name");
    // Our back button keeps the month, the date and what was typed.
    await page.getByRole("button", { name: "Back to calendar" }).click();
    await expect(page).toHaveURL(/\/julianjoseph\/30min\?month=2030-10&date=2030-10-08$/);
    await expect(page.getByRole("button", { name: "Tuesday, October 8 - Times available" })).toHaveAttribute("aria-pressed", "true");
    // The chosen time is still selected with its Next button.
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Kept Name");
    // The browser back button works too.
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Select a Date & Time" })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("heading", { name: "Enter Details" })).toBeVisible();
  });

  test("deep links: a bookable start opens the form, a taken one returns to the calendar", async ({ page }) => {
    await page.goto("/julianjoseph/30min/2030-10-08T18:00:00Z", SLOW);
    await expect(page.getByRole("heading", { name: "Enter Details" })).toBeVisible();
    await expect(page.getByTestId("details-when")).toHaveText("2:00pm - 2:30pm, Tuesday, October 8, 2030");
    // Saturday: no hours, so the start is not bookable (BK-08).
    await page.goto("/julianjoseph/30min/2030-10-12T18:00:00Z", SLOW);
    await expect(page.getByRole("heading", { name: "Select a Date & Time" })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Sorry, that time is no longer available." })).toBeVisible();
    await expect(page).toHaveURL(/\/julianjoseph\/30min\?month=2030-10$/);
  });

  test("prefill and display parameters", async ({ page }) => {
    await page.goto("/julianjoseph/30min/2030-10-08T18:00:00Z?name=Ana%20Lima&email=ana@example.com&a1=Hello%20there&guests=bo@example.com", SLOW);
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Ana Lima");
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveValue("ana@example.com");
    await expect(page.getByRole("textbox", { name: "What would you like to discuss?", exact: true })).toHaveValue("Hello there");
    await expect(page.getByText("bo@example.com")).toBeVisible();

    await page.goto("/julianjoseph/30min?primary_color=ff0000&hide_event_type_details=1", SLOW);
    await expect(page.getByRole("heading", { level: 1, name: "Select a Date & Time" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Event details" })).toHaveCount(0);
    const day = page.getByRole("button", { name: "Monday, October 7 - Times available" });
    await expect(day).toBeEnabled(SLOW);
    const color = await day.evaluate((el) => getComputedStyle(el).color);
    // A shade of pure red (mixed toward black for contrast).
    expect(color).toMatch(/^color\(srgb 0\.\d+ 0 0\)$|^rgb\(\d+, 0, 0\)$/);
    await day.click();
    await page.getByRole("list", { name: "Select a time" }).getByRole("button").first().click();
    const next = page.getByRole("button", { name: "Next", exact: true });
    expect(await next.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 0, 0)");
  });

  test("stores the displayed zone, the detected zone and the time format (Asia/Kolkata)", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ timezoneId: "Asia/Kolkata", locale: "en-US", baseURL });
    const page = await context.newPage();
    await page.goto("/julianjoseph/30min", SLOW);
    await expect(page.getByRole("button", { name: /Time zone/ })).toContainText("India, Sri Lanka Time", SLOW);
    // Tuesday Oct 8 in India: Monday's 12:00 to 17:00 Pacific (00:30 to 05:30) and Tuesday's hours from 11:00 Pacific (23:30).
    await page.getByRole("button", { name: "Tuesday, October 8 - Times available" }).click();
    await expect(page.getByRole("list", { name: "Select a time" }).getByRole("button").first()).toHaveText("12:30am");
    await expect(page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: "11:30pm" })).toBeVisible();
    await page.getByRole("button", { name: /Time zone/ }).click();
    await page.getByRole("radiogroup", { name: "Time format" }).getByRole("radio", { name: "24h" }).click();
    await page.keyboard.press("Escape");
    await page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: "23:30" }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByTestId("details-when")).toHaveText("23:30 - 00:00, Tuesday, October 8, 2030");
    await fillDetails(page);
    const request = page.waitForRequest((r) => r.url().endsWith("/api/public/bookings") && r.method() === "POST");
    await page.getByRole("button", { name: "Schedule Event" }).click();
    const body = (await request).postDataJSON() as { invitee: { timezone: string; detectedTimezone: string; timeFormat: string } };
    expect(["Asia/Kolkata", "Asia/Calcutta"]).toContain(body.invitee.timezone);
    expect(["Asia/Kolkata", "Asia/Calcutta"]).toContain(body.invitee.detectedTimezone);
    expect(body.invitee.timeFormat).toBe("24h");
    await expect(page.getByRole("heading", { name: "You are scheduled" })).toBeVisible(SLOW);
    await expect(page.getByTestId("confirmation-when")).toHaveText("23:30 - 00:00, Tuesday, October 8, 2030");
    await expect(page.getByTestId("confirmation-zone")).toHaveText("India, Sri Lanka Time");
    await context.close();
  });

  test("a taken time shows the banner with View Times", async ({ page, browser, baseURL }) => {
    await page.goto("/julianjoseph/30min/2030-10-08T18:00:00Z", SLOW);
    await fillDetails(page, "First Person", "first@example.com");
    // Someone else books the same time first.
    const other = await browser.newContext({ timezoneId: "America/New_York", baseURL });
    const otherPage = await other.newPage();
    await otherPage.goto("/julianjoseph/30min/2030-10-08T18:00:00Z", SLOW);
    await fillDetails(otherPage, "Second Person", "second@example.com");
    await otherPage.waitForTimeout(2100);
    await otherPage.getByRole("button", { name: "Schedule Event" }).click();
    await expect(otherPage.getByRole("heading", { name: "You are scheduled" })).toBeVisible(SLOW);
    await other.close();

    await page.getByRole("button", { name: "Schedule Event" }).click();
    const banner = page.getByRole("alert").filter({ hasText: "Sorry, that time is no longer available." });
    await expect(banner).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("First Person");
    await banner.getByRole("button", { name: "View Times" }).click();
    await expect(page.getByRole("heading", { name: "Select a Date & Time" })).toBeVisible();
    const times = page.getByRole("list", { name: "Select a time" });
    await expect(times.getByRole("button").first()).toBeVisible();
    await expect(times.getByRole("button", { name: "2:00pm" })).toHaveCount(0);
  });

  test("email verification step and error answers (mocked endpoint)", async ({ page }) => {
    await page.route("**/api/public/bookings", (route) =>
      route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: false, code: "verification_required", message: "Verify", reservationId: "11111111-1111-4111-8111-111111111111" }) }),
    );
    let verifyCalls = 0;
    await page.route("**/api/public/bookings/*/verify", async (route) => {
      verifyCalls++;
      const body = route.request().postDataJSON() as { code?: string; rememberDevice?: boolean; resend?: boolean };
      if (body.resend) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, resent: true }) });
      if (body.code !== "123456") return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, code: "invalid_code", message: "That code isn't correct. Try again." }) });
      expect(body.rememberDevice).toBe(true);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, inviteeId: "22222222-2222-4222-8222-222222222222", scheduledEventId: "33333333-3333-4333-8333-333333333333", trustedDevice: { cookieName: "kairos_trusted_device", value: "t".repeat(32), maxAgeSeconds: 3600 } }) });
    });
    await page.goto("/julianjoseph/30min/2030-10-08T18:00:00Z", SLOW);
    await fillDetails(page);
    await page.getByRole("button", { name: "Schedule Event" }).click();
    const step = page.getByTestId("verification-step");
    await expect(step.getByRole("heading", { name: "Verify your email" })).toBeVisible();
    await expect(step.getByText("To complete your booking, enter the 6-digit code sent to ana@example.com")).toBeVisible();
    await step.getByLabel("Verification code").fill("000000");
    await step.getByRole("button", { name: "Continue" }).click();
    await expect(step.getByText("That code isn't correct. Try again.")).toBeVisible();
    await step.getByRole("button", { name: "Resend code" }).click();
    await expect(step.getByText("We sent a new code to ana@example.com.")).toBeVisible();
    await step.getByLabel("Verification code").fill("123456");
    await step.getByRole("checkbox", { name: "Remember this device" }).click();
    await step.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/booking\/22222222-2222-4222-8222-222222222222$/, SLOW);
    expect(verifyCalls).toBe(3);
    // The token is mirrored for blocked third-party cookies (GEN-08).
    expect(await page.evaluate(() => window.localStorage.getItem("kairos:cookie:kairos_trusted_device"))).toContain("t".repeat(32));
  });

  test("already booked and validation answers keep the form", async ({ page }) => {
    let answer: "already" | "fields" = "already";
    await page.route("**/api/public/bookings", (route) =>
      answer === "already"
        ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, code: "already_booked", message: "You've already booked this time." }) })
        : route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ ok: false, code: "validation", message: "Invalid", fieldErrors: { email: ["Enter a valid email address."] } }) }),
    );
    await page.goto("/julianjoseph/30min/2030-10-08T18:00:00Z", SLOW);
    await fillDetails(page);
    await page.getByRole("button", { name: "Schedule Event" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "You've already booked this time." })).toBeVisible();
    answer = "fields";
    await page.getByRole("button", { name: "Schedule Event" }).click();
    await expect(page.locator('[data-field="email"]').getByRole("alert")).toHaveText("Enter a valid email address.");
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Ana Lima");
  });

  test("the meal event offers its 9 locations and requires a choice", async ({ page, axe }) => {
    // Block Off Work on Tuesdays is 17:00 to 20:00 Pacific: 20:00 in New York.
    const times = await openDay(page, "/julianjoseph/meal", "Tuesday, October 8 - Times available");
    await times.getByRole("button").first().click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    const group = page.getByRole("radiogroup", { name: "Location" });
    await expect(group.getByRole("radio")).toHaveCount(9);
    await expect(page.getByText("Golden Gate Grill - Marina - $$$")).toBeVisible();
    await expect(page.getByText("2001 Chestnut Street, San Francisco, CA 94123")).toBeVisible();
    await fillDetails(page);
    await page.getByRole("button", { name: "Schedule Event" }).click();
    await expect(page.locator('[data-field="location"]').getByRole("alert")).toHaveText("One location must be selected.");
    await axe(page);
    await group.getByRole("radio").last().click();
    await expect(page.getByPlaceholder("Any location")).toBeVisible();
    await page.getByRole("button", { name: "Schedule Event" }).click();
    await expect(page.locator('[data-field="location.value"]').getByRole("alert")).toHaveText("Can't be blank.");
    await page.getByPlaceholder("Any location").fill("Blue Bottle on Mint Plaza");
    await page.getByRole("button", { name: "Schedule Event" }).click();
    await expect(page.getByRole("heading", { name: "You are scheduled" })).toBeVisible(SLOW);
    await expect(page.getByText("Blue Bottle on Mint Plaza")).toBeVisible();
  });

  test("owner banner and troubleshoot mode with a busy calendar event", async ({ page, api, loginAs, axe }) => {
    // 13:00 to 14:00 Pacific on Tuesday Oct 8 is busy in the owner's calendar.
    await api.fakeCalendar({ email: seeded.owner.email, events: [{ start: "2030-10-08T20:00:00Z", end: "2030-10-08T21:00:00Z", title: "Dentist" }] });
    await loginAs(page, seeded.owner.email);
    await page.goto("/julianjoseph/30min", SLOW);
    const banner = page.getByTestId("owner-banner");
    await expect(banner).toContainText(`You are logged in as ${seeded.owner.email}. This message is only visible to you.`);
    await expect(page.getByTestId("troubleshoot-link")).toHaveAttribute("href", new RegExp(`/app/availability/troubleshoot\\?eventType=${seeded.owner.eventTypeIds["30min"]}&date=2030-10-07`));
    await banner.getByRole("button", { name: "Troubleshoot Availability" }).click();
    await page.getByRole("button", { name: /Tuesday, October 8/ }).click();
    const list = page.getByTestId("troubleshoot-list");
    await expect(list).toBeVisible(SLOW);
    const calendarChip = list.getByRole("button", { name: /CALENDAR/ }).first();
    await expect(calendarChip).toBeVisible();
    await expect(list.getByRole("button", { name: /Outside working hours/ }).first()).toBeVisible();
    await axe(page);
    await calendarChip.click();
    const sheet = page.getByTestId("troubleshoot-sheet");
    await expect(sheet).toContainText('A "Busy" calendar event is blocking the time');
    await expect(sheet).toContainText("Dentist");
    await expect(sheet.getByRole("link", { name: "Open the full troubleshooter" })).toBeVisible();
    await page.keyboard.press("Escape");
    await banner.getByRole("button", { name: "Stop troubleshooting" }).click();
    await expect(page.getByTestId("troubleshoot-list")).toHaveCount(0);
  });

  test("signed-in viewers can show the times they are free", async ({ page, api, seed, loginAs }) => {
    await seed("team");
    await api.fakeCalendar({ email: "member1@example.com", events: [{ start: "2030-10-08T18:00:00Z", end: "2030-10-08T18:30:00Z", title: "Private" }] });
    await loginAs(page, "member1@example.com");
    await page.goto("/julianjoseph/30min", SLOW);
    const toggle = page.getByRole("switch", { name: "Show times you're free" });
    await expect(toggle).toBeVisible(SLOW);
    await toggle.click();
    await expect(page.getByText("Times marked Conflict overlap events on your calendar.")).toBeVisible();
    await page.getByRole("button", { name: "Tuesday, October 8 - Times available" }).click();
    const list = page.getByRole("list", { name: "Select a time" });
    await expect(list.getByRole("button", { name: /^2:00pm\s*Conflict$/ })).toBeVisible(SLOW);
    await expect(list.getByRole("button", { name: /^2:30pm$/ })).toBeVisible();
    await expect(page.getByText("Private")).toHaveCount(0);
  });

  test("embeds post calendly events to the parent window", async ({ page, baseURL }) => {
    await page.goto("/api/health");
    const src = `${baseURL}/julianjoseph/30min?embed_type=Inline&embed_domain=example.com&hide_gdpr_banner=1`;
    await page.setContent(`<!doctype html><html><body><script>window.events=[];addEventListener("message",e=>{if(e.data&&e.data.event)window.events.push(e.data.event)});</script><iframe id="f" src="${src}" style="width:1000px;height:900px"></iframe></body></html>`);
    await expect.poll(() => page.evaluate(() => (window as unknown as { events: string[] }).events), SLOW).toContain("calendly.event_type_viewed");
    await expect.poll(() => page.evaluate(() => (window as unknown as { events: string[] }).events)).toContain("calendly.page_height");
    const frame = page.frameLocator("#f");
    await frame.getByRole("button", { name: "Tuesday, October 8 - Times available" }).click();
    await frame.getByRole("list", { name: "Select a time" }).getByRole("button").first().click();
    await frame.getByRole("button", { name: "Next", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { events: string[] }).events)).toContain("calendly.date_and_time_selected");
    await frame.getByRole("textbox", { name: "Name", exact: true }).fill("Embed Person");
    await frame.getByRole("textbox", { name: "Email", exact: true }).fill("embed@example.com");
    await frame.getByRole("textbox", { name: "What would you like to discuss?", exact: true }).fill("Embedded");
    await page.waitForTimeout(2100);
    await frame.getByRole("button", { name: "Schedule Event" }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { events: string[] }).events), SLOW).toContain("calendly.event_scheduled");
    await expect(frame.getByRole("heading", { name: "You are scheduled" })).toBeVisible(SLOW);
  });

  test("/d links: unknown codes are 404 and noindex", async ({ page }) => {
    const res = await page.goto("/d/abcd-efgh/30min");
    expect(res?.status()).toBe(404);
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    expect((await page.goto("/d/abcd-efgh"))?.status()).toBe(404);
  });

  test.describe("phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test("completes a booking on a phone", async ({ page, axe }) => {
      await page.goto("/julianjoseph/30min", SLOW);
      const day = page.getByRole("button", { name: "Tuesday, October 8 - Times available" });
      await expect(day).toBeEnabled(SLOW);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await axe(page);
      await day.click();
      // The separate times view with a back arrow (BK-30).
      await expect(page.getByRole("heading", { level: 1, name: "30 Minute Virtual" })).toBeHidden();
      const back = page.getByRole("button", { name: "Back to calendar" });
      await expect(back).toBeVisible();
      await back.click();
      await expect(page.getByRole("heading", { level: 1, name: "30 Minute Virtual" })).toBeVisible();
      await day.click();
      await page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: "2:00pm" }).click();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Enter Details" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await fillDetails(page);
      await axe(page);
      await page.getByRole("button", { name: "Schedule Event" }).click();
      await expect(page.getByRole("heading", { name: "You are scheduled" })).toBeVisible(SLOW);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await axe(page);
    });
  });
});
