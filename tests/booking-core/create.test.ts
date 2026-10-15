// createBooking on PGlite (ARCHITECTURE section 9): solo bookings with every row and the domain event, slot taken,
// idempotency (client request id; a refresh and a new submit of the same booking answers already_booked), validation, blocked
// invitees, reschedules (CR-04, SCH-24), group seats, round robin, collective, single-use links, one-off and poll
// bookings (0/0 buffers, limits ignored), notification mode and redirects.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalBusy } from "@/lib/calendars";

const cal = vi.hoisted(() => ({ busy: {} as Record<string, ExternalBusy[]>, destination: null as null | { provider: string } }));
const links = vi.hoisted(() => ({
  resolved: null as null | Record<string, unknown>,
  consumed: [] as { kind: string; id: string; scheduledEventId: string }[],
  used: false,
}));
const polls = vi.hoisted(() => ({ booked: [] as Record<string, unknown>[], reservedDbs: [] as unknown[] }));
vi.mock("@/lib/calendars", () => ({
  getExternalBusy: async (p: { userIds: string[] }) =>
    Object.fromEntries(p.userIds.map((id) => [id, { ok: true, stale: false, nocal: false, busy: cal.busy[id] ?? [] }])),
  getDestinationCalendar: async () =>
    cal.destination
      ? { calendarId: "c", connectionId: "x", provider: cal.destination.provider, name: "Work", supports: { invitations: true, googleMeet: true, teams: false } }
      : null,
}));
vi.mock("@/lib/links", () => {
  class LinkUsedError extends Error {
    readonly code = "link_used" as const;
  }
  return {
    LinkUsedError,
    resolveBookingCode: async (code: string) => (links.resolved && links.resolved.code === code ? links.resolved : null),
    consumeLinkInTx: async (_tx: unknown, p: { kind: string; id: string; scheduledEventId: string }) => {
      if (links.used) throw new LinkUsedError("used");
      links.consumed.push(p);
      links.used = true;
    },
    getReservedIntervals: async () => ({}),
  };
});
vi.mock("@/lib/polls", () => ({
  getPollReservedIntervals: async (_ids: string[], _start: Date, _end: Date, opts: { db?: unknown } = {}) => {
    polls.reservedDbs.push(opts.db);
    return {};
  },
  markPollBookedInTx: async (_tx: unknown, p: Record<string, unknown>) => {
    polls.booked.push(p);
  },
}));
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const schema = await import("@/db/schema");
const { blockedInvitees, domainEvents, inviteeGuests, invitees, meetingActivity, scheduledEventHosts, scheduledEvents } = schema;
const { createBooking } = await import("@/lib/booking/create");
const { isTransaction } = await import("@/db/helpers");
const { getAvailability } = await import("@/lib/booking/availability");
const { loadEventType } = await import("@/lib/booking/target");
const { MESSAGES } = await import("@/lib/booking/validate");
const f = await import("../factories");
const { useTestDb } = await import("../helpers/db");
const h = await import("./helpers");
const { la, setupSolo, bookingInput, ext, updateEventType, startsOn, MEET, DISCUSS, everyDay } = h;

const t = useTestDb();
const NOW = la("2030-10-07 08:00");
const ctx = { now: NOW };

beforeEach(() => {
  cal.busy = {};
  cal.destination = null;
  links.resolved = null;
  links.consumed = [];
  links.used = false;
  polls.booked = [];
  polls.reservedDbs = [];
});

