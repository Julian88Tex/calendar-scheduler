// Host-side calendar changes and account cleanup on PGlite (SPEC CAL-13, CAL-14, CR-17, AU-15): calendar-integrations'
// sync finds the fake provider event deleted, declined or moved and calls applyExternalCalendarChange, which cancels as
// the host or reschedules to the new time reusing the same provider event; buffer events change buffers only; the
// lifecycle.cancel_user_meetings job cancels a user's upcoming meetings with the standard emails.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/calendars/credentials", () => ({
  withConnection: async (connectionId: string, fn: (ctx: unknown) => Promise<unknown>) =>
    fn({ connectionId, userId: "", provider: "google", accessToken: "fake-access", unavailableStatuses: [] }),
  encryptedTokenColumns: async () => ({}),
}));
vi.mock("@/lib/calendars/providers/registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/calendars/providers/registry")>();
  const { fakeCalendarProvider } = await import("../helpers/fake-providers");
  return { ...real, getProvider: (id: "google") => fakeCalendarProvider(id) };
});
vi.mock("@/lib/links", () => ({
  resolveBookingCode: async () => null,
  consumeLinkInTx: async () => {},
  getReservedIntervals: async () => ({}),
  LinkUsedError: class LinkUsedError extends Error {},
}));
vi.mock("@/lib/polls", () => ({ getPollReservedIntervals: async () => ({}), markPollBookedInTx: async () => {} }));
vi.mock("@/lib/events/registry", async () => {
  const { lifecycleSubscribers } = await import("@/lib/lifecycle/subscriber-handlers");
  const map = lifecycleSubscribers as Record<string, unknown>;
  return {
    SUBSCRIBER_KEYS: ["lifecycle"],
    isSubscriberKey: (k: string) => k === "lifecycle",
    subscriberKeysFor: (type: string) => (typeof map[type] === "function" ? ["lifecycle"] : []),
    getSubscriber: (key: string, type: string) => (key === "lifecycle" ? (map[type] ?? null) : null),
  };
});
vi.mock("@/lib/lifecycle/jobs", async () => ({ handlers: (await import("@/lib/lifecycle/job-handlers")).lifecycleJobHandlers, periodic: [] }));

const { scheduledEventHosts, scheduledEvents } = await import("@/db/schema");
const { setFakeNow, resetFakeTime } = await import("@/lib/time/now");
const { enqueueJob } = await import("@/lib/jobs");
const { syncCalendar } = await import("@/lib/calendars/sync");
const { fakeCalendarProvider, resetFakeProviders } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");
const { applyExternalCalendarChange } = await import("@/lib/lifecycle/external");
const h = await import("./helpers");
const { CAFE, HOUR, NOW, book, drain, icsProps, invitee, la, linkedRows, meeting, outbox, setupHost } = h;

const t = useTestDb();
const provider = () => fakeCalendarProvider("google");
const calls = (method: string) => provider().calls.filter((c) => c.method === method);

beforeEach(() => {
  resetFakeProviders();
  setFakeNow(NOW);
});
afterEach(() => resetFakeTime());

/** The fake provider's copy of a linked event. */
function remoteEvent(connectionId: string, calendarExternalId: string, externalId: string) {
  const list = provider().events.get(`${connectionId}:${calendarExternalId}`) ?? [];
  const ev = list.find((e) => e.externalId === externalId);
  if (!ev) throw new Error("remote event missing");
  return { ev, list };
}

async function bookedWithGoogle(opts: { email?: boolean; buffers?: boolean } = {}) {
  const fx = await setupHost(t.db, {
    google: true,
    includeBuffers: opts.buffers,
    eventType: { ...(opts.email ? { notificationType: "email_confirmation" as const } : {}), ...(opts.buffers ? { bufferBeforeMinutes: 15, bufferAfterMinutes: 15 } : {}) },
  });
  const r = await book(fx, la("2030-10-09 10:00"), { invitee: { name: "Ana Lima", email: `ana.x${Math.random().toString(36).slice(2, 7)}@example.com`, timezone: "Europe/Berlin" } });
  await drain(t.db);
  const rows = await linkedRows(t.db, r.scheduledEventId);
  const row = rows.find((x) => x.purpose === "meeting")!;
  return { fx, r, row, rows };
}

