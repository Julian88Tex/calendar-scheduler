// A work calendar shared with "See only free/busy" blocks booking times end to end on PGlite (docs/SCOPE.md priorities
// 3 and 4): the real calendars busy layer reads it through a fake Google FreeBusy API, booking-core's availability and
// createBooking (the submission recheck) refuse times inside its busy blocks, and Troubleshoot names the block
// "Busy ({calendar name})" since free/busy gives no title (a label of ours that no free/busy rule may match). Only the
// credentials and the unfinished modules' contracts (links, polls, the event registry) are mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockRequest } from "../helpers/fake-providers";

vi.mock("@/lib/calendars/credentials", () => ({
  withConnection: async (connectionId: string, fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ connectionId, userId: "", provider: "google", accessToken: "fake-access", unavailableStatuses: [] }),
  getConnectionContext: async (connectionId: string) => ({ connectionId, userId: "", provider: "google", accessToken: "fake-access", unavailableStatuses: [] }),
  encryptedTokenColumns: async () => ({}),
}));
vi.mock("@/lib/links", () => ({
  resolveBookingCode: async () => null,
  consumeLinkInTx: async () => {},
  getReservedIntervals: async () => ({}),
  LinkUsedError: class LinkUsedError extends Error {},
}));
vi.mock("@/lib/polls", () => ({ getPollReservedIntervals: async () => ({}), markPollBookedInTx: async () => {} }));
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { eq } = await import("drizzle-orm");
const { calendars, eventTypes, users } = await import("@/db/schema");
const { GOOGLE_FREE_BUSY_ONLY_TAG } = await import("@/lib/calendars/access");
const { connectGoogleAccount, getDestinationCalendar, GOOGLE_CALENDAR_SCOPES, setConflictCalendars, setDestinationCalendar } = await import("@/lib/calendars/connections");
const { getCalendarSettingsView } = await import("@/lib/calendars/settings");
const { getAvailability } = await import("@/lib/booking/availability");
const { createBooking } = await import("@/lib/booking/create");
const { getTroubleshootDay } = await import("@/lib/availability/troubleshoot");
const { blockerTitle, describeCandidate } = await import("@/lib/availability/troubleshoot-view");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const { mockFetch, mockResponse } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");
const { setupGoogle } = await import("../calendar-integrations/helpers");
const { bookingInput, la, setupSolo, startsOn } = await import("../booking-core/helpers");

const t = useTestDb();
const G = "https://www.googleapis.com/calendar/v3";
const ME = "me@example.com";
const WORK = "jjoseph@copado.com";

let workBusy: { start: string; end: string }[] = [];

beforeEach(() => {
  resetFakeTime();
  workBusy = [{ start: la("2030-10-08 13:00").toISOString(), end: la("2030-10-08 14:00").toISOString() }];
});

type MeEvent = { id: string; summary: string; start: string; end: string };