describe("createBooking: solo", () => {
  it("creates the scheduled event, host row, invitee, guests, answers, activity and booking.created", async () => {
    const fx = await setupSolo(t.db, { questions: [DISCUSS], eventType: { bufferBeforeMinutes: 15, bufferAfterMinutes: 15 } });
    const start = la("2030-10-08 10:00");
    const r = await createBooking(
      bookingInput(fx.target, start, {
        invitee: { name: "Ana Lima", email: "Ana@Example.com", timezone: "Europe/Berlin", detectedTimezone: "America/New_York", timeFormat: "24h", locale: "en" },
        guests: ["bo@example.com"],
        tracking: { utmSource: "newsletter" },
        clientRequestId: "req-solo-1",
      }),
      ctx,
    );
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    const [ev] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, r.scheduledEventId));
    expect(ev).toMatchObject({
      status: "active",
      eventTypeId: fx.target.eventType.id,
      organizerUserId: fx.owner.id,
      durationMinutes: 30,
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
      source: "booking_page",
      isGroup: false,
      provisionStatus: "pending",
    });
    expect(ev!.startAt.toISOString()).toBe(start.toISOString());
    expect(ev!.location).toMatchObject({ kind: "google_conference", status: "processing", configId: MEET.id });
    expect(ev!.settingsSnapshot.notificationMode).toBe("email_confirmation");
    expect(ev!.icsUid).toContain(r.scheduledEventId);
    const [host] = await t.db.select().from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, r.scheduledEventId));
    expect(host).toMatchObject({ userId: fx.owner.id, role: "organizer", isActive: true });
    expect(host!.bufferedStartAt.toISOString()).toBe(la("2030-10-08 09:45").toISOString());
    expect(host!.bufferedEndAt.toISOString()).toBe(la("2030-10-08 10:45").toISOString());
    expect(host!.assignedAt.getTime()).toBe(NOW.getTime());
    const [inv] = await t.db.select().from(invitees).where(eq(invitees.id, r.inviteeId));
    expect(inv).toMatchObject({
      email: "Ana@Example.com",
      emailNormalized: "ana@example.com",
      timezone: "Europe/Berlin",
      detectedTimezone: "America/New_York",
      timeFormat: "24h",
      utmSource: "newsletter",
      clientRequestId: "req-solo-1",
      status: "active",
    });
    expect(inv!.questionsAndAnswers).toEqual([
      { questionId: fx.target.eventType.questions[0]!.id, question: DISCUSS.label, type: "text", position: 0, answer: "Roadmap" },
    ]);
    const guests = await t.db.select().from(inviteeGuests).where(eq(inviteeGuests.inviteeId, r.inviteeId));
    expect(guests.map((g) => g.email)).toEqual(["bo@example.com"]);
    const activity = await t.db.select().from(meetingActivity).where(eq(meetingActivity.scheduledEventId, r.scheduledEventId));
    expect(activity.map((a) => a.type)).toEqual(["booked"]);
    const events = await t.db.select().from(domainEvents).where(eq(domainEvents.type, "booking.created"));
    expect(events.map((e) => e.payload)).toContainEqual({ scheduledEventId: r.scheduledEventId, inviteeId: r.inviteeId, source: "booking_page" });
  });

  it("answers slot_unavailable for a taken time, an off-grid time and a time outside hours", async () => {
    const fx = await setupSolo(t.db);
    const first = await createBooking(bookingInput(fx.target, la("2030-10-08 11:00")), ctx);
    expect(first.ok).toBe(true);
    const again = await createBooking(bookingInput(fx.target, la("2030-10-08 11:00")), ctx);
    expect(again).toEqual({ ok: false, code: "slot_unavailable", message: MESSAGES.slotTaken });
    expect((await createBooking(bookingInput(fx.target, la("2030-10-08 11:10")), ctx)).ok).toBe(false);
    expect((await createBooking(bookingInput(fx.target, la("2030-10-08 18:00")), ctx)).ok).toBe(false);
  });

  it("returns the same invitee for a repeated client request id (BK-19)", async () => {
    const fx = await setupSolo(t.db);
    const input = bookingInput(fx.target, la("2030-10-08 12:00"), { clientRequestId: "double-click-1" });
    const a = await createBooking(input, ctx);
    const b = await createBooking(input, ctx);
    expect(a.ok && b.ok && a.inviteeId === b.inviteeId).toBe(true);
    const rows = await t.db.select().from(invitees).where(eq(invitees.clientRequestId, "double-click-1"));
    expect(rows).toHaveLength(1);
  });

  it("re-checks poll holds through the booking transaction (a getDb() query there would hang PGlite)", async () => {
    const fx = await setupSolo(t.db);
    const r = await createBooking(bookingInput(fx.target, la("2030-10-08 14:00")), ctx);
    expect(r.ok).toBe(true);
    expect(polls.reservedDbs.length).toBeGreaterThan(0);
    expect(polls.reservedDbs.every((db) => db !== undefined)).toBe(true);
    expect(polls.reservedDbs.some((db) => isTransaction(db))).toBe(true);
  });

  it("re-checks Google busy blocks at submit time", async () => {
    const fx = await setupSolo(t.db);
    cal.busy[fx.owner.id] = [ext(la("2030-10-08 13:00"), la("2030-10-08 14:00"), "Doctor")];
    const r = await createBooking(bookingInput(fx.target, la("2030-10-08 13:30")), ctx);
    expect(r).toMatchObject({ ok: false, code: "slot_unavailable" });
  });

  it("rejects invalid input with field errors and creates nothing", async () => {
    const fx = await setupSolo(t.db, { questions: [DISCUSS] });
    const r = await createBooking(bookingInput(fx.target, la("2030-10-08 14:00"), { invitee: { name: "", email: "bad", timezone: "UTC" }, answers: [] }), ctx);
    expect(r).toMatchObject({ ok: false, code: "validation" });
    if (r.ok) return;
    expect(Object.keys(r.fieldErrors ?? {}).sort()).toEqual(["answers." + fx.target.eventType.questions[0]!.id, "email", "name"].sort());
  });

  it("blocked invitees get the generic answer and nothing is created (BK-28)", async () => {
    const fx = await setupSolo(t.db);
    await t.db.insert(blockedInvitees).values({ userId: fx.owner.id, email: "spam@example.com", emailNormalized: "spam@example.com" });
    await t.db.insert(blockedInvitees).values({ userId: fx.owner.id, domain: "junk.test" });
    const a = await createBooking(bookingInput(fx.target, la("2030-10-08 15:00"), { invitee: { name: "S", email: "SPAM@example.com", timezone: "UTC" } }), ctx);
    expect(a).toEqual({ ok: false, code: "slot_unavailable", message: MESSAGES.slotTaken });
    const b = await createBooking(bookingInput(fx.target, la("2030-10-08 15:00"), { invitee: { name: "S", email: "x@junk.test", timezone: "UTC" } }), ctx);
    expect(b.ok).toBe(false);
    const rows = await t.db.select().from(invitees).where(eq(invitees.eventTypeId, fx.target.eventType.id));
    expect(rows).toHaveLength(0);
    const host = await createBooking(bookingInput(fx.target, la("2030-10-08 15:00"), { invitee: { name: "S", email: "spam@example.com", timezone: "UTC" }, actor: { type: "host", userId: fx.owner.id } }), ctx);
    expect(host).toMatchObject({ ok: false, code: "blocked" });
  });

  it("inactive event types are not bookable by invitees", async () => {
    const fx = await setupSolo(t.db, { eventType: { active: false } });
    const r = await createBooking(bookingInput(fx.target, la("2030-10-08 10:00")), ctx);
    expect(r).toMatchObject({ ok: false, code: "not_found", message: MESSAGES.notAvailable });
  });

  it("stores the calendar invitation mode with a Google destination (CAL-12) and returns the redirect URL (BK-21)", async () => {
    const fx = await setupSolo(t.db, { eventType: { afterBooking: "redirect", redirectUrl: "https://example.com/thanks", redirectPassDetails: true } });
    cal.destination = { provider: "google" };
    const r = await createBooking(bookingInput(fx.target, la("2030-10-08 16:00"), { invitee: { name: "Ana Lima", email: "ana@example.com", timezone: "America/New_York" } }), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [ev] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, r.scheduledEventId));
    expect(ev!.settingsSnapshot.notificationMode).toBe("calendar_invitation");
    const u = new URL(r.redirectUrl!);
    expect(u.origin + u.pathname).toBe("https://example.com/thanks");
    expect(u.searchParams.get("invitee_email")).toBe("ana@example.com");
    expect(u.searchParams.get("invitee_uuid")).toBe(r.inviteeId);
    expect(u.searchParams.get("event_start_time")).toBe("2030-10-08T19:00:00-04:00");
  });
});

