// Conferencing options matrix on PGlite (SPEC VID-07, VID-16; docs/SCOPE.md: Google Meet only): Meet is available
// exactly when the destination calendar is a writable Google calendar that allows Meet; otherwise the reason and the
// fix link say why (server not configured, not connected, reconnect, no calendar to add events to, Meet turned off).
// Every other kind is unavailable. The Google Meet page lists the user's own event types that use Meet.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { calendars, eventTypes, users } = await import("@/db/schema");
const { getConferencingOptions, getGoogleMeetStatus, listMeetEventTypes } = await import("@/lib/conferencing");
const { createCalendarConnection, createEventType, createUser } = await import("../factories");
const { useTestDb } = await import("../helpers/db");

const t = useTestDb();
const env = process.env as Record<string, string | undefined>;
const VID07 = "You must configure your calendar connections to push events to a Google Calendar to host Google Meet web conferences on your events.";

beforeEach(() => {
  env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  env.GOOGLE_CLIENT_SECRET = "test-secret";
});
afterEach(() => {
  delete env.GOOGLE_CLIENT_ID;
  delete env.GOOGLE_CLIENT_SECRET;
});

async function googleUser(opts: { destination?: boolean; status?: "active" | "needs_reauth" | "error" | "disconnected"; canWrite?: boolean; allowed?: string[] } = {}) {
  const user = await createUser(t.db);
  const { connection, calendars: cals } = await createCalendarConnection(t.db, {
    userId: user.id,
    provider: "google",
    accountEmail: `${user.id.slice(0, 8)}@gmail.com`,
    status: opts.status ?? "active",
    calendars: [{ isPrimary: true, canWrite: opts.canWrite ?? true, name: "Work" }],
  });
  const cal = cals[0]!;
  if (opts.allowed) await t.db.update(calendars).set({ allowedOnlineMeetingProviders: opts.allowed }).where(eq(calendars.id, cal.id));
  if (opts.destination !== false) await t.db.update(users).set({ destinationCalendarId: cal.id }).where(eq(users.id, user.id));
  return { user, connection, calendar: cal };
}