/** The owner's Google account: the primary calendar (readable, `meEvents`) and the work calendar (free/busy only). */
async function scenario(opts: { eventType?: Partial<typeof eventTypes.$inferInsert>; meEvents?: MeEvent[] } = {}) {
  const fx = await setupSolo(t.db, { eventType: opts.eventType });
  const g = await setupGoogle(t.db, { user: fx.owner, calendars: [{ externalId: ME, name: ME, isPrimary: true, canWrite: true, checkConflicts: true }] });
  const [work] = await t.db
    .insert(calendars)
    .values({ connectionId: g.connectionId, userId: fx.owner.id, externalId: WORK, name: WORK, canWrite: false, checkConflicts: true, ctag: GOOGLE_FREE_BUSY_ONLY_TAG })
    .returning();
  const f = mockFetch(
    {
      method: "POST",
      url: `${G}/freeBusy`,
      handler: (req: MockRequest) => {
        const body = req.body as { timeMin: string; timeMax: string; items: { id: string }[] };
        const inRange = (b: { start: string; end: string }) => b.start < body.timeMax && b.end > body.timeMin;
        return { calendars: Object.fromEntries(body.items.map((i) => [i.id, { busy: i.id === WORK ? workBusy.filter(inRange) : [] }])) };
      },
    },
    {
      method: "GET",
      url: new RegExp(`^${G.replace(/\./g, "\\.")}/calendars/([^/]+)/events(?:\\?|$)`),
      handler: (req: MockRequest) =>
        decodeURIComponent(req.params[0]!) === WORK
          ? mockResponse({ error: { code: 403, message: "You need to have reader access to this calendar.", errors: [{ reason: "requiredAccessLevel" }] } }, { status: 403 })
          : { items: (opts.meEvents ?? []).map((e) => ({ status: "confirmed", id: e.id, summary: e.summary, start: { dateTime: e.start }, end: { dateTime: e.end } })) },
    },
  );
  return { fx, g, work: work!, f, actor: { orgId: fx.owner.organizationId, orgRole: fx.owner.orgRole, user: fx.owner } };
}