describe("createBooking: the same booking submitted again with a new client request id (a refresh)", () => {
  const ana = (email = "ana@example.com") => ({ name: "Ana Lima", email, timezone: "America/New_York" });
  const cancel = async (r: { inviteeId: string; scheduledEventId: string }) => {
    await t.db.update(invitees).set({ status: "canceled", canceledAt: NOW, cancelerType: "invitee" }).where(eq(invitees.id, r.inviteeId));
    await t.db.update(scheduledEvents).set({ status: "canceled", canceledAt: NOW }).where(eq(scheduledEvents.id, r.scheduledEventId));
    await t.db.update(scheduledEventHosts).set({ isActive: false }).where(eq(scheduledEventHosts.scheduledEventId, r.scheduledEventId));
  };

  it("answers already_booked instead of slot_unavailable, without returning the booking", async () => {
    const fx = await setupSolo(t.db);
    const start = la("2030-10-08 10:00");
    const first = await createBooking(bookingInput(fx.target, start, { invitee: ana("Ana@Example.com"), clientRequestId: "before-refresh" }), ctx);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // The page was refreshed: a new client request id, the email typed again in another case.
    const again = await createBooking(bookingInput(fx.target, start, { invitee: ana(" ana@example.COM "), clientRequestId: "after-refresh" }), ctx);
    const alreadyBooked = { ok: false, code: "already_booked", message: MESSAGES.alreadyBooked };
    expect(again).toEqual(alreadyBooked);
    // The answer never carries the booking's ids: the submitted email is unproven and the invitee id opens the
    // cancel and reschedule pages. A script without any client request id gets the same answer.
    expect(await createBooking(bookingInput(fx.target, start, { invitee: ana() }), ctx)).toEqual(alreadyBooked);

    const rows = await t.db.select().from(invitees).where(eq(invitees.eventTypeId, fx.target.eventType.id));
    expect(rows.map((r) => [r.id, r.clientRequestId])).toEqual([[first.inviteeId, "before-refresh"]]);
    expect(await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.eventTypeId, fx.target.eventType.id))).toHaveLength(1);
    const created = await t.db.select().from(domainEvents).where(eq(domainEvents.type, "booking.created"));
    expect(created.filter((e) => (e.payload as { inviteeId: string }).inviteeId === first.inviteeId)).toHaveLength(1);
  });

  it("another email still gets slot_unavailable", async () => {
    const fx = await setupSolo(t.db);
    const start = la("2030-10-08 11:00");
    const first = await createBooking(bookingInput(fx.target, start, { invitee: ana(), clientRequestId: "ana-11" }), ctx);
    expect(first.ok).toBe(true);
    const other = await createBooking(bookingInput(fx.target, start, { invitee: ana("ana.lima@example.com"), clientRequestId: "other-11" }), ctx);
    expect(other).toEqual({ ok: false, code: "slot_unavailable", message: MESSAGES.slotTaken });
    // The same email on another event type of the host at that time is not the same booking either.
    const { eventType: second } = await f.createEventType(t.db, {
      owner: fx.owner,
      durationMinutes: 30,
      locations: [MEET],
      overrides: { slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, dateRangeType: "rolling", dateRangeDays: 60 },
    });
    const target = { kind: "event_type" as const, eventType: (await loadEventType(second.id, t.db))! };
    expect((await createBooking(bookingInput(target, la("2030-10-08 11:30")), ctx)).ok).toBe(true);
    expect(await createBooking(bookingInput(target, start, { invitee: ana() }), ctx)).toEqual({ ok: false, code: "slot_unavailable", message: MESSAGES.slotTaken });
    expect(await t.db.select().from(invitees).where(eq(invitees.emailNormalized, "ana.lima@example.com"))).toHaveLength(0);
  });

  it("a canceled earlier booking of the invitee does not count", async () => {
    const fx = await setupSolo(t.db);
    const start = la("2030-10-08 14:00");
    const first = await createBooking(bookingInput(fx.target, start, { invitee: ana(), clientRequestId: "ana-14" }), ctx);
    if (!first.ok) throw new Error("setup booking failed");
    await cancel(first);
    // Someone else takes the freed time; Ana's new submit is not answered with her canceled booking (or with Bo's).
    const bo = await createBooking(bookingInput(fx.target, start, { invitee: { name: "Bo", email: "bo@example.com", timezone: "UTC" } }), ctx);
    expect(bo.ok).toBe(true);
    expect(await createBooking(bookingInput(fx.target, start, { invitee: ana(), clientRequestId: "ana-14-again" }), ctx)).toEqual({
      ok: false,
      code: "slot_unavailable",
      message: MESSAGES.slotTaken,
    });
  });

  it("only the same start and duration qualify, and a reschedule into the time is a plain conflict", async () => {
    const fx = await setupSolo(t.db, { eventType: { durationOptions: [30, 60] } });
    const long = await createBooking(bookingInput(fx.target, la("2030-10-09 10:00"), { invitee: ana(), durationMinutes: 60 }), ctx);
    expect(long.ok).toBe(true);
    // 10:00 for 30 minutes and 10:30 overlap Ana's hour but are other bookings.
    expect(await createBooking(bookingInput(fx.target, la("2030-10-09 10:00"), { invitee: ana(), durationMinutes: 30 }), ctx)).toMatchObject({ ok: false, code: "slot_unavailable" });
    expect(await createBooking(bookingInput(fx.target, la("2030-10-09 10:30"), { invitee: ana(), durationMinutes: 30 }), ctx)).toMatchObject({ ok: false, code: "slot_unavailable" });
    // Ana's other meeting moved onto her own 10:00 hour is a conflict, not "already booked".
    const other = await createBooking(bookingInput(fx.target, la("2030-10-09 15:00"), { invitee: ana(), durationMinutes: 60 }), ctx);
    if (!other.ok) throw new Error("setup booking failed");
    const moved = await createBooking(
      bookingInput(await fx.reload(), la("2030-10-09 10:00"), { invitee: ana(), durationMinutes: 60, reschedule: { inviteeId: other.inviteeId } }),
      ctx,
    );
    expect(moved).toMatchObject({ ok: false, code: "slot_unavailable" });
    const [kept] = await t.db.select().from(invitees).where(eq(invitees.id, other.inviteeId));
    expect(kept).toMatchObject({ status: "active", rescheduled: false });
  });

  it("a host booking for the invitee's email gets slot_unavailable (only invitee submits answer already_booked)", async () => {
    const fx = await setupSolo(t.db);
    const start = la("2030-10-10 10:00");
    const first = await createBooking(bookingInput(fx.target, start, { invitee: ana() }), ctx);
    expect(first.ok).toBe(true);
    const host = await createBooking(bookingInput(fx.target, start, { invitee: ana(), actor: { type: "host", userId: fx.owner.id } }), ctx);
    expect(host).toMatchObject({ ok: false, code: "slot_unavailable" });
  });
});

