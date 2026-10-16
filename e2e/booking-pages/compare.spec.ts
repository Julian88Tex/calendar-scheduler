// "Compare with my calendar" on the public booking page: any visitor can connect their own Google Calendar (OAuth
// intent compare_calendar), pick which of their calendars count, and the host's open times that clash read "Conflict".
// Google itself is replaced by a fake connection (POST /api/test/compare) holding calendars and busy times; the real
// start link is checked up to the Google redirect, which E2E servers refuse (Google is not configured there).
import { E2E_SECRET_HEADER, e2eSecret, expect, test } from "../fixtures";

// Monday 2030-10-07 09:00 in New York (the Playwright zone). Tuesday October 8 offers 12:00 to 17:00 Pacific, so its
// times run from 3:00pm Eastern; 3:00pm and 3:30pm Eastern are 19:00 and 19:30 UTC.
const NOW = "2030-10-07T13:00:00Z";
const SLOW = { timeout: 60_000 };
const SHOTS = process.env.COMPARE_SHOTS;
const TUESDAY = "Tuesday, October 8 - Times available";

const FAKE = {
  email: "alex@example.com",
  calendars: [
    { id: "primary", name: "Alex Rivera", color: "#039be5", primary: true },
    { id: "work@example.com", name: "Work", color: "#f4511e", selected: false },
    { id: "family@example.com", name: "Family", color: "#33b679", selected: true },
  ],
  busy: {
    primary: [{ start: "2030-10-08T19:00:00Z", end: "2030-10-08T19:30:00Z" }],
    "work@example.com": [{ start: "2030-10-08T19:30:00Z", end: "2030-10-08T20:00:00Z" }],
    "family@example.com": [{ start: "2030-10-08T21:00:00Z", end: "2030-10-08T21:30:00Z" }],
  },
};