describe("deleted or declined in the connected calendar (CAL-14)", () => {
  it("cancels as the host with 'Canceled from connected calendar event' and the standard emails", async () => {
    const { fx, r, row } = await bookedWithGoogle();
    const { list } = remoteEvent(fx.connectionId!, fx.owner.email, row.externalId!);
    provider().events.set(`${fx.connectionId}:${fx.owner.email}`, list.filter((e) => e.externalId !== row.externalId));
    const out = await syncCalendar(fx.calendarId!);
    expect(out.changes).toBe(1);
    const m = await meeting(t.db, r.scheduledEventId);
    expect(m).toMatchObject({ status: "canceled", cancelerType: "host", cancelReason: "Canceled from connected calendar event", canceledByUserId: fx.owner.id });
    const inv = await invitee(t.db, r.inviteeId);
    expect(inv).toMatchObject({ status: "canceled", cancelerType: "host", cancelReason: "Canceled from connected calendar event" });
    await drain(t.db);
    const [mail] = await outbox(t.db, { to: inv.email, template: "lifecycle.invitee_canceled" });
    expect(mail!.text).toContain("Canceled from connected calendar event");
    expect(mail!.ics).toBeNull(); // calendar invitation mode
    const [host] = await outbox(t.db, { to: fx.owner.email, template: "lifecycle.host_canceled", scheduledEventId: m.id });
    expect(host!.text).toContain("This change was made in your connected calendar.");
  });

  it("a declined event cancels too", async () => {
    const { fx, r, row } = await bookedWithGoogle();
    remoteEvent(fx.connectionId!, fx.owner.email, row.externalId!).ev.selfDeclined = true;
    await syncCalendar(fx.calendarId!);
    expect((await meeting(t.db, r.scheduledEventId)).status).toBe("canceled");
    await drain(t.db);
    expect(calls("deleteEvent")).toHaveLength(1);
  });
});