describe("createBooking: reschedule (CR-04, SCH-24)", () => {
  it("cancels and links the old invitee, moves the ICS sequence and keeps a daily limit of 1 bookable later that day", async () => {
    const fx = await setupSolo(t.db, { eventType: { limitPerDay: 1 } });
    const first = await createBooking(bookingInput(fx.target, la("2030-10-08 09:00")), ctx);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const target = await fx.reload();
    const r = await createBooking(bookingInput(target, la("2030-10-08 15:00"), { reschedule: { inviteeId: first.inviteeId, reason: "Conflict" } }), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [oldInv] = await t.db.select().from(invitees).where(eq(invitees.id, first.inviteeId));
    expect(oldInv).toMatchObject({ status: "canceled", rescheduled: true, newInviteeId: r.inviteeId, cancelReason: "Conflict", cancelerType: "invitee" });
    const [newInv] = await t.db.select().from(invitees).where(eq(invitees.id, r.inviteeId));
    expect(newInv!.oldInviteeId).toBe(first.inviteeId);
    const [oldEv] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, first.scheduledEventId));
    const [newEv] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, r.scheduledEventId));
    expect(oldEv!.status).toBe("canceled");
    expect(newEv).toMatchObject({ status: "active", rescheduledFromEventId: oldEv!.id, icsUid: oldEv!.icsUid, icsSequence: oldEv!.icsSequence + 1 });
    const oldHosts = await t.db.select().from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, oldEv!.id));
    expect(oldHosts.every((x) => !x.isActive)).toBe(true);
    const [newHost] = await t.db.select().from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, newEv!.id));
    expect(newHost!.assignedAt.getTime()).toBe(oldHosts[0]!.assignedAt.getTime());
    const events = await t.db.select().from(domainEvents).where(eq(domainEvents.type, "booking.rescheduled"));
    expect(events.map((e) => e.payload)).toContainEqual({
      oldInviteeId: first.inviteeId,
      newInviteeId: r.inviteeId,
      oldScheduledEventId: first.scheduledEventId,
      newScheduledEventId: r.scheduledEventId,
      reason: "Conflict",
    });
    // The old invitee cannot be rescheduled again.
    const twice = await createBooking(bookingInput(target, la("2030-10-09 10:00"), { reschedule: { inviteeId: first.inviteeId } }), ctx);
    expect(twice).toEqual({ ok: false, code: "slot_unavailable", message: MESSAGES.notReschedulable });
  });
});

