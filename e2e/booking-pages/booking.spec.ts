// Public booking pages end to end (SPEC BK-01 to BK-09, BK-20, BK-22, GEN-05, GEN-06): the seeded owner's landing page,
// the calendar with month and date URL state, the [time][Next] split, the details form at /{slug}/{event}/{ISO start},
// validation, a real booking, the confirmation page in the invitee's zone and format, and the ICS download.
import { expect, test } from "../fixtures";

// Monday 2030-10-07 06:00 in Los Angeles: Working hours on Mondays are 12:00 to 17:00 Pacific, 4 hours notice, 15 minute
// increments, so the first start is 12:00 Pacific (15:00 in New York, the Playwright default zone).
const NOW = "2030-10-07T13:00:00Z";

test.describe("booking pages", () => {
  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await api.setTime(NOW);
    await seed("owner");
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test("landing page lists the event types in position order and links with back=1", async ({ page, axe }) => {
    const res = await page.goto("/julianjoseph");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveTitle(/Julian Joseph/);
    await expect(page.getByRole("heading", { level: 1, name: "Julian Joseph" })).toBeVisible();
    await expect(page.getByText("Welcome to my scheduling page. Please follow the instructions to add an event to my calendar.")).toBeVisible();
    const items = page.getByRole("list", { name: "Event types" }).getByRole("link");
    await expect(items).toHaveText(["30 Minute Virtual", "60 Minute Virtual", "In-Person Meal or Coffee"]);
    await expect(items.first()).toHaveAttribute("href", "/julianjoseph/30min?back=1");
    await expect(page.getByRole("button", { name: "Cookie settings" })).toBeVisible();
    await expect(page.getByTestId("powered-by-ribbon")).toBeVisible();
    await axe(page);
  });

  test("unknown handles and event slugs are 404", async ({ page }) => {
    for (const path of ["/nobody-here", "/julianjoseph/nope", "/julianjoseph/30min/not-a-date"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
    }
    await expect(page.getByRole("heading", { name: "This page isn't available" })).toBeVisible();
  });

  test("books the 30 minute event from the landing page", async ({ page, axe }) => {
    await page.goto("/julianjoseph");
    await page.getByRole("link", { name: "30 Minute Virtual" }).click();
    // Dev servers compile routes on first use: allow for it.
    await expect(page).toHaveURL(/\/julianjoseph\/30min\?back=1&month=2030-10$/, { timeout: 60_000 });
    await expect(page).toHaveTitle(/Select a Date & Time/);
    await expect(page.getByRole("heading", { level: 1, name: "30 Minute Virtual" })).toBeVisible();
    await expect(page.getByText("Web conferencing details provided upon confirmation.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to event types" })).toHaveAttribute("href", "/julianjoseph");

    const day = page.getByRole("button", { name: "Monday, October 7 - Times available" });
    await expect(day).toBeEnabled();
    await expect(page.getByRole("button", { name: "Saturday, October 12 - No times available" })).toBeDisabled();
    await expect(page.getByText("Eastern Time - US & Canada")).toBeVisible();
    await axe(page);

    await day.click();
    await expect(page).toHaveURL(/date=2030-10-07/);
    const times = page.getByRole("list", { name: "Select a time" });
    await expect(times.getByRole("button").first()).toHaveText("3:00pm");
    await times.getByRole("button", { name: "3:00pm" }).click();
    const next = page.getByRole("button", { name: "Next", exact: true });
    await expect(next).toBeFocused();
    await axe(page);
    await next.click();

    await expect(page).toHaveURL(/\/julianjoseph\/30min\/2030-10-07T19:00:00Z\?back=1&month=2030-10&date=2030-10-07$/);
    await expect(page.getByRole("heading", { name: "Enter Details" })).toBeVisible();
    await expect(page.getByTestId("details-when")).toHaveText("3:00pm - 3:30pm, Monday, October 7, 2030");
    await expect(page.getByTestId("details-zone")).toHaveText("Eastern Time - US & Canada");

    // Empty submit: inline errors, nothing lost.
    await page.getByRole("button", { name: "Schedule Event" }).click();
    await expect(page.locator('[data-field="name"]').getByRole("alert")).toHaveText("Can't be blank.");
    await expect(page.locator('[data-field="email"]').getByRole("alert")).toHaveText("Can't be blank.");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("not-an-email");
    await page.getByRole("button", { name: "Schedule Event" }).click();
    await expect(page.locator('[data-field="email"]').getByRole("alert")).toHaveText("Enter a valid email address.");
    await axe(page);

    await page.getByRole("textbox", { name: "Name", exact: true }).fill("Ana Lima");
    await page.getByRole("textbox", { name: "Email", exact: true }).fill("ana@example.com");
    await page.getByRole("textbox", { name: "What would you like to discuss?", exact: true }).fill("Roadmap review");
    await page.getByRole("button", { name: "Schedule Event" }).click();

    await expect(page).toHaveURL(/\/booking\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1, name: "You are scheduled" })).toBeVisible();
    await expect(page.getByText("You are scheduled with Julian Joseph.")).toBeVisible();
    await expect(page.getByText("A confirmation has been sent to your email address.")).toBeVisible();
    await expect(page.getByTestId("confirmation-when")).toHaveText("3:00pm - 3:30pm, Monday, October 7, 2030");
    await expect(page.getByTestId("confirmation-zone")).toHaveText("Eastern Time - US & Canada");
    await expect(page.getByText("Web conferencing details to follow.")).toBeVisible();
    await expect(page.getByTestId("schedule-another")).toHaveAttribute("href", "/julianjoseph/30min");
    await expect(page).toHaveTitle(/You are scheduled/);
    await axe(page);

    // The ICS download (BK-22).
    const ics = page.getByTestId("add-to-calendar").getByRole("link", { name: "Apple / iCal" });
    const href = await ics.getAttribute("href");
    expect(href).toMatch(/^\/booking\/[0-9a-f-]{36}\/event\.ics$/);
    const file = await page.request.get(href!);
    expect(file.status()).toBe(200);
    expect(file.headers()["content-type"]).toContain("text/calendar");
    const body = await file.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("DTSTART:20301007T190000Z");
    expect(body).toContain("DTEND:20301007T193000Z");
    const google = await page.getByTestId("add-to-calendar").getByRole("link", { name: "Google" }).getAttribute("href");
    expect(google).toContain("dates=20301007T190000Z%2F20301007T193000Z");
  });
});