describe("getConferencingOptions", () => {
  it("offers Google Meet when the destination is a writable Google calendar", async () => {
    const { user } = await googleUser();
    const options = await getConferencingOptions(user.id);
    expect(options.google_conference).toEqual({ available: true });
    for (const kind of ["microsoft_teams_conference", "zoom_conference", "jitsi_conference", "webex_conference", "gotomeeting_conference"] as const) {
      expect(options[kind]).toMatchObject({ available: false, code: "not_offered" });
    }
    const status = await getGoogleMeetStatus(user.id);
    expect(status).toMatchObject({ state: "ready", reason: null, fixUrl: null, calendar: { name: "Work", accountEmail: expect.stringContaining("@gmail.com") } });
  });

  it("asks to connect Google Calendar when there is no Google account", async () => {
    const user = await createUser(t.db);
    const option = (await getConferencingOptions(user.id)).google_conference;
    expect(option).toMatchObject({ available: false, code: "not_connected", reason: VID07 });
    expect(option.connectUrl).toBe("/api/auth/google/start?intent=connect_calendar&next=%2Fapp%2Fintegrations%2Fconferencing%2Fgoogle-meet");
  });

  it("says the server is not configured when Google OAuth is missing", async () => {
    delete env.GOOGLE_CLIENT_ID;
    const user = await createUser(t.db);
    const option = (await getConferencingOptions(user.id)).google_conference;
    expect(option).toMatchObject({ available: false, code: "not_configured", connectUrl: "/app/integrations/conferencing/google-meet" });
    expect(option.reason).toContain("isn't set up on this server");
  });

  it("asks for a calendar to add events to when none is chosen or it is read only", async () => {
    const { user } = await googleUser({ destination: false });
    expect((await getConferencingOptions(user.id)).google_conference).toEqual({
      available: false,
      code: "no_destination",
      reason: VID07,
      connectUrl: "/app/availability/calendar-settings",
    });
    const readOnly = await googleUser({ canWrite: false });
    expect((await getConferencingOptions(readOnly.user.id)).google_conference).toMatchObject({ available: false, code: "no_destination" });
  });

  it("asks to reconnect a connection that needs attention", async () => {
    const { user, connection } = await googleUser({ status: "needs_reauth" });
    const option = (await getConferencingOptions(user.id)).google_conference;
    expect(option).toMatchObject({ available: false, code: "needs_reauth" });
    expect(option.connectUrl).toContain("intent=connect_calendar");
    expect(option.connectUrl).toContain(`reconnect=${connection.id}`);
    // Without a destination too, when every Google account needs a reconnect.
    const other = await googleUser({ status: "needs_reauth", destination: false });
    expect((await getGoogleMeetStatus(other.user.id)).reconnectConnectionId).toBe(other.connection.id);
  });

  it("explains a Workspace that turned Meet off for the destination calendar", async () => {
    const { user } = await googleUser({ allowed: ["eventHangout"] });
    const option = (await getConferencingOptions(user.id)).google_conference;
    expect(option).toMatchObject({ available: false, code: "meet_disabled", connectUrl: "/app/availability/calendar-settings" });
    expect(option.reason).toContain("Google Workspace administrator");
    const allowed = await googleUser({ allowed: ["hangoutsMeet"] });
    expect((await getConferencingOptions(allowed.user.id)).google_conference.available).toBe(true);
  });

  it("ignores disconnected accounts and other users' calendars", async () => {
    const { user } = await googleUser({ status: "disconnected" });
    expect((await getGoogleMeetStatus(user.id)).state).toBe("not_connected");
    const owner = await googleUser();
    const intruder = await createUser(t.db);
    await t.db.update(users).set({ destinationCalendarId: owner.calendar.id }).where(eq(users.id, intruder.id));
    expect((await getGoogleMeetStatus(intruder.id)).state).toBe("not_connected");
    expect((await getConferencingOptions("not-a-uuid")).google_conference.available).toBe(false);
  });
});

describe("listMeetEventTypes", () => {
  it("lists the user's own live event types that use Google Meet", async () => {
    const { user } = await googleUser();
    const meet = { id: "11111111-1111-4111-8111-111111111111", kind: "google_conference" as const, position: 0 };
    const venue = { id: "22222222-2222-4222-8222-222222222222", kind: "physical" as const, position: 1, location: "Cafe" };
    const { eventType: only } = await createEventType(t.db, { owner: user, name: "30 Minute Virtual", locations: [meet] });
    const { eventType: mixed } = await createEventType(t.db, { owner: user, name: "Coffee or Meet", locations: [meet, venue], overrides: { active: false } });
    await createEventType(t.db, { owner: user, name: "In person", locations: [venue] });
    const { eventType: gone } = await createEventType(t.db, { owner: user, name: "Deleted", locations: [meet] });
    await t.db.update(eventTypes).set({ deletedAt: new Date() }).where(eq(eventTypes.id, gone.id));
    const other = await createUser(t.db);
    await createEventType(t.db, { owner: other, name: "Someone else", locations: [meet] });
    // Review regression: the hidden adhoc types behind meeting polls and one-off meetings are not listed.
    await createEventType(t.db, { owner: user, name: "Poll: Planning", locations: [meet], overrides: { type: "adhoc" } });

    const list = await listMeetEventTypes(user.id);
    expect(list.map((e) => e.name).sort()).toEqual(["30 Minute Virtual", "Coffee or Meet"]);
    expect(list.find((e) => e.id === only.id)).toMatchObject({ onlyLocation: true, active: true });
    expect(list.find((e) => e.id === mixed.id)).toMatchObject({ onlyLocation: false, active: false });
    expect(await listMeetEventTypes("nope")).toEqual([]);
  });
});
