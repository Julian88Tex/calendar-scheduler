// Conferencing in the real Next server (SPEC VID-07, VID-11, CAL-21; docs/SCOPE.md: Google Meet only). Integrations >
// Google Meet in each state (not connected or not configured, ready after a Google Calendar connect, reconnect, no
// calendar to add events to), the event types that use Meet, 404 for providers out of scope, no horizontal scroll on
// phones, axe; the stable join link of seeded meetings (Meet without a link, an in-person venue) and unknown ids.
// The 302 to a stored Meet link is covered by tests/conferencing (it needs a provisioned meeting).
import type { Page } from "@playwright/test";
import { expect, test, type TestApi } from "../fixtures";

const MEET = "/app/integrations/conferencing/google-meet";
/** The server inherits this process's environment (playwright.config.ts), so both see the same Google client. */
const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

type Seeded = { owner: { userId: string }; demoData?: { scheduledEventIds: string[] } };

async function connectGoogle(api: TestApi, body: { accountEmail: string; calendars?: { id: string; name: string; primary?: boolean; writable?: boolean }[]; status?: "needs_reauth" }) {
  const res = await api.call("POST", "/api/integrations/calendars/test-connect", { email: "owner@example.com", ...body });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { connectionId: string };
}

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test.describe("Integrations > Google Meet", () => {
  test.beforeEach(async ({ api, seed, page, loginAs }) => {
    await api.reset();
    await seed("owner");
    await loginAs(page, "owner@example.com");
  });

  test("explains what is missing before Google Calendar is connected", async ({ page, axe }) => {
    const errors = trackPageErrors(page);
    await page.goto(MEET);
    await expect(page.getByRole("heading", { level: 1, name: "Google Meet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Integrations & apps" })).toBeVisible();
    if (googleConfigured) {
      await expect(page.getByText("Connect Google Calendar to use Google Meet")).toBeVisible();
      await expect(page.getByRole("link", { name: "Connect Google Calendar" })).toHaveAttribute(
        "href",
        "/api/auth/google/start?intent=connect_calendar&next=%2Fapp%2Fintegrations%2Fconferencing%2Fgoogle-meet",
      );
    } else {
      await expect(page.getByText("Not configured on this server").first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Connect Google Calendar" })).toHaveCount(0);
    }
    // The seeded virtual event types use Google Meet; the in-person one does not.
    const list = page.getByRole("region", { name: "Event types using Google Meet" });
    await expect(list.getByText("30 Minute Virtual")).toBeVisible();
    await expect(list.getByText("60 Minute Virtual")).toBeVisible();
    await expect(list.getByText("In-Person Meal or Coffee")).toHaveCount(0);
    await expect(list.getByText("Web conferencing details to follow.")).toBeVisible();
    await expect(list.getByRole("link", { name: "Edit 30 Minute Virtual" })).toHaveAttribute("href", /\/app\/event-types\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("is ready once Google Calendar is connected and chosen for new events", async ({ page, api, axe }) => {
    await connectGoogle(api, { accountEmail: "owner.calendar@gmail.com", calendars: [{ id: "owner.calendar@gmail.com", name: "owner.calendar@gmail.com", primary: true }] });
    await page.goto(`${MEET}?connected=google`);
    await expect(page.getByRole("status").filter({ hasText: "Google Calendar connected" })).toBeVisible();
    await expect(page.getByText("Google Meet is ready")).toBeVisible();
    await expect(page.getByText("New meetings on event types that use Google Meet get a Meet link from owner.calendar@gmail.com.")).toBeVisible();
    await expect(page.getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByText("Ready", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Calendar settings" })).toHaveAttribute("href", "/app/availability/calendar-settings");
    const list = page.getByRole("region", { name: "Event types using Google Meet" });
    await expect(list.getByText("Web conferencing details to follow.")).toHaveCount(0);
    await axe(page);
  });

  test("asks to reconnect a connection that needs attention", async ({ page, api }) => {
    const { connectionId } = await connectGoogle(api, { accountEmail: "owner.calendar@gmail.com", status: "needs_reauth" });
    await page.goto(MEET);
    await expect(page.getByText("Reconnect Google Calendar").first()).toBeVisible();
    await expect(page.getByText("We can't access your Google Calendar anymore")).toBeVisible();
    if (googleConfigured) {
      await expect(page.getByRole("link", { name: "Reconnect Google Calendar" })).toHaveAttribute("href", new RegExp(`reconnect=${connectionId}`));
    }
  });

  test("asks for a Google calendar to add events to when only read-only calendars exist", async ({ page, api }) => {
    await connectGoogle(api, { accountEmail: "owner.calendar@gmail.com", calendars: [{ id: "holidays", name: "Holidays", primary: true, writable: false }] });
    await page.goto(MEET);
    await expect(page.getByText("Choose a Google calendar to add events to")).toBeVisible();
    await expect(
      page.getByText("You must configure your calendar connections to push events to a Google Calendar to host Google Meet web conferences on your events."),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Choose a calendar" })).toHaveAttribute("href", "/app/availability/calendar-settings");
  });

  test("answers 404 for conferencing providers out of scope", async ({ page }) => {
    for (const provider of ["zoom", "microsoft-teams", "jitsi", "webex", "gotomeeting", "nope"]) {
      const res = await page.goto(`/app/integrations/conferencing/${provider}`);
      expect(res?.status(), provider).toBe(404);
    }
  });

  test("fits a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(MEET);
    await expect(page.getByRole("heading", { level: 1, name: "Google Meet" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("stable join link", () => {
  let seeded: Seeded;

  test.beforeEach(async ({ api, seed }) => {
    await api.reset();
    seeded = (await seed("owner", { demo: true })) as unknown as Seeded;
  });

  test("shows 'Web conferencing details to follow.' for a seeded Meet meeting without a link", async ({ page, request, axe }) => {
    const id = seeded.demoData!.scheduledEventIds[0]!;
    const res = await request.get(`/events/${id}/join`, { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    await page.goto(`/events/${id}/join`);
    await expect(page.getByRole("heading", { level: 1, name: "30 Minute Virtual" })).toBeVisible();
    await expect(page.getByText("Web conferencing details to follow.")).toBeVisible();
    await axe(page);
  });

  test("shows the venue of an in-person meeting", async ({ page, axe }) => {
    const id = seeded.demoData!.scheduledEventIds[2]!;
    await page.goto(`/events/${id}/join`);
    await expect(page.getByRole("heading", { level: 1, name: "In-Person Meal or Coffee" })).toBeVisible();
    await expect(page.getByText("In-person meeting")).toBeVisible();
    await expect(page.getByText("Sunrise Coffee House - Noe Valley - $")).toBeVisible();
    await expect(page.getByText("4001 24th Street, San Francisco, CA 94114")).toBeVisible();
    await axe(page);
  });

  test("answers 404 for unknown meetings", async ({ request, page }) => {
    const unknown = await request.get("/events/00000000-0000-4000-8000-000000000000/join", { maxRedirects: 0 });
    expect(unknown.status()).toBe(404);
    expect(await unknown.text()).toContain("Meeting not found");
    expect((await request.get("/events/not-a-meeting/join", { maxRedirects: 0 })).status()).toBe(404);
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto("/events/00000000-0000-4000-8000-000000000000/join");
    await expect(page.getByRole("heading", { level: 1, name: "Meeting not found" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