describe("createBooking: group, round robin and collective (generic engine paths)", () => {
  it("joins the existing group slot, rejects the same email twice and fills the slot", async () => {
    const fx = await setupSolo(t.db, { eventType: { kind: "group", maxInvitees: 2, slotIncrementMinutes: 60 } });
    const start = la("2030-10-08 10:00");
    const a = await createBooking(bookingInput(fx.target, start, { invitee: { name: "A", email: "a@example.com", timezone: "UTC" } }), ctx);
    expect(a.ok).toBe(true);
    const dup = await createBooking(bookingInput(fx.target, start, { invitee: { name: "A", email: "A@Example.com", timezone: "UTC" } }), ctx);
    expect(dup).toEqual({ ok: false, code: "already_booked", message: MESSAGES.alreadyBooked });
    const b = await createBooking(bookingInput(fx.target, start, { invitee: { name: "B", email: "b@example.com", timezone: "UTC" } }), ctx);
    expect(b.ok && a.ok && b.scheduledEventId === a.scheduledEventId).toBe(true);
    const c = await createBooking(bookingInput(fx.target, start, { invitee: { name: "C", email: "c@example.com", timezone: "UTC" } }), ctx);
    expect(c).toMatchObject({ ok: false, code: "slot_unavailable" });
    const [ev] = await t.db.select().from(scheduledEvents).where(and(eq(scheduledEvents.eventTypeId, fx.target.eventType.id)));
    expect(ev).toMatchObject({ isGroup: true, inviteesLimit: 2 });
    expect(ev!.settingsSnapshot.notificationMode).toBe("email_confirmation");
  });

  it("assigns concurrent round robin bookings at one time to different hosts", async () => {
    const a = await f.createUser(t.db, { timezone: h.LA });
    const b = await f.createUser(t.db, { timezone: h.LA, organizationId: a.organizationId });
    await f.createSchedule(t.db, { userId: a.id, timezone: h.LA, weeklyHours: everyDay("09:00", "17:00") });
    await f.createSchedule(t.db, { userId: b.id, timezone: h.LA, weeklyHours: everyDay("09:00", "17:00") });
    const { eventType } = await f.createEventType(t.db, {
      owner: a,
      poolingType: "round_robin",
      hosts: [{ userId: a.id }, { userId: b.id }],
      overrides: { minimumNoticeMinutes: 0, slotIncrementMinutes: 30 },
    });
    const target = { kind: "event_type" as const, eventType: (await loadEventType(eventType.id))! };
    const start = la("2030-10-08 10:00");
    const r1 = await createBooking(bookingInput(target, start), ctx);
    const r2 = await createBooking(bookingInput(target, start), ctx);
    const r3 = await createBooking(bookingInput(target, start), ctx);
    expect(r1.ok && r2.ok).toBe(true);
    expect(r3).toMatchObject({ ok: false, code: "slot_unavailable" });
    const rows = await t.db.select().from(scheduledEventHosts).where(eq(scheduledEventHosts.eventTypeId, eventType.id));
    expect(new Set(rows.map((x) => x.userId))).toEqual(new Set([a.id, b.id]));
    expect(rows.every((x) => x.role === "assigned" && x.poolId)).toBe(true);
  });

  it("multi-pool events need every required host and one host per pool (SCH-17)", async () => {
    const a = await f.createUser(t.db, { timezone: h.LA });
    const b = await f.createUser(t.db, { timezone: h.LA, organizationId: a.organizationId });
    const c = await f.createUser(t.db, { timezone: h.LA, organizationId: a.organizationId });
    for (const u of [a, b, c]) await f.createSchedule(t.db, { userId: u.id, timezone: h.LA, weeklyHours: everyDay("09:00", "17:00") });
    const { eventType } = await f.createEventType(t.db, {
      owner: a,
      poolingType: "multi_pool",
      pools: [{ name: "Engineers" }],
      hosts: [{ userId: a.id, poolIndex: null }, { userId: b.id, poolIndex: 0 }, { userId: c.id, poolIndex: 0 }],
      overrides: { minimumNoticeMinutes: 0, slotIncrementMinutes: 60 },
    });
    cal.busy[b.id] = [ext(la("2030-10-08 10:00"), la("2030-10-08 11:00"), "B busy")];
    cal.busy[c.id] = [ext(la("2030-10-08 10:00"), la("2030-10-08 11:00"), "C busy")];
    const target = { kind: "event_type" as const, eventType: (await loadEventType(eventType.id))! };
    const r = await getAvailability({ target, start: la("2030-10-08 00:00"), end: la("2030-10-09 00:00"), now: NOW });
    const starts = startsOn(r.slots, "2030-10-08");
    expect(starts).not.toContain("10:00");
    expect(starts).toContain("11:00");
    const booked = await createBooking(bookingInput(target, la("2030-10-08 11:00")), ctx);
    expect(booked.ok).toBe(true);
    if (!booked.ok) return;
    const rows = await t.db.select().from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, booked.scheduledEventId));
    expect(rows.find((x) => x.userId === a.id)?.role).toBe("organizer");
    expect(rows.filter((x) => x.role === "assigned")).toHaveLength(1);
    expect([b.id, c.id]).toContain(rows.find((x) => x.role === "assigned")!.userId);
  });

  it("collective events need every host and book them all", async () => {
    const a = await f.createUser(t.db, { timezone: h.LA });
    const b = await f.createUser(t.db, { timezone: h.LA, organizationId: a.organizationId });
    await f.createSchedule(t.db, { userId: a.id, timezone: h.LA, weeklyHours: everyDay("09:00", "12:00") });
    await f.createSchedule(t.db, { userId: b.id, timezone: h.LA, weeklyHours: everyDay("10:00", "13:00") });
    const { eventType } = await f.createEventType(t.db, {
      owner: a,
      poolingType: "collective",
      hosts: [{ userId: a.id }, { userId: b.id }],
      overrides: { minimumNoticeMinutes: 0, slotIncrementMinutes: 30 },
    });
    const target = { kind: "event_type" as const, eventType: (await loadEventType(eventType.id))! };
    const r = await getAvailability({ target, start: la("2030-10-08 00:00"), end: la("2030-10-09 00:00"), now: NOW });
    expect(startsOn(r.slots, "2030-10-08")).toEqual(["10:00", "10:30", "11:00", "11:30"]);
    expect((await createBooking(bookingInput(target, la("2030-10-08 09:00")), ctx)).ok).toBe(false);
    const ok = await createBooking(bookingInput(target, la("2030-10-08 11:00")), ctx);
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    const rows = await t.db.select().from(scheduledEventHosts).where(eq(scheduledEventHosts.scheduledEventId, ok.scheduledEventId));
    expect(rows.map((x) => x.role).sort()).toEqual(["cohost", "organizer"]);
  });
});