describe("free/busy only calendar blocks", () => {
  it("are not offered and are refused at booking time (the submission recheck reads FreeBusy again)", async () => {
    const s = await scenario();
    try {
      const NOW = la("2030-10-07 08:00");
      const loadedAt = Date.now();
      setFakeNow(new Date(loadedAt));
      const r = await getAvailability({ target: s.fx.target, start: la("2030-10-08 00:00"), end: la("2030-10-09 00:00"), now: NOW });
      const starts = startsOn(r.slots, "2030-10-08");
      expect(starts).toContain("12:30");
      expect(starts).not.toContain("13:00");
      expect(starts).not.toContain("13:30");
      expect(starts).toContain("14:00");
      expect(s.f.callsTo("/freeBusy", "POST").length).toBeGreaterThan(0);
      expect(s.f.calls.some((c) => c.method === "GET" && c.url.pathname.includes(encodeURIComponent(WORK)))).toBe(false);

      // A meeting added at work while the invitee filled in the form (two minutes, past the 60 second recheck age): the
      // booking-time recheck reads FreeBusy again and sees it.
      workBusy.push({ start: la("2030-10-08 15:00").toISOString(), end: la("2030-10-08 15:30").toISOString() });
      setFakeNow(new Date(loadedAt + 2 * 60_000));
      const before = s.f.callsTo("/freeBusy", "POST").length;
      expect(await createBooking(bookingInput(s.fx.target, la("2030-10-08 15:00")), { now: NOW })).toMatchObject({ ok: false, code: "slot_unavailable" });
      expect(s.f.callsTo("/freeBusy", "POST").length).toBeGreaterThan(before);
      expect(await createBooking(bookingInput(s.fx.target, la("2030-10-08 13:30")), { now: NOW })).toMatchObject({ ok: false, code: "slot_unavailable" });
      // A free time still books.
      expect(await createBooking(bookingInput(s.fx.target, la("2030-10-08 14:00")), { now: NOW })).toMatchObject({ ok: true });
    } finally {
      s.f.restore();
    }
  });

  it("from the Google calendar list to a refused booking: listed unchecked, ticked by the owner, never the destination", async () => {
    const fx = await setupSolo(t.db);
    const actor = { orgId: fx.owner.organizationId, orgRole: fx.owner.orgRole, user: fx.owner };
    const f = mockFetch(
      {
        method: "GET",
        url: `${G}/users/me/calendarList`,
        // The work calendar comes first and Google marks no calendar as writable but the owner's own.
        handler: () => ({
          items: [
            { id: WORK, summary: WORK, accessRole: "freeBusyReader" },
            { id: ME, summary: ME, accessRole: "owner", primary: true },
          ],
        }),
      },
      {
        method: "POST",
        url: `${G}/freeBusy`,
        handler: (req: MockRequest) => {
          const body = req.body as { timeMin: string; timeMax: string; items: { id: string }[] };
          const inRange = (b: { start: string; end: string }) => b.start < body.timeMax && b.end > body.timeMin;
          return { calendars: Object.fromEntries(body.items.map((i) => [i.id, { busy: i.id === WORK ? workBusy.filter(inRange) : [] }])) };
        },
      },
      {
        method: "GET",
        url: new RegExp(`^${G.replace(/\./g, "\\.")}/calendars/([^/]+)/events(?:\\?|$)`),
        handler: (req: MockRequest) =>
          decodeURIComponent(req.params[0]!) === WORK
            ? mockResponse({ error: { code: 403, message: "You need to have reader access to this calendar.", errors: [{ reason: "requiredAccessLevel" }] } }, { status: 403 })
            : { items: [] },
      },
    );
    try {
      // The real connect flow: calendar list, conflict defaults and the destination default.
      const { connectionId } = await connectGoogleAccount({
        userId: fx.owner.id,
        providerAccountId: "google-sub-1",
        accountEmail: ME,
        tokens: { accessToken: "fake-access", refreshToken: "fake-refresh", expiresAt: new Date(Date.now() + 3_600_000), scopes: [...GOOGLE_CALENDAR_SCOPES] },
        via: "connect",
      });
      const rows = await t.db.select().from(calendars).where(eq(calendars.connectionId, connectionId));
      const me = rows.find((r) => r.externalId === ME)!;
      const work = rows.find((r) => r.externalId === WORK)!;
      expect(work).toMatchObject({ canWrite: false, checkConflicts: false, ctag: GOOGLE_FREE_BUSY_ONLY_TAG });
      expect(me).toMatchObject({ canWrite: true, checkConflicts: true });
      expect((await getDestinationCalendar(fx.owner.id))?.calendarId).toBe(me.id);

      const NOW = la("2030-10-07 08:00");
      const day = async () =>
        startsOn((await getAvailability({ target: fx.target, start: la("2030-10-08 00:00"), end: la("2030-10-09 00:00"), now: NOW })).slots, "2030-10-08");
      // Unchecked, the work calendar is not read and does not block.
      expect(await day()).toContain("13:00");
      expect(f.callsTo("/freeBusy", "POST")).toHaveLength(0);

      // The owner ticks it in "Calendars to check for conflicts": its busy times block from then on.
      await setConflictCalendars(actor, [{ calendarId: work.id, checked: true }]);
      const starts = await day();
      expect(starts).not.toContain("13:00");
      expect(starts).not.toContain("13:30");
      expect(starts).toContain("14:00");
      expect(await createBooking(bookingInput(fx.target, la("2030-10-08 13:00")), { now: NOW })).toMatchObject({ ok: false, code: "slot_unavailable" });
      expect(await createBooking(bookingInput(fx.target, la("2030-10-08 14:00")), { now: NOW })).toMatchObject({ ok: true });

      // Never the calendar to add events to: not by default, not by choice, not through an event type override.
      await expect(setDestinationCalendar(actor, work.id)).rejects.toMatchObject({ code: "forbidden" });
      await t.db.update(eventTypes).set({ destinationCalendarId: work.id }).where(eq(eventTypes.id, fx.target.eventType.id));
      await t.db.update(users).set({ destinationCalendarId: work.id }).where(eq(users.id, fx.owner.id));
      expect(await getDestinationCalendar(fx.owner.id, fx.target.eventType.id)).toBeNull();
      expect((await getCalendarSettingsView(fx.owner.id)).destinationCalendarId).toBeNull();
    } finally {
      f.restore();
    }
  });

  it('show in Troubleshoot as "Busy ({calendar name})"', async () => {
    const s = await scenario();
    try {
      setFakeNow(la("2030-10-08 07:59"));
      const day = await getTroubleshootDay(s.actor, { date: "2030-10-08", eventTypeId: s.fx.target.eventType.id });
      expect(day.error).toBeNull();
      const entry = day.result!.entries[0]!;
      const ctx = {
        zone: day.zone,
        hour12: true,
        eventTypeName: entry.eventType.name,
        durationMinutes: entry.eventType.durationMinutes,
        settings: entry.eventType.settings,
        hostLimits: day.hostLimits,
      };
      const views = new Map(entry.candidates.map((c) => [describeCandidate(c, ctx).timeLabel, describeCandidate(c, ctx)]));
      expect(views.get("12:30pm")?.status).toBe("available");
      const blocked = views.get("1:00pm")!;
      expect(blocked.status).toBe("CALENDAR");
      expect(blocked.reasons).toContain(`Conflicts with "Busy (${WORK})" on your calendar (1:00pm - 2:00pm).`);
      const blocker = blocked.candidate.blockers.find((b) => b.code === "CALENDAR")!;
      expect(blocker.calendarId).toBe(s.work.id);
      expect(blockerTitle(blocker)).toBe(`Busy (${WORK})`);
      expect(views.get("2:00pm")?.status).toBe("available");
    } finally {
      s.f.restore();
    }
  });

  it('are never ignored by free/busy rules matching "Busy" or the calendar name, and Troubleshoot still names them', async () => {
    const NOW = la("2030-10-07 08:00");
    // A real event on the readable calendar with the very same title: the rules still ignore it (control).
    const meEvents = [{ id: "lookalike", summary: `Busy (${WORK})`, start: la("2030-10-08 10:00").toISOString(), end: la("2030-10-08 11:00").toISOString() }];
    const rules = [
      { mode: "includes", text: "busy" },
      { mode: "includes", text: "copado" },
      { mode: "exact", text: `Busy (${WORK})` },
    ] as const;
    for (const rule of rules) {
      resetFakeTime();
      const s = await scenario({ eventType: { freeBusyExceptions: [{ ...rule }] }, meEvents });
      try {
        const r = await getAvailability({ target: s.fx.target, start: la("2030-10-08 00:00"), end: la("2030-10-09 00:00"), now: NOW });
        const starts = startsOn(r.slots, "2030-10-08");
        expect(starts, `${rule.mode}: ${rule.text}`).toContain("10:00");
        expect(starts, `${rule.mode}: ${rule.text}`).not.toContain("13:00");
        expect(starts, `${rule.mode}: ${rule.text}`).not.toContain("13:30");
        expect(starts).toContain("14:00");
        expect(await createBooking(bookingInput(s.fx.target, la("2030-10-08 13:00")), { now: NOW })).toMatchObject({ ok: false, code: "slot_unavailable" });

        setFakeNow(la("2030-10-08 07:59"));
        const day = await getTroubleshootDay(s.actor, { date: "2030-10-08", eventTypeId: s.fx.target.eventType.id });
        expect(day.error).toBeNull();
        const entry = day.result!.entries[0]!;
        const ctx = {
          zone: day.zone,
          hour12: true,
          eventTypeName: entry.eventType.name,
          durationMinutes: entry.eventType.durationMinutes,
          settings: entry.eventType.settings,
          hostLimits: day.hostLimits,
        };
        const views = new Map(entry.candidates.map((c) => [describeCandidate(c, ctx).timeLabel, describeCandidate(c, ctx)]));
        expect(views.get("10:00am")?.status).toBe("available");
        const blocked = views.get("1:00pm")!;
        expect(blocked.status).toBe("CALENDAR");
        expect(blocked.reasons).toContain(`Conflicts with "Busy (${WORK})" on your calendar (1:00pm - 2:00pm).`);
        expect(blockerTitle(blocked.candidate.blockers.find((b) => b.code === "CALENDAR")!)).toBe(`Busy (${WORK})`);
      } finally {
        s.f.restore();
      }
    }
  });
});
