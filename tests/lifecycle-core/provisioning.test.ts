// Provisioning and booking notifications on PGlite with the fake calendar provider (SPEC CAL-11, CAL-12, NT-01, NT-02,
// NT-05, NT-06, NT-20, VID-07, VID-12): email confirmation mode with valid ICS when there is no calendar, calendar
// invitation mode with attendees and sendUpdates=all (no app email to the invitee), the provider iCal UID and event
// link stored, idempotent rewrites, the permanent CAL-12 fallback after 3 failed attempts, a Meet link that Google is
// still creating, and one provider event per group slot.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const meetState = vi.hoisted(() => ({ readsUntilReady: 0 }));

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
vi.mock("@/lib/calendars/providers/google", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/calendars/providers/google")>();
  return {
    ...real,
    readGoogleConference: async () => {
      if (meetState.readsUntilReady > 1) {
        meetState.readsUntilReady--;
        return { joinUrl: null, status: "processing" as const };
      }
      return { joinUrl: "https://meet.google.com/late-link-abc", status: "pushed" as const, data: { conferenceId: "late-link-abc" } };
    },
  };
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

const { meetingActivity } = await import("@/db/schema");
const { setFakeNow, resetFakeTime } = await import("@/lib/time/now");
const { fakeCalendarProvider, resetFakeProviders, FakeCalendarProvider } = await import("../helpers/fake-providers");
const { useTestDb } = await import("../helpers/db");
const { cancelInvitee } = await import("@/lib/lifecycle/cancel");
const h = await import("./helpers");
const { CAFE, MIN, NOW, advance, book, drain, icsProps, la, linkedRows, meeting, outbox, setupHost } = h;

const t = useTestDb();
const provider = () => fakeCalendarProvider("google");
const calls = (method: string) => provider().calls.filter((c) => c.method === method);
type WriteInput = { attendees: { email: string }[]; sendInvitations: boolean; conference?: string | null; descriptionText: string; title: string; icalUid: string };
const inputOf = (c: { method: string; args: unknown[] }) => (c.method === "createEvent" ? c.args[1] : c.args[2]) as WriteInput;

beforeEach(() => {
  resetFakeProviders();
  setFakeNow(NOW);
  meetState.readsUntilReady = 0;
});
afterEach(() => resetFakeTime());

describe("email confirmation mode (no calendar)", () => {
  it("emails the invitee, the guest and the host with valid ICS in UTC and the NT-06 UID", async () => {
    const fx = await setupHost(t.db, { locations: [CAFE] });
    const start = la("2030-10-08 10:00");
    const r = await book(fx, start, {
      guests: ["bo@example.com"],
      invitee: { name: "Ana Lima", email: "ana@example.com", timezone: "Europe/Berlin", timeFormat: "24h" },
    });
    await drain(t.db);
    const m = await meeting(t.db, r.scheduledEventId);
    expect(m.settingsSnapshot.notificationMode).toBe("email_confirmation");
    expect(m.provisionStatus).toBe("done");

    const [mail] = await outbox(t.db, { to: "ana@example.com", template: "lifecycle.invitee_confirmation" });
    expect(mail).toBeDefined();
    expect(mail!.subject).toBe("Confirmed: 30 Minute Virtual with Julian Joseph on Tuesday, October 8, 2030");
    // GEN-06: the invitee's zone (Berlin, UTC+2) and 24 hour format.
    expect(mail!.text).toContain("19:00 - Tuesday, October 8, 2030 (Central European Time)");
    expect(mail!.text).toContain(`/cancellations/${r.inviteeId}`);
    expect(mail!.text).toContain("Blue Bottle, 66 Mint St");
    expect(mail!.replyTo).toBe(fx.owner.email); // NT-20
    expect(mail!.fromName).toBe("Julian Joseph via Kairos");
    const ics = icsProps(mail!.ics);
    expect(mail!.icsMethod).toBe("REQUEST");
    expect(ics.UID).toBe(`${m.id}@localhost`);
    expect(ics.SEQUENCE).toBe("0");
    expect(ics.DTSTART).toBe("20301008T170000Z");
    expect(ics.DTEND).toBe("20301008T173000Z");

    const [guest] = await outbox(t.db, { to: "bo@example.com" });
    expect(guest!.template).toBe("lifecycle.guest_confirmation");
    expect(guest!.text).not.toContain("/cancellations/");
    expect(guest!.icsMethod).toBe("REQUEST");

    const [host] = await outbox(t.db, { to: fx.owner.email, template: "lifecycle.host_new_event" });
    expect(host!.subject).toBe("New Event: Ana Lima - 10:00am Tuesday, October 8, 2030 - 30 Minute Virtual");
    expect(host!.text).toContain("bo@example.com");
    expect(host!.replyTo).toBe("ana@example.com");
    expect(host!.icsMethod).toBe("REQUEST"); // no writable destination calendar (NT-02)

    // A second run sends nothing twice.
    const before = (await outbox(t.db)).length;
    const { notifyMeeting } = await import("@/lib/lifecycle/notify");
    await notifyMeeting(t.db, m.id);
    expect((await outbox(t.db)).length).toBe(before);
    const sent = await t.db.select().from(meetingActivity).where(and(eq(meetingActivity.scheduledEventId, m.id), eq(meetingActivity.type, "email_sent")));
    expect(sent).toHaveLength(3);
  });

  it("omits Reply-To with the no-reply preference and flags Meet without a Google calendar (VID-07, VID-12)", async () => {
    const fx = await setupHost(t.db, { userOverrides: { notificationPrefs: { pollVotes: "instant", calendarProblems: true, dailyAgenda: false, hostAdded: true, noReplyInviteeEmails: true } } });
    const r = await book(fx, la("2030-10-08 11:00"), { invitee: { name: "Sam Lee", email: "sam@example.com", timezone: "America/New_York" } });
    await drain(t.db);
    const m = await meeting(t.db, r.scheduledEventId);
    expect(m.location.status).toBe("failed");
    expect(m.location.error).toBe("meet_requires_google_calendar");
    expect(m.provisionStatus).toBe("partial");
    const [mail] = await outbox(t.db, { to: "sam@example.com", scheduledEventId: m.id });
    expect(mail!.replyTo).toBeNull();
    expect(mail!.text).toContain("Web conferencing details to follow.");
    const [failure] = await outbox(t.db, { template: "lifecycle.conference_failure", scheduledEventId: m.id });
    expect(failure!.subject).toBe("We couldn't create a Google Meet link for your meeting with Sam Lee");
    expect(failure!.toAddresses).toEqual([fx.owner.email]);
  });
});

describe("calendar invitation mode (Google destination)", () => {
  it("creates one provider event with attendees and sendUpdates=all, stores UID, link and Meet; no app email to the invitee", async () => {
    const fx = await setupHost(t.db, { google: true });
    const r = await book(fx, la("2030-10-08 10:00"), { guests: ["bo@example.com"], invitee: { name: "Ana Lima", email: "ana@example.com", timezone: "Europe/Berlin" } });
    await drain(t.db);
    const m = await meeting(t.db, r.scheduledEventId);
    expect(m.settingsSnapshot.notificationMode).toBe("calendar_invitation");
    const created = calls("createEvent");
    expect(created).toHaveLength(1);
    const input = inputOf(created[0]!);
    expect(input.sendInvitations).toBe(true);
    expect(input.attendees.map((a) => a.email).sort()).toEqual(["ana@example.com", "bo@example.com"]);
    expect(input.conference).toBe("google_meet");
    expect(input.title).toBe("Ana Lima and Julian Joseph");
    expect(input.descriptionText).toContain("Need to make changes to this event?");
    expect(input.descriptionText).toContain(`/reschedulings/${r.inviteeId}`);
    expect(input.descriptionText).toContain("What would you like to discuss?\nThe roadmap");
    expect(input.descriptionText).toContain("Booked with Kairos");
    expect(m.providerIcalUid).toBe(input.icalUid);
    expect(m.invitationUrl).toMatch(/^https:\/\/calendar\.example\.com\/event\//);
    expect(m.location.status).toBe("pushed");
    expect(m.location.joinUrl).toMatch(/^https:\/\/meet\.example\.com\//);
    expect(m.provisionStatus).toBe("done");

    expect(await outbox(t.db, { to: "ana@example.com", scheduledEventId: m.id })).toHaveLength(0);
    expect(await outbox(t.db, { to: "bo@example.com", scheduledEventId: m.id })).toHaveLength(0);
    const [host] = await outbox(t.db, { to: fx.owner.email, scheduledEventId: m.id });
    expect(host!.template).toBe("lifecycle.host_new_event");
    expect(host!.icsMethod).toBeNull(); // the host has a writable calendar
    expect(host!.text).toContain("Join now");

    // Idempotent: provisioning again writes nothing.
    const { provisionMeeting } = await import("@/lib/lifecycle/provision");
    const again = await provisionMeeting(t.db, m.id);
    expect(again.calendar).toBe("unchanged");
    expect(calls("createEvent").length + calls("updateEvent").length).toBe(1);
    const rows = await linkedRows(t.db, m.id);
    expect(rows.filter((x) => x.purpose === "meeting")).toHaveLength(1);
  });

  it("falls back permanently to email confirmations after 3 failed attempts; a later success writes no attendees", async () => {
    const fx = await setupHost(t.db, { google: true });
    const r = await book(fx, la("2030-10-08 13:00"), { invitee: { name: "Ana Lima", email: "ana@example.com", timezone: "Europe/Berlin" } });
    provider().failNext = { kind: "transient", count: 3 };
    await drain(t.db); // attempt 1
    let m = await meeting(t.db, r.scheduledEventId);
    expect(m.settingsSnapshot.notificationMode).toBe("calendar_invitation");
    expect(await outbox(t.db, { scheduledEventId: m.id, to: "ana@example.com" })).toHaveLength(0);
    advance(61_000);
    await drain(t.db); // attempt 2
    advance(2 * MIN + 10_000);
    await drain(t.db); // attempt 3: fallback
    m = await meeting(t.db, r.scheduledEventId);
    expect(m.settingsSnapshot.notificationMode).toBe("email_confirmation");
    const fallback = await t.db.select().from(meetingActivity).where(and(eq(meetingActivity.scheduledEventId, m.id), eq(meetingActivity.type, "notification_fallback")));
    expect(fallback).toHaveLength(1);
    const [confirm] = await outbox(t.db, { to: "ana@example.com", template: "lifecycle.invitee_confirmation", scheduledEventId: m.id });
    expect(confirm).toBeDefined();
    expect(icsProps(confirm!.ics).UID).toBe(m.icsUid);
    expect(await outbox(t.db, { template: "lifecycle.calendar_fallback", scheduledEventId: m.id })).toHaveLength(1);
    expect(calls("createEvent")).toHaveLength(3);

    advance(5 * MIN);
    await drain(t.db); // attempt 4 succeeds, in email confirmation mode
    const created = calls("createEvent");
    expect(created).toHaveLength(4);
    const last = inputOf(created[3]!);
    expect(last.attendees).toEqual([]);
    expect(last.sendInvitations).toBe(false);
    m = await meeting(t.db, r.scheduledEventId);
    expect(m.settingsSnapshot.notificationMode).toBe("email_confirmation");
    expect(m.provisionStatus).toBe("done");
    // The invitee's ICS files keep the app UID (CAL-12).
    const { buildMeetingIcs } = await import("@/lib/email");
    const ics = await buildMeetingIcs({ scheduledEventId: m.id, inviteeId: r.inviteeId, method: "REQUEST" });
    expect(icsProps(ics!.content).UID).toBe(m.icsUid);
    expect(await outbox(t.db, { to: "ana@example.com", template: "lifecycle.invitee_confirmation", scheduledEventId: m.id })).toHaveLength(1);
  });

  it("waits for a Meet link that Google is still creating, then notifies with the link (VID-12)", async () => {
    const fx = await setupHost(t.db, { google: true, eventType: { notificationType: "email_confirmation" } });
    const p = provider();
    const original = FakeCalendarProvider.prototype.createEvent;
    p.createEvent = async function (this: InstanceType<typeof FakeCalendarProvider>, ...args: Parameters<typeof original>) {
      const res = await original.apply(this, args);
      return { ...res, conference: { joinUrl: null, status: "processing" as const } };
    };
    meetState.readsUntilReady = 2;
    const r = await book(fx, la("2030-10-09 10:00"), { invitee: { name: "Ana Lima", email: "ana@example.com", timezone: "Europe/Berlin" } });
    await drain(t.db);
    let m = await meeting(t.db, r.scheduledEventId);
    expect(m.location.status).toBe("initiated");
    expect(await outbox(t.db, { to: "ana@example.com", scheduledEventId: m.id })).toHaveLength(0); // waiting for the link
    advance(21_000);
    await drain(t.db); // still processing
    advance(21_000);
    await drain(t.db); // pushed
    m = await meeting(t.db, r.scheduledEventId);
    expect(m.location.status).toBe("pushed");
    expect(m.location.joinUrl).toBe("https://meet.google.com/late-link-abc");
    const [mail] = await outbox(t.db, { to: "ana@example.com", scheduledEventId: m.id });
    expect(mail!.text).toContain("This is a Google Meet web conference.");
    expect(mail!.text).toContain("Join now");
  });
});

describe("group slots (CAL-11)", () => {
  it("one provider event per slot: created once, updated on joins and cancellations, deleted with the last invitee", async () => {
    const fx = await setupHost(t.db, { google: true, kind: "group", maxInvitees: 5, locations: [CAFE] });
    const start = la("2030-10-10 10:00");
    const a = await book(fx, start, { invitee: { name: "Ana Lima", email: "ana@example.com", timezone: "Europe/Berlin" } });
    await drain(t.db);
    const b = await book(fx, start, { invitee: { name: "Bo Chen", email: "bo@example.com", timezone: "America/New_York" } });
    await drain(t.db);
    const c = await book(fx, start, { invitee: { name: "Cy Diaz", email: "cy@example.com", timezone: "America/Chicago" } });
    await drain(t.db);
    expect(a.scheduledEventId).toBe(b.scheduledEventId);
    expect(b.scheduledEventId).toBe(c.scheduledEventId);
    expect(calls("createEvent")).toHaveLength(1);
    expect(calls("updateEvent")).toHaveLength(2);
    const last = inputOf(calls("updateEvent")[1]!);
    expect(last.attendees).toEqual([]);
    expect(last.sendInvitations).toBe(false);
    expect(last.descriptionText).toContain("3 of 5 spots filled");
    expect(last.descriptionText).toContain("Ana Lima (ana@example.com)");
    expect(last.descriptionText).toContain("Cy Diaz (cy@example.com)");
    expect(last.descriptionText).not.toContain("/cancellations/");
    expect(last.title).toBe("30 Minute Virtual");
    // Each invitee got their own ICS UID ({inviteeId}@host).
    const [mailB] = await outbox(t.db, { to: "bo@example.com", scheduledEventId: b.scheduledEventId });
    expect(icsProps(mailB!.ics).UID).toBe(`${b.inviteeId}@localhost`);
    const hostMails = await outbox(t.db, { to: fx.owner.email, template: "lifecycle.host_new_event", scheduledEventId: b.scheduledEventId });
    expect(hostMails.at(-1)!.text).toContain("3 of 5 spots filled");

    for (const id of [a.inviteeId, b.inviteeId]) {
      await cancelInvitee({ inviteeId: id, actor: { type: "invitee" } });
      await drain(t.db);
    }
    expect(calls("updateEvent")).toHaveLength(4);
    expect(inputOf(calls("updateEvent")[3]!).descriptionText).toContain("1 of 5 spots filled");
    expect(calls("deleteEvent")).toHaveLength(0);
    await cancelInvitee({ inviteeId: c.inviteeId, actor: { type: "invitee" } });
    await drain(t.db);
    expect(calls("deleteEvent")).toHaveLength(1);
    const m = await meeting(t.db, a.scheduledEventId);
    expect(m.status).toBe("canceled");
    const [cancelA] = await outbox(t.db, { to: "ana@example.com", template: "lifecycle.invitee_canceled", scheduledEventId: a.scheduledEventId });
    expect(cancelA!.icsMethod).toBe("CANCEL");
    expect(icsProps(cancelA!.ics).UID).toBe(`${a.inviteeId}@localhost`);
  });
});

describe("timeline and status", () => {
  it("records calendar and conference activity", async () => {
    const fx = await setupHost(t.db, { google: true });
    const r = await book(fx, la("2030-10-08 15:00"));
    await drain(t.db);
    const rows = await t.db.select({ type: meetingActivity.type }).from(meetingActivity).where(eq(meetingActivity.scheduledEventId, r.scheduledEventId));
    const types = rows.map((x) => x.type);
    expect(types).toEqual(expect.arrayContaining(["booked", "calendar_synced", "conference_created", "email_sent"]));
  });
});