describe("createBooking: links, one-off and polls", () => {
  it("consumes a single-use link atomically and answers link_used afterwards (OO-04)", async () => {
    const fx = await setupSolo(t.db);
    const link = await f.createSingleUseLink(t.db, { eventType: fx.target.eventType });
    links.resolved = { kind: "single_use", code: "abc123", eventTypeId: fx.target.eventType.id, linkId: link.id, status: "active", currentSlug: "30min" };
    const input = (s: string) => ({ ...bookingInput(fx.target, la(s)), target: { kind: "single_use" as const, code: "abc123" } });
    const r = await createBooking(input("2030-10-08 10:00"), ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(links.consumed).toEqual([{ kind: "single_use", id: link.id, scheduledEventId: r.scheduledEventId }]);
    const [ev] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, r.scheduledEventId));
    expect(ev!.source).toBe("single_use_link");
    const second = await createBooking(input("2030-10-08 11:00"), ctx);
    expect(second).toMatchObject({ ok: false, code: "link_used" });
    links.resolved = { ...links.resolved, status: "used" };
    expect(await createBooking(input("2030-10-08 12:00"), ctx)).toMatchObject({ ok: false, code: "link_used" });
  });

  it("one-off bookings use the offered spots, ignore limits and store 0/0 buffers (OO-09)", async () => {
    const fx = await setupSolo(t.db, { eventType: { type: "adhoc", limitPerDay: 1, bufferBeforeMinutes: 30, bufferAfterMinutes: 30 } });
    await f.createBooking(t.db, { eventType: fx.target.eventType, start: la("2030-10-08 09:00") });
    const spotStart = la("2030-10-08 18:00"); // outside working hours
    const [oneOff] = await t.db
      .insert(schema.oneOffMeetings)
      .values({ code: "oneoff1", eventTypeId: fx.target.eventType.id, ownerUserId: fx.owner.id, timezone: h.LA })
      .returning();
    links.resolved = {
      kind: "one_off",
      code: "oneoff1",
      eventTypeId: fx.target.eventType.id,
      linkId: oneOff!.id,
      status: "active",
      currentSlug: "x",
      spots: [{ start: spotStart, end: new Date(spotStart.getTime() + 30 * 60_000), overlappedExternalIds: ["ext-ok"] }],
    };
    cal.busy[fx.owner.id] = [ext(spotStart, new Date(spotStart.getTime() + 60 * 60_000), "Overlapped on purpose", { externalId: "ext-ok" })];
    const r = await createBooking({ ...bookingInput(fx.target, spotStart), target: { kind: "one_off", code: "oneoff1" } }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [ev] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, r.scheduledEventId));
    expect(ev).toMatchObject({ source: "one_off", bufferBeforeMinutes: 0, bufferAfterMinutes: 0, oneOffMeetingId: oneOff!.id });
  });

  it("poll bookings create one invitee per participant, ignore limits, external busy and buffers, but not app meetings (MP-18)", async () => {
    const fx = await setupSolo(t.db, { eventType: { type: "adhoc", bookingMethod: "poll", limitPerDay: 1, bufferBeforeMinutes: 15, bufferAfterMinutes: 15 } });
    const other = (await f.createEventType(t.db, { owner: fx.owner, overrides: { bufferBeforeMinutes: 30, bufferAfterMinutes: 30 } })).eventType;
    await f.createBooking(t.db, { eventType: other, start: la("2030-10-08 09:00") }); // 08:30 to 10:00 with buffers
    cal.busy[fx.owner.id] = [ext(la("2030-10-08 19:00"), la("2030-10-08 21:00"), "Dinner")];
    const newPoll = async (eventTypeId = fx.target.eventType.id) =>
      (
        await t.db
          .insert(schema.meetingPolls)
          .values({
            eventTypeId,
            organizationId: fx.owner.organizationId,
            ownerUserId: fx.owner.id,
            slug: `p${Math.random().toString(36).slice(2, 12)}`,
            title: "Team sync",
            defaultDurationMinutes: 60,
            timezone: h.LA,
          })
          .returning()
      )[0]!.id;
    const poll = (start: string, pollId: string, target = fx.target, durationMinutes = 60) => ({
      ...bookingInput(target, la(start), { invitee: { name: "Host", email: "host@example.com", timezone: h.LA } }),
      durationMinutes,
      actor: { type: "host" as const, userId: fx.owner.id },
      pollContext: {
        pollId,
        optionId: "00000000-0000-4000-8000-0000000000a2",
        bookedByUserId: fx.owner.id,
        participants: [
          { participantId: null, name: "Voter One", email: "one@example.com", timezone: "Europe/Berlin" },
          { participantId: null, name: "Voter Two", email: "two@example.com" },
        ],
      },
    });
    // Over the other meeting itself: blocked. Over its buffer only (09:30 + 30 buffer): allowed.
    const pollId = await newPoll();
    expect((await createBooking(poll("2030-10-08 08:30", pollId), ctx)).ok).toBe(false);
    const r = await createBooking(poll("2030-10-08 19:30", pollId), ctx); // evening, outside hours, over an external event
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rows = await t.db.select().from(invitees).where(eq(invitees.scheduledEventId, r.scheduledEventId));
    expect(rows.map((x) => x.email).sort()).toEqual(["one@example.com", "two@example.com"]);
    expect(rows.find((x) => x.email === "one@example.com")!.timezone).toBe("Europe/Berlin");
    const [ev] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, r.scheduledEventId));
    expect(ev).toMatchObject({ source: "poll", bufferBeforeMinutes: 0, bufferAfterMinutes: 0, durationMinutes: 60, inviteesLimit: 2 });
    expect(ev!.settingsSnapshot.notificationMode).toBe("email_confirmation");
    expect(polls.booked).toHaveLength(1);
    expect(polls.booked[0]).toMatchObject({ scheduledEventId: r.scheduledEventId, bookedByUserId: fx.owner.id });
    expect([...(polls.booked[0]!.inviteeIds as string[])].sort()).toEqual(rows.map((x) => x.id).sort());
    const second = (await f.createEventType(t.db, { owner: fx.owner, type: "adhoc", overrides: { bookingMethod: "poll" } })).eventType;
    const secondTarget = { kind: "event_type" as const, eventType: (await loadEventType(second.id))! };
    const over = await createBooking(poll("2030-10-08 09:30", await newPoll(second.id), secondTarget), ctx); // overlaps the other meeting's after buffer only
    expect(over.ok).toBe(true);
  });
});

