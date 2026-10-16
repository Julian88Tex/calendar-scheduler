// Availability > Calendar settings and Integrations > Google Calendar (SPEC CAL-01, CAL-06, CAL-07, CAL-08, CAL-13,
// CAL-14, CAL-15, CAL-16, CAL-21; docs/SCOPE.md: Google only). Google's consent screen is replaced by the E2E-only
// /api/integrations/calendars/test-connect route, which runs the real connect service with a given calendar list.
// Flows: empty state and the connect modal, connect (and a second account), conflict calendars, destination,
// sync settings, a broken connection with its banners, disconnect with confirmation, connect result messages, the
// integration page, 404 for providers out of scope, no horizontal scroll on phones, axe.
import type { Page } from "@playwright/test";
import { expect, test, type TestApi } from "../fixtures";

const SETTINGS = "/app/availability/calendar-settings";
/** The server inherits this process's environment (playwright.config.ts), so both see the same Google client. */
const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

async function connectGoogle(
  api: TestApi,
  body: { accountEmail: string; calendars?: { id: string; name: string; primary?: boolean; writable?: boolean; color?: string }[]; status?: "needs_reauth" | "error" },
) {
  const res = await api.call("POST", "/api/integrations/calendars/test-connect", { email: "owner@example.com", ...body });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()) as { connectionId: string };
}

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test.describe("calendar settings", () => {
  test.beforeEach(async ({ api, seed, page, loginAs }) => {
    await api.reset();
    await seed("owner");
    await loginAs(page, "owner@example.com");
  });

  test("empty state offers the connect modal with the Google Calendar tile", async ({ page, axe }) => {
    const errors = trackPageErrors(page);
    await page.goto(SETTINGS);
    await expect(page.getByRole("heading", { name: "Calendar connections" })).toBeVisible();
    await expect(page.getByText("0 of 6 calendar accounts")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connect your calendar" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Configuration" })).toHaveCount(0);
    await axe(page);
    await page.getByRole("button", { name: "Connect calendar account" }).click();
    const dialog = page.getByRole("dialog", { name: "Connect calendar account" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Google Calendar", { exact: true })).toBeVisible();
    await expect(dialog.getByText("Gmail, G Suite")).toBeVisible();
    // Only Google is offered (docs/SCOPE.md).
    await expect(dialog.getByText(/Outlook|iCloud|CalDAV|ICS/)).toHaveCount(0);
    const link = dialog.getByTestId("connect-google");
    if (googleConfigured) {
      await expect(link).toHaveAttribute("href", /\/api\/auth\/google\/start\?intent=connect_calendar&next=%2Fapp%2Favailability%2Fcalendar-settings/);
    } else {
      await expect(dialog.getByText("Not configured on this server")).toBeVisible();
    }
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("connect, choose conflict calendars and the destination, sync settings, second account", async ({ page, api, axe }) => {
    const errors = trackPageErrors(page);
    await connectGoogle(api, {
      accountEmail: "julian@gmail.com",
      calendars: [
        { id: "julian@gmail.com", name: "Julian Personal", primary: true, color: "#9fe1e7" },
        { id: "team@group.calendar.google.com", name: "Team", color: "#7986cb" },
        { id: "holidays@group.v.calendar.google.com", name: "Holidays in United States", writable: false, color: "#16a765" },
      ],
    });
    await page.goto(`${SETTINGS}?connected=google`);
    await expect(page.getByText("Google Calendar connected")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${SETTINGS}$`));
    await expect(page.getByText("1 of 6 calendar accounts")).toBeVisible();
    const accounts = page.getByRole("list", { name: "Connected calendar accounts" });
    await expect(accounts.getByText("julian@gmail.com")).toBeVisible();
    await expect(accounts.getByText("Connected", { exact: true })).toBeVisible();

    // Defaults: the primary calendar checks conflicts and receives new events.
    const config = page.getByRole("region", { name: "Configuration" });
    await expect(config.getByText("Checking 1 of 3 calendars")).toBeVisible();
    await expect(page.getByTestId("destination-calendar")).toHaveText("Julian Personal");
    await axe(page);

    // Check the Team calendar too.
    await page.getByRole("button", { name: "Edit calendars to check for conflicts" }).click();
    const conflicts = page.getByRole("dialog", { name: "Check for conflicts" });
    await expect(conflicts.getByRole("checkbox", { name: "Julian Personal" })).toBeChecked();
    await expect(conflicts.getByText("View only")).toBeVisible();
    await conflicts.getByRole("checkbox", { name: "Team" }).check();
    await conflicts.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Changes saved").first()).toBeVisible();
    await expect(conflicts).toBeHidden();
    await expect(config.getByText("Checking 2 of 3 calendars")).toBeVisible();

    // Move new events to Team; read-only calendars are not offered.
    await page.getByRole("button", { name: "Edit calendar to add events to" }).click();
    const dest = page.getByRole("dialog", { name: "Add to calendar" });
    await expect(dest.getByRole("radio", { name: /Holidays/ })).toHaveCount(0);
    await dest.getByRole("radio", { name: "Team" }).check();
    await dest.getByRole("button", { name: "Save" }).click();
    await expect(dest).toBeHidden();
    await expect(page.getByTestId("destination-calendar")).toHaveText("Team");

    // Sync settings of the destination save immediately and persist.
    const buffers = page.getByRole("checkbox", { name: "Include buffers on this calendar" });
    const sync = page.getByRole("checkbox", { name: /Automatically sync cancellations and reschedules from this calendar/ });
    await expect(buffers).not.toBeChecked();
    await expect(sync).toBeChecked();
    await buffers.check();
    await expect(page.getByText("Changes saved").first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Include buffers on this calendar" })).toBeChecked();

    // None: email confirmations only, then pick a calendar that is not checked to see the recommendation.
    await page.getByRole("button", { name: "Edit calendar to add events to" }).click();
    await page.getByRole("dialog", { name: "Add to calendar" }).getByRole("radio", { name: /None/ }).check();
    await page.getByRole("dialog", { name: "Add to calendar" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("destination-calendar")).toContainText("None. New meetings aren't added to a calendar");

    // A second Google account (CAL-06); with no destination its primary calendar becomes it (CAL-08).
    await connectGoogle(api, { accountEmail: "julian@company.com", calendars: [{ id: "julian@company.com", name: "Work", primary: true }] });
    await page.reload();
    await expect(page.getByText("2 of 6 calendar accounts")).toBeVisible();
    await expect(accounts.getByText("julian@company.com")).toBeVisible();
    await expect(page.getByTestId("destination-calendar")).toHaveText("Work");
    await expect(config.getByText("Checking 1 of 1 calendar")).toBeVisible();
    // Destinations across accounts are one choice: back to Team (not checked here: the page recommends checking it).
    await page.getByRole("button", { name: "Edit calendar to add events to" }).click();
    await page.getByRole("dialog", { name: "Add to calendar" }).getByRole("radio", { name: "Team" }).check();
    await expect(page.getByRole("dialog", { name: "Add to calendar" }).getByRole("radio", { name: /^Work/ })).not.toBeChecked();
    await page.getByRole("dialog", { name: "Add to calendar" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("destination-calendar")).toHaveText("Team");
    // A destination that is not checked for conflicts gets a recommendation with a one-click fix (CAL-08).
    await page.getByRole("button", { name: "Edit calendars to check for conflicts" }).click();
    await page.getByRole("dialog", { name: "Check for conflicts" }).getByRole("checkbox", { name: "Team" }).uncheck();
    await page.getByRole("dialog", { name: "Check for conflicts" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Team isn't checked for conflicts.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Check it for conflicts" }).click();
    await expect(page.getByText("Team isn't checked for conflicts.", { exact: false })).toHaveCount(0);
    await axe(page);
    expect(errors).toEqual([]);
  });

  test("a broken connection shows Action required, the dashboard banner and Reconnect", async ({ page, api }) => {
    await connectGoogle(api, { accountEmail: "broken@gmail.com", status: "needs_reauth" });
    await page.goto(SETTINGS);
    const accounts = page.getByRole("list", { name: "Connected calendar accounts" });
    await expect(accounts.getByText("Action required")).toBeVisible();
    await expect(accounts.getByText(/We can't access this calendar anymore/)).toBeVisible();
    await expect(page.getByText("There is a problem with your calendar connection.")).toBeVisible();
    const reconnect = accounts.getByRole("link", { name: "Reconnect" });
    if (googleConfigured) await expect(reconnect).toHaveAttribute("href", /intent=connect_calendar.*reconnect=/);
    else await expect(reconnect).toHaveCount(0); // reconnecting needs the Google OAuth client
    await page.goto("/app/scheduling");
    await expect(page.getByText("There is a problem with your calendar connection.")).toBeVisible();
  });

  test("disconnect asks for confirmation and removes the account", async ({ page, api, axe }) => {
    await connectGoogle(api, { accountEmail: "gone@gmail.com" });
    await page.goto(SETTINGS);
    await page.getByRole("button", { name: "Options for gone@gmail.com" }).click();
    await page.getByRole("menuitem", { name: "Disconnect" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Disconnect gone@gmail.com?" });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByText(/Events already added to this calendar stay there/)).toBeVisible();
    await axe(page);
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("list", { name: "Connected calendar accounts" }).getByText("gone@gmail.com")).toBeVisible();
    await page.getByRole("button", { name: "Options for gone@gmail.com" }).click();
    await page.getByRole("menuitem", { name: "Disconnect" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Disconnect" }).click();
    await expect(page.getByText("Calendar disconnected")).toBeVisible();
    await expect(page.getByText("0 of 6 calendar accounts")).toBeVisible();
    await expect(page.getByText(/New meetings won't be added to a calendar until you choose/)).toBeVisible();
  });

  test("connect problems from the OAuth round trip are explained", async ({ page }) => {
    await page.goto(`${SETTINGS}?calendar_error=permissions&provider=google`);
    await expect(page.getByRole("alert").filter({ hasText: "needs permission to see and edit events on your Google Calendar" })).toBeVisible();
    await page.goto(`${SETTINGS}?oauth_error=canceled&provider=google`);
    await expect(page.getByText("Connecting Google Calendar was canceled.")).toBeVisible();
  });

  test("the Google Calendar integration page and providers out of scope", async ({ page, api, axe }) => {
    await page.goto("/app/integrations/calendars/google");
    await expect(page.getByRole("heading", { name: "Google Calendar", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    await axe(page);
    await connectGoogle(api, { accountEmail: "julian@gmail.com" });
    await page.reload();
    await expect(page.getByRole("region", { name: "Connected accounts" }).getByText("julian@gmail.com")).toBeVisible();
    await expect(page.getByRole("link", { name: "Calendar settings" })).toHaveAttribute("href", SETTINGS);
    for (const p of ["microsoft", "icloud", "caldav", "ics"]) {
      await page.goto(`/app/integrations/calendars/${p}`);
      await expect(page.getByRole("heading", { name: "Page not found" }), p).toBeVisible();
    }
  });

  test("no horizontal scroll on a phone", async ({ page, api }) => {
    await connectGoogle(api, { accountEmail: "a-very-long-calendar-account-name@example-company-domain.com" });
    await page.setViewportSize({ width: 360, height: 780 });
    for (const path of [SETTINGS, "/app/integrations/calendars/google"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