test.describe("compare with my calendar", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    await api.setTime(NOW);
    await seed("owner");
  });

  test.afterEach(async ({ api }) => {
    await api.setTime(null);
  });

  test("a visitor starts Google with free/busy only and comes back to the panel", async ({ page, axe }) => {
    await page.goto("/julianjoseph/30min", SLOW);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/0-entry.png` });
    await page.getByTestId("compare-open").click();
    const bar = page.getByTestId("compare-bar");
    await expect(bar).toContainText("Only busy times are read, never what your events are.", SLOW);
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-connect.png` });

    const start = page.waitForRequest((r) => r.url().includes("/api/auth/google/start"));
    await bar.getByRole("button", { name: "Connect Google Calendar" }).click();
    const url = new URL((await start).url());
    expect(url.searchParams.get("intent")).toBe("compare_calendar");
    const next = new URL(url.searchParams.get("next")!, "http://x.invalid");
    expect(next.pathname).toBe("/julianjoseph/30min");
    expect(next.searchParams.get("compare")).toBe("1");
    // Google is not configured on E2E servers: the flow returns to the booking page with the panel open and an error.
    await expect(page).toHaveURL(/\/julianjoseph\/30min\?.*oauth_error=not_configured/, SLOW);
    await expect(page.getByTestId("compare-bar").getByRole("alert")).toHaveText("We couldn't connect to your Google Calendar. Try again.", SLOW);
  });

  test("connected visitors see Conflict on the host's times that clash with the calendars they pick", async ({ page, axe, baseURL }) => {
    const res = await page.request.post("/api/test/compare", { headers: { [E2E_SECRET_HEADER]: e2eSecret() }, data: FAKE });
    expect(res.ok()).toBe(true);
    await page.goto("/julianjoseph/30min?compare=1", SLOW);
    const bar = page.getByTestId("compare-bar");
    await expect(bar.getByTestId("compare-email")).toHaveText("Comparing with alex@example.com", SLOW);
    // The primary calendar and the ones shown in the visitor's Google Calendar start checked.
    await expect(bar.getByRole("checkbox", { name: "Alex Rivera" })).toBeChecked();
    await expect(bar.getByRole("checkbox", { name: "Family" })).toBeChecked();
    await expect(bar.getByRole("checkbox", { name: "Work" })).not.toBeChecked();

    await page.getByRole("button", { name: TUESDAY }).click();
    const list = page.getByRole("list", { name: "Select a time" });
    await expect(list.getByRole("button", { name: /^3:00pm\s*Conflict$/ })).toBeVisible(SLOW);
    await expect(list.getByRole("button", { name: /^3:30pm$/ })).toBeVisible();
    await expect(list.getByRole("button", { name: /^5:00pm\s*Conflict$/ })).toBeVisible();
    await expect(bar.getByTestId("compare-status")).toHaveText("Times marked Conflict overlap events on your calendar.");
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-compared.png` });

    // Adding Work marks 3:30pm; dropping the primary calendar frees 3:00pm. The choice survives a reload.
    await bar.getByRole("checkbox", { name: "Work" }).click();
    await expect(list.getByRole("button", { name: /^3:30pm\s*Conflict$/ })).toBeVisible();
    await bar.getByRole("checkbox", { name: "Alex Rivera" }).click();
    await expect(list.getByRole("button", { name: /^3:00pm$/ })).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("compare-bar").getByRole("checkbox", { name: "Work" })).toBeChecked(SLOW);
    await expect(page.getByTestId("compare-bar").getByRole("checkbox", { name: "Alex Rivera" })).not.toBeChecked();

    await page.emulateMedia({ colorScheme: "dark" });
    await page.getByRole("button", { name: TUESDAY }).click();
    await expect(list.getByRole("button", { name: /^3:30pm\s*Conflict$/ })).toBeVisible(SLOW);
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-compared-dark.png` });
    await page.emulateMedia({ colorScheme: "light" });

    // Phones: the panel sits under "Select a Day" and the times screen shows the conflicts.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/julianjoseph/30min?compare=1", SLOW);
    await expect(page.getByTestId("compare-email")).toBeVisible(SLOW);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-phone-panel.png`, fullPage: true });
    await page.getByRole("button", { name: TUESDAY }).click();
    await expect(page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: /^3:30pm\s*Conflict$/ })).toBeVisible(SLOW);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-phone-times.png` });
    await page.setViewportSize({ width: 1280, height: 720 });

    // Disconnect forgets the connection: no more conflicts, and the busy API refuses.
    await page.getByTestId("compare-disconnect").click();
    await expect(page.getByTestId("compare-connect")).toBeVisible();
    await expect(page.getByText("Conflict")).toHaveCount(0);
    const after = await page.request.post("/api/public/compare/busy", {
      headers: { origin: baseURL! },
      data: { calendarIds: ["primary"], start: "2030-10-01T00:00:00Z", end: "2030-10-30T00:00:00Z" },
    });
    expect(after.status()).toBe(401);
  });

  test("calendars Google won't read stay listed, grayed out with the reason, and other failures are named", async ({ page, axe }) => {
    const data = {
      ...FAKE,
      calendars: [...FAKE.calendars, { id: "holidays@group.v.calendar.google.com", name: "Holidays in United States", color: "#0b8043", selected: true }],
      failed: { "holidays@group.v.calendar.google.com": "no_access", "family@example.com": "temporary" },
    };
    const res = await page.request.post("/api/test/compare", { headers: { [E2E_SECRET_HEADER]: e2eSecret() }, data });
    expect(res.ok()).toBe(true);
    await page.goto("/julianjoseph/30min?compare=1", SLOW);
    const bar = page.getByTestId("compare-bar");
    // Holidays: listed last, unchecked and disabled, with why it can't be used, and never looked up.
    const holidays = bar.getByRole("checkbox", { name: /Holidays in United States/ });
    await expect(holidays).toBeVisible(SLOW);
    await expect(holidays).toBeDisabled();
    await expect(holidays).not.toBeChecked();
    await expect(holidays).toHaveAccessibleDescription("Can't be compared. Google doesn't share busy times for this calendar.");
    await expect(bar.locator("fieldset label")).toHaveText([/Alex Rivera/, /Family/, /Work/, /Holidays in United States/]);
    // Family: a temporary failure, named in the warning with a retry.
    const warning = bar.getByTestId("compare-failed");
    await expect(warning).toBeVisible(SLOW);
    await expect(warning.getByText("We couldn't check 1 of your calendars")).toBeVisible();
    await expect(warning.getByRole("listitem")).toHaveText(["Family: Google had a temporary problem reading it."]);
    await expect(warning).toContainText("Times that clash with events on it aren't marked Conflict.");
    await expect(bar.getByTestId("compare-calendar-failed")).toHaveCount(1);
    await expect(bar.getByTestId("compare-retry")).toBeVisible();
    // The calendars that could be read still count.
    await page.getByRole("button", { name: TUESDAY }).click();
    await expect(page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: /^3:00pm\s*Conflict$/ })).toBeVisible(SLOW);
    await axe(page);
    if (SHOTS) await bar.screenshot({ path: `${SHOTS}/6-failed-calendars.png` });
    await page.emulateMedia({ colorScheme: "dark" });
    await axe(page);
    if (SHOTS) await bar.screenshot({ path: `${SHOTS}/7-failed-calendars-dark.png` });
    await page.emulateMedia({ colorScheme: "light" });

    // Unchecking the failed calendar clears the warning; Holidays keeps its reason.
    await bar.getByRole("checkbox", { name: /Family/ }).click();
    await expect(warning).toHaveCount(0);
    await expect(bar.getByTestId("compare-calendar-unreadable")).toHaveText("Can't be compared. Google doesn't share busy times for this calendar.");
  });

  test("Conflict names the visitor's own event once they allow it, and only asks when they click", async ({ page, axe }) => {
    // Busy-only connection: plain Conflict, and a link that asks Google for event access.
    let res = await page.request.post("/api/test/compare", { headers: { [E2E_SECRET_HEADER]: e2eSecret() }, data: FAKE });
    expect(res.ok()).toBe(true);
    await page.goto("/julianjoseph/30min?compare=1", SLOW);
    const bar = page.getByTestId("compare-bar");
    await expect(bar.getByTestId("compare-email")).toBeVisible(SLOW);
    await page.getByRole("button", { name: TUESDAY }).click();
    const list = page.getByRole("list", { name: "Select a time" });
    await expect(list.getByRole("button", { name: /^3:00pm\s*Conflict$/ })).toBeVisible(SLOW);
    await expect(bar).toContainText("Want to see which event is in the way?");
    const start = page.waitForRequest((r) => r.url().includes("/api/auth/google/start"));
    await bar.getByTestId("compare-names").click();
    const url = new URL((await start).url());
    expect(url.searchParams.get("intent")).toBe("compare_calendar");
    expect(url.searchParams.get("events")).toBe("1");

    // Event access allowed: the clash names every event it overlaps; a clash with an untitled event stays plain.
    res = await page.request.post("/api/test/compare", {
      headers: { [E2E_SECRET_HEADER]: e2eSecret() },
      data: {
        ...FAKE,
        events: true,
        titles: {
          primary: [{ start: "2030-10-08T19:00:00Z", end: "2030-10-08T19:30:00Z", title: "Dentist appointment with Dr. Alvarez downtown" }],
          "family@example.com": [{ start: "2030-10-08T19:15:00Z", end: "2030-10-08T19:30:00Z", title: "School pickup" }],
        },
      },
    });
    expect(res.ok()).toBe(true);
    await page.goto("/julianjoseph/30min?compare=1", SLOW);
    await expect(bar.getByTestId("compare-status")).toHaveText("Times marked Conflict overlap events on your calendar. Event names show only to you and aren't saved.", SLOW);
    await expect(bar.getByTestId("compare-names")).toHaveCount(0);
    await page.getByRole("button", { name: TUESDAY }).click();
    await expect(list.getByRole("button", { name: /^3:00pm\s*Conflict: Dentist appointment with Dr\. Alvarez downtown, School pickup$/ })).toBeVisible(SLOW);
    await expect(list.getByRole("button", { name: /^5:00pm\s*Conflict$/ })).toBeVisible();
    await expect(list.getByRole("button", { name: /^3:30pm$/ })).toBeVisible();
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/8-named-conflict.png` });
    await page.emulateMedia({ colorScheme: "dark" });
    await axe(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/9-named-conflict-dark.png` });
    await page.emulateMedia({ colorScheme: "light" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/julianjoseph/30min?compare=1", SLOW);
    await expect(page.getByTestId("compare-email")).toBeVisible(SLOW);
    await page.getByRole("button", { name: TUESDAY }).click();
    await expect(page.getByRole("list", { name: "Select a time" }).getByRole("button", { name: /^3:00pm\s*Conflict: Dentist.*, School pickup$/ })).toBeVisible(SLOW);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/10-named-conflict-phone.png` });
  });

  test("the compare APIs refuse cross-site requests and are absent from embeds", async ({ page }) => {
    const res = await page.request.post("/api/public/compare/busy", {
      headers: { origin: "https://evil.example" },
      data: { calendarIds: ["primary"], start: "2030-10-01T00:00:00Z", end: "2030-10-30T00:00:00Z" },
    });
    expect(res.status()).toBe(403);
    expect(await (await page.request.get("/api/public/compare")).json()).toEqual({ connected: false });
    await page.goto("/julianjoseph/30min?embed_type=Inline&embed_domain=example.com", SLOW);
    await expect(page.getByRole("button", { name: TUESDAY })).toBeVisible(SLOW);
    await expect(page.getByTestId("compare-open")).toHaveCount(0);
  });
});