describe("host bookings with Override available times (OO-14)", () => {
  it("lets a host customize the meeting name and duration for this booking only (OO-13)", async () => {
    const fx = await setupSolo(t.db);
    const r = await createBooking(
      bookingInput(fx.target, la("2030-10-08 10:00"), {
        answers: [],
        actor: { type: "host", userId: fx.owner.id, customize: { name: "Strategy chat", durationMinutes: 45 } },
      }),
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [ev] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, r.scheduledEventId));
    expect(ev).toMatchObject({ name: "Strategy chat", durationMinutes: 45, source: "host" });
    expect(ev!.endAt.getTime() - ev!.startAt.getTime()).toBe(45 * 60_000);
  });

  it("books outside working hours and over the host's own events, still counting toward limits", async () => {
    const fx = await setupSolo(t.db, { eventType: { limitPerDay: 1 } });
    cal.busy[fx.owner.id] = [ext(la("2030-10-08 22:00"), la("2030-10-08 23:00"), "Late call")];
    const r = await createBooking(
      bookingInput(fx.target, la("2030-10-08 22:00"), { actor: { type: "host", userId: fx.owner.id, overrideAvailability: true } }),
      ctx,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [inv] = await t.db.select().from(invitees).where(eq(invitees.id, r.inviteeId));
    expect(inv).toMatchObject({ schedulingMethod: "instant_book", scheduledByUserId: fx.owner.id });
    const after = await getAvailability({ target: fx.target, start: la("2030-10-08 00:00"), end: la("2030-10-09 00:00"), now: NOW });
    expect(after.slots).toEqual([]); // the override meeting counts toward the daily limit
    await updateEventType(t.db, fx.target.eventType.id, { limitPerDay: null });
  });
});