describe("moved in the connected calendar (CAL-14, CR-17)", () => {
  it("reschedules to the new time with linked invitees, reusing the same provider event", async () => {
    const { fx, r, row } = await bookedWithGoogle();
    const old = await meeting(t.db, r.scheduledEventId);
    const { ev } = remoteEvent(fx.connectionId!, fx.owner.email, row.externalId!);
    ev.start = new Date(old.startAt.getTime() + HOUR);
    ev.end = new Date(old.endAt.getTime() + HOUR);
    const out = await syncCalendar(fx.calendarId!);
    expect(out.changes).toBe(1);
    const oldInv = await invitee(t.db, r.inviteeId);
    expect(oldInv).toMatchObject({ status: "canceled", rescheduled: true, cancelerType: "host", cancelReason: "Rescheduled from connected calendar event" });
    const next = await invitee(t.db, oldInv.newInviteeId!);
    expect(next).toMatchObject({ status: "active", oldInviteeId: r.inviteeId, email: oldInv.email });
    const m = await meeting(t.db, next.scheduledEventId);
    expect(m.startAt.getTime()).toBe(old.startAt.getTime() + HOUR);
    expect(m.icsUid).toBe(old.icsUid);
    expect(m.icsSequence).toBe(old.icsSequence + 1);
    expect(m.rescheduledFromEventId).toBe(old.id);
    expect(m.location.joinUrl).toBe(old.location.joinUrl);
    expect((await meeting(t.db, old.id)).status).toBe("canceled");
    const rows = await linkedRows(t.db, m.id);
    expect(rows.find((x) => x.id === row.id)).toMatchObject({ scheduledEventId: m.id });
    expect(rows.find((x) => x.id === row.id)!.syncedStartAt!.getTime()).toBe(m.startAt.getTime());
    const hostRows = await t.db.select().from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, m.id));
    expect(hostRows[0]!.isActive).toBe(true);
    await drain(t.db);
    // The same provider event: nothing created, nothing rewritten.
    expect(calls("createEvent")).toHaveLength(1);
    expect(calls("updateEvent")).toHaveLength(0);
    expect(await outbox(t.db, { to: oldInv.email, scheduledEventId: m.id })).toHaveLength(0); // the provider notified them
    const [host] = await outbox(t.db, { to: fx.owner.email, template: "lifecycle.host_rescheduled", scheduledEventId: m.id });
    expect(host!.text).toContain("Rescheduled from connected calendar event");
    // A second sync finds nothing new.
    h.advance(11 * 60_000);
    const again = await syncCalendar(fx.calendarId!);
    expect(again.changes).toBe(0);
  });

  it("email confirmation mode: the invitee gets the standard Updated email with the next SEQUENCE", async () => {
    const { fx, r, row } = await bookedWithGoogle({ email: true });
    const old = await meeting(t.db, r.scheduledEventId);
    const { ev } = remoteEvent(fx.connectionId!, fx.owner.email, row.externalId!);
    ev.start = new Date(old.startAt.getTime() + 2 * HOUR);
    ev.end = new Date(old.endAt.getTime() + 2 * HOUR);
    await applyExternalCalendarChange({ linkedEventId: row.id, change: { type: "moved", start: ev.start, end: ev.end } });
    await drain(t.db);
    const inv = await invitee(t.db, r.inviteeId);
    const [mail] = await outbox(t.db, { to: inv.email, template: "lifecycle.invitee_rescheduled" });
    expect(mail!.text).toContain("Rescheduled from connected calendar event");
    expect(icsProps(mail!.ics)).toMatchObject({ UID: old.icsUid, SEQUENCE: "1" });
  });

  it("buffer events change buffers only (CAL-13)", async () => {
    const { fx, r, rows } = await bookedWithGoogle({ buffers: true });
    expect(rows.filter((x) => x.purpose !== "meeting")).toHaveLength(2);
    const after = rows.find((x) => x.purpose === "buffer_after")!;
    const { list } = remoteEvent(fx.connectionId!, fx.owner.email, after.externalId!);
    provider().events.set(`${fx.connectionId}:${fx.owner.email}`, list.filter((e) => e.externalId !== after.externalId));
    await syncCalendar(fx.calendarId!);
    const m = await meeting(t.db, r.scheduledEventId);
    expect(m.status).toBe("active");
    expect(m.bufferAfterMinutes).toBe(0);
    expect(m.bufferBeforeMinutes).toBe(15);
    const [hostRow] = await t.db.select().from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, m.id));
    expect(hostRow!.bufferedEndAt.getTime()).toBe(m.endAt.getTime());
    await drain(t.db);
  });

  it("ignores changes of a meeting that is no longer active", async () => {
    const { r, row } = await bookedWithGoogle();
    await t.db.update(scheduledEvents).set({ status: "canceled" }).where(eq(scheduledEvents.id, r.scheduledEventId));
    await applyExternalCalendarChange({ linkedEventId: row.id, change: { type: "deleted" } });
    expect((await invitee(t.db, r.inviteeId)).status).toBe("active");
  });
});

describe("lifecycle.cancel_user_meetings (AU-15)", () => {
  it("cancels the user's upcoming sole-host meetings with the standard emails", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const a = await book(fx, la("2030-10-08 10:00"), { invitee: { name: "Ana", email: "ana.u1@example.com", timezone: "UTC" } });
    const b = await book(fx, la("2030-10-09 10:00"), { invitee: { name: "Bo", email: "bo.u1@example.com", timezone: "UTC" } });
    const past = await book(fx, la("2030-10-07 09:00"));
    setFakeNow(la("2030-10-07 09:30"));
    await enqueueJob(t.db, { type: "lifecycle.cancel_user_meetings", payload: { userId: fx.owner.id, scope: "sole_host", reason: "Julian closed this account" } });
    await drain(t.db);
    expect((await meeting(t.db, a.scheduledEventId)).status).toBe("canceled");
    expect((await meeting(t.db, b.scheduledEventId)).status).toBe("canceled");
    expect((await meeting(t.db, past.scheduledEventId)).status).toBe("active");
    const [mail] = await outbox(t.db, { to: "ana.u1@example.com", template: "lifecycle.invitee_canceled" });
    expect(mail!.text).toContain("Julian closed this account");
  });
});
