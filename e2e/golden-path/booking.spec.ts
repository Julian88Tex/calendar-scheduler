// Golden path, invitee side (docs/SCOPE.md priorities 1, 5, 6; SPEC BK-01 to BK-09, CR-02, CR-03, NT-01 to NT-04):
// the root URL, the public profile, a booking of each of the three event types (the meal with a venue pick), the
// confirmation pages and the confirmation and host emails with calendar invites, an invitee reschedule and cancel
// through the email links (with the slot freed again), and a booking at phone width without horizontal scroll.
import { expect, test } from "../fixtures";
import { book, emailTo, fillDetails, fitsWidth, linkOf, NOW, open, openDay, OWNER, scheduleEvent, SLOW, trackPageErrors } from "./helpers";

test.describe("golden path: invitees", () => {
  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await api.setTime(NOW);
    await seed("owner");
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test("the root URL sends signed-out visitors to the login page and the owner to the app", async ({ page, request, loginAs, baseURL }) => {
    const anonymous = await request.get("/", { maxRedirects: 0 });
    expect(anonymous.status()).toBeGreaterThanOrEqual(300);
    expect(anonymous.status()).toBeLessThan(400);
    expect(new URL(anonymous.headers().location!, "http://x").pathname).toBe("/login");
    // A stale session cookie counts as signed out.
    await page.context().addCookies([{ name: "sid", value: "not-a-real-session", url: baseURL! }]);
    await page.goto("/", SLOW);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Log in to your account" })).toBeVisible();
    await page.context().clearCookies();
    await loginAs(page, OWNER);
    await page.goto("/", SLOW);
    await expect(page).toHaveURL(/\/app\/scheduling$/, SLOW);
  });

  test("books each event type from the profile, with confirmation pages and emails", async ({ page, api, axe }) => {
    test.setTimeout(240_000);
    const errors = trackPageErrors(page);

    // The profile: avatar, name, welcome message and the three event types in order.
    const res = await page.goto("/julianjoseph", SLOW);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Julian Joseph" })).toBeVisible();
    await expect(page.getByText("Welcome to my scheduling page.", { exact: false })).toBeVisible();
    const types = page.getByRole("list", { name: "Event types" }).getByRole("link");
    await expect(types).toHaveText(["30 Minute Virtual", "60 Minute Virtual", "In-Person Meal or Coffee"]);
    await axe(page);

    // 1) 30 Minute Virtual, Monday 3:00pm New York (12:00pm Los Angeles: the first start after 4 hours notice).
    await types.filter({ hasText: "30 Minute Virtual" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "30 Minute Virtual" })).toBeVisible(SLOW);
    await page.getByRole("button", { name: "Monday, October 7 - Times available" }).click();
    const times = page.getByRole("list", { name: "Select a time" });
    await expect(times.getByRole("button").first()).toHaveText("3:00pm");
    await times.getByRole("button", { name: "3:00pm", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await fillDetails(page, { name: "Ana Lima", email: "ana.golden@example.com", answer: "Roadmap review" });
    const first = await scheduleEvent(page);
    await expect(page.getByText("You are scheduled with Julian Joseph.")).toBeVisible();
    await expect(page.getByTestId("confirmation-when")).toHaveText("3:00pm - 3:30pm, Monday, October 7, 2030");
    await expect(page.getByTestId("confirmation-zone")).toHaveText("Eastern Time - US & Canada");
    await expect(page.getByTestId("manage-links")).toBeVisible();
    await axe(page);
    const confirmation = await emailTo(api, "ana.golden@example.com", "lifecycle.invitee_confirmation");
    expect(confirmation.subject).toContain("30 Minute Virtual with Julian Joseph");
    expect(confirmation.hasIcs).toBe(true);
    expect(confirmation.icsMethod).toBe("REQUEST");
    expect(linkOf(confirmation, "/cancellations/")).toBe(`/cancellations/${first}`);
    expect(linkOf(confirmation, "/reschedulings/")).toBe(`/reschedulings/${first}`);
    const hostNew = await emailTo(api, OWNER, "lifecycle.host_new_event");
    expect(hostNew.subject).toContain("Ana Lima");
    expect(hostNew.text).toContain("Roadmap review");

    // 2) 60 Minute Virtual, Tuesday 2:00pm New York.
    const id60 = await book(page, { slug: "60min", dayLabel: "Tuesday, October 8 - Times available", time: "2:00pm", name: "Ben Ito", email: "ben.golden@example.com" });
    await expect(page.getByTestId("confirmation-when")).toHaveText("2:00pm - 3:00pm, Tuesday, October 8, 2030");
    expect(id60).not.toBe(first);
    await emailTo(api, "ben.golden@example.com", "lifecycle.invitee_confirmation");

    // 3) In-Person Meal or Coffee (Block Off Work: Tuesdays 5:00pm to 8:00pm Los Angeles, 2 hours): a venue pick.
    const mealTimes = await openDay(page, "/julianjoseph/meal", "Tuesday, October 8 - Times available");
    await expect(mealTimes.getByRole("button").first()).toHaveText("8:00pm");
    await mealTimes.getByRole("button", { name: "8:00pm", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await fillDetails(page, { name: "Cleo Diaz", email: "cleo.golden@example.com", answer: "Catch up over coffee" });
    const venues = page.getByRole("radiogroup", { name: "Location" });
    await expect(venues.getByRole("radio")).toHaveCount(9);
    await venues.getByRole("radio", { name: /Harbor Bistro - Waterfront/ }).click();
    await scheduleEvent(page);
    await expect(page.getByTestId("confirmation-when")).toHaveText("8:00pm - 10:00pm, Tuesday, October 8, 2030");
    const summary = page.getByRole("region", { name: "Meeting details" });
    await expect(summary).toContainText("Harbor Bistro - Waterfront");
    await expect(summary).toContainText("250 Embarcadero, San Francisco, CA 94111");
    const mealEmail = await emailTo(api, "cleo.golden@example.com", "lifecycle.invitee_confirmation");
    expect(mealEmail.text).toContain("Harbor Bistro - Waterfront");

    // The booked times are gone from the booking pages (buffers and the meal's two hours).
    const after = await openDay(page, "/julianjoseph/30min", "Monday, October 7 - Times available");
    await expect(after.getByRole("button", { name: "3:00pm", exact: true })).toHaveCount(0);
    await expect(after.getByRole("button", { name: "3:30pm", exact: true })).toHaveCount(0); // 15 min buffer after
    await expect(after.getByRole("button", { name: "4:00pm", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("the invitee reschedules and then cancels through the email links", async ({ page, api, axe }) => {
    test.setTimeout(180_000);
    const email = "dana.golden@example.com";
    const firstId = await book(page, { slug: "30min", dayLabel: "Monday, October 7 - Times available", time: "4:00pm", name: "Dana Kim", email, answer: "Hiring plan" });
    const confirmation = await emailTo(api, email, "lifecycle.invitee_confirmation");

    // Reschedule: the former time struck through, a new time, the details prefilled, "Update Event".
    await open(page, linkOf(confirmation, "/reschedulings/"));
    await expect(page.getByTestId("former-when")).toHaveText("4:00pm - 4:30pm, Monday, October 7, 2030", SLOW);
    const day = page.getByRole("button", { name: "Wednesday, October 9 - Times available" });
    await expect(day).toBeEnabled(SLOW);
    await day.click();
    await page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: "3:00pm", exact: true }).click();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveValue(email, SLOW);
    await expect(page.getByRole("textbox", { name: "What would you like to discuss?", exact: true })).toHaveValue("Hiring plan");
    await page.getByRole("textbox", { name: "Reason for change" }).fill("Travel day");
    await page.waitForTimeout(2100);
    await page.getByRole("button", { name: "Update Event" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "You are rescheduled" })).toBeVisible(SLOW);
    await expect(page.getByTestId("confirmation-when")).toHaveText("3:00pm - 3:30pm, Wednesday, October 9, 2030");
    const newId = /\/booking\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
    expect(newId).toBeTruthy();
    const updated = await emailTo(api, email, "lifecycle.invitee_rescheduled");
    expect(updated.subject).toBe("Updated: 30 Minute Virtual with Julian Joseph on Wednesday, October 9, 2030");
    expect(updated.text).toContain("Travel day");
    expect(updated.hasIcs).toBe(true);
    const hostMoved = await emailTo(api, OWNER, "lifecycle.host_rescheduled");
    expect(hostMoved.text).toContain("Dana Kim");
    // The old time is free again, the new one taken.
    const monday = await openDay(page, "/julianjoseph/30min", "Monday, October 7 - Times available");
    await expect(monday.getByRole("button", { name: "4:00pm", exact: true })).toBeVisible();

    // Cancel through the (old) cancel link: it follows the reschedule to the new invitee.
    await open(page, linkOf(confirmation, "/cancellations/"));
    await expect(page).toHaveURL(new RegExp(`/cancellations/${newId}$`));
    await expect(page.getByRole("heading", { name: "Cancel Event?" })).toBeVisible(SLOW);
    await expect(page.getByTestId("summary-when")).toHaveText("3:00pm - 3:30pm, Wednesday, October 9, 2030");
    await axe(page);
    await page.getByRole("textbox", { name: "Reason for canceling" }).fill("No longer needed");
    await page.getByRole("button", { name: "Cancel Event" }).click();
    await expect(page.getByRole("heading", { name: "Cancellation Confirmed" })).toBeVisible(SLOW);
    const canceled = await emailTo(api, email, "lifecycle.invitee_canceled");
    expect(canceled.text).toContain("No longer needed");
    expect(canceled.icsMethod).toBe("CANCEL");
    await emailTo(api, OWNER, "lifecycle.host_canceled");
    const wednesday = await openDay(page, "/julianjoseph/30min?month=2030-10", "Wednesday, October 9 - Times available");
    await expect(wednesday.getByRole("button", { name: "3:00pm", exact: true })).toBeVisible(SLOW);
    expect(firstId).not.toBe(newId);
  });

  test.describe("phone", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test("books the meal with a venue at phone width without horizontal scroll", async ({ page, api, axe }) => {
      test.setTimeout(180_000);
      await page.goto("/julianjoseph", SLOW);
      await expect(page.getByRole("heading", { level: 1, name: "Julian Joseph" })).toBeVisible(SLOW);
      expect(await fitsWidth(page)).toBe(true);
      await page.getByRole("list", { name: "Event types" }).getByRole("link", { name: "In-Person Meal or Coffee" }).click();
      const day = page.getByRole("button", { name: "Wednesday, October 9 - Times available" });
      await expect(day).toBeEnabled(SLOW);
      expect(await fitsWidth(page)).toBe(true);
      await day.click();
      const times = page.getByRole("list", { name: "Select a time" });
      await times.getByRole("button", { name: "8:30pm", exact: true }).click();
      await page.getByRole("button", { name: "Next", exact: true }).click();
      await fillDetails(page, { name: "Eli Park", email: "eli.golden@example.com", answer: "Lunch" });
      expect(await fitsWidth(page)).toBe(true);
      await page.getByRole("radiogroup", { name: "Location" }).getByRole("radio", { name: /Sunrise Coffee House/ }).click();
      await axe(page);
      await scheduleEvent(page);
      await expect(page.getByTestId("confirmation-when")).toHaveText("8:30pm - 10:30pm, Wednesday, October 9, 2030");
      expect(await fitsWidth(page)).toBe(true);
      await emailTo(api, "eli.golden@example.com", "lifecycle.invitee_confirmation");
    });
  });
});
