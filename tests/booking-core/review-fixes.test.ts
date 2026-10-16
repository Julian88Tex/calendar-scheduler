// Regression tests of the booking-core review on PGlite:
// - an edited resubmission replaces the email verification hold (the booking never uses stale details) while a
//   double click keeps one hold;
// - single-line fields (names, the invitee-provided location, one-line answers, the locale) never carry line breaks;
// - a client request id only replays the same booking (BK-19), never someone else's;
// - referenced schedules count only when they belong to the host and to this event type (GEN-08, AV-09);
// - a hold of the same email for another slot still blocks (SCH-19), a host block applies when a hold completes
//   (BK-28), a remembered device records the verified email (BK-17), the status endpoint reports an expired code hold;
// - reschedules (CR-03, SCH-24): host limits reached by the moved meeting do not hide the week, past, one-off and poll
//   meetings and turned-off event types are not reschedulable (createBooking and the slots endpoint);
// - a host without any schedule offers nothing; the verification email shows the locked zone.
import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalBusy } from "@/lib/calendars";

const cal = vi.hoisted(() => ({ busy: {} as Record<string, ExternalBusy[]> }));
vi.mock("@/lib/calendars", () => ({
  getExternalBusy: async (p: { userIds: string[] }) =>
    Object.fromEntries(p.userIds.map((id) => [id, { ok: true, stale: false, nocal: false, busy: cal.busy[id] ?? [] }])),
  getDestinationCalendar: async () => null,
}));
vi.mock("@/lib/links", () => ({
  resolveBookingCode: async () => null,
  consumeLinkInTx: async () => {},
  getReservedIntervals: async () => ({}),
  LinkUsedError: class LinkUsedError extends Error {},
}));
vi.mock("@/lib/polls", () => ({ getPollReservedIntervals: async () => ({}), markPollBookedInTx: async () => {} }));
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const schema = await import("@/db/schema");
const { availabilitySchedules, blockedInvitees, bookingReservations, emailOutbox, eventTypeHosts, invitees, jobs, verificationCodes } = schema;
const { completeReservation, createBooking, getReservationStatus, holdFingerprint, verifyReservationCode } = await import("@/lib/booking/create");
const { getAvailability } = await import("@/lib/booking/availability");
const { publicSlots } = await import("@/lib/booking/public");
const { parsePrefill } = await import("@/lib/booking/prefill");
const { validateBookingInput, MESSAGES } = await import("@/lib/booking/validate");
const { handlers } = await import("@/lib/booking/jobs");
const verifyRoute = await import("@/app/api/public/bookings/[reservationId]/verify/route");
const { isAppError } = await import("@/lib/errors");
const { log } = await import("@/lib/logger");
const { resetFakeTime, setFakeNow } = await import("@/lib/time/now");
const f = await import("../factories");
const { useTestDb } = await import("../helpers/db");
const h = await import("./helpers");
const { la, setupSolo, bookingInput, startsOn, MIN, DISCUSS, hours } = h;

const t = useTestDb();
const NOW = la("2030-10-07 08:00"); // Monday 08:00 PDT

beforeEach(() => {
  cal.busy = {};
});
afterEach(() => resetFakeTime());

const day = (date: string) => ({ start: la(`${date} 00:00`), end: la(`${date} 23:59`) });

/** Runs the newest code email job of a reservation and returns the code it sent. */
async function codeOf(reservationId: string): Promise<{ code: string; text: string }> {
  const rows = await t.db.select().from(jobs).where(eq(jobs.type, "booking.send_verification_code"));
  const job = rows.filter((j) => (j.payload as { reservationId?: string }).reservationId === reservationId).at(-1)!;
  await handlers["booking.send_verification_code"]!(job.payload, { db: t.db, jobId: job.id, attempt: 1, now: NOW, log });
  const key = `booking.verification_code:${(job.payload as { codeId: string }).codeId}`;
  const [mail] = await t.db.select().from(emailOutbox).where(eq(emailOutbox.idempotencyKey, key));
  return { code: mail!.subject.slice(0, 6), text: mail!.text ?? "" };
}

describe("email verification holds (BK-17, SCH-19)", () => {
  it("an edited resubmission replaces the hold with a new code, so the booking uses the corrected details", async () => {
    const fx = await setupSolo(t.db, { eventType: { requireEmailVerification: true }, questions: [DISCUSS] });
    const qid = fx.target.eventType.questions[0]!.id;
    const start = la("2030-10-08 10:00");
    const first = bookingInput(fx.target, start, {
      invitee: { name: "Ana Typo", email: "ana@example.com", timezone: "UTC" },
      answers: [{ questionId: qid, value: "old topic" }],
    });
    const a = await createBooking(first, { now: NOW });
    if (a.ok || !a.reservationId) throw new Error("expected a hold");
    const oldCode = await codeOf(a.reservationId); // the first email went out
    // A double click keeps the hold (same details).
    const dbl = await createBooking(first, { now: new Date(NOW.getTime() + 2_000) });
    expect(dbl).toMatchObject({ code: "verification_required", reservationId: a.reservationId });

    const edited = bookingInput(fx.target, start, {
      invitee: { name: "Ana Lima", email: "ana@example.com", timezone: "UTC" },
      answers: [{ questionId: qid, value: "new topic" }],
    });
    const b = await createBooking(edited, { now: new Date(NOW.getTime() + 60_000) });
    if (b.ok || !b.reservationId) throw new Error("expected a hold");
    expect(b.reservationId).not.toBe(a.reservationId);
    const holds = await t.db.select().from(bookingReservations).where(eq(bookingReservations.eventTypeId, fx.target.eventType.id));
    expect(holds.find((r) => r.id === a.reservationId)?.status).toBe("canceled");
    expect(holds.find((r) => r.id === b.reservationId)?.status).toBe("pending");
    // The old hold's code no longer books anything; the new code books with the corrected details.
    expect(await verifyReservationCode(a.reservationId, oldCode.code, { now: NOW })).toMatchObject({ ok: false, code: "expired" });
    const newCode = await codeOf(b.reservationId);
    const done = await verifyReservationCode(b.reservationId, newCode.code, { now: new Date(NOW.getTime() + 90_000) });
    if (!done.ok) throw new Error(done.message);
    const [inv] = await t.db.select().from(invitees).where(eq(invitees.id, done.inviteeId));
    expect(inv!.name).toBe("Ana Lima");
    expect(inv!.questionsAndAnswers[0]!.answer).toBe("new topic");
  });

  it("a duration change for the same start is a new hold", async () => {
    const fx = await setupSolo(t.db, { eventType: { requireEmailVerification: true, durationOptions: [30, 60] } });
    const start = la("2030-10-08 13:00");
    const invitee = { name: "Ana", email: "ana@example.com", timezone: "UTC" };
    const a = await createBooking(bookingInput(fx.target, start, { invitee, durationMinutes: 30 }), { now: NOW });
    const b = await createBooking(bookingInput(fx.target, start, { invitee, durationMinutes: 60 }), { now: NOW });
    if (a.ok || b.ok) throw new Error("expected holds");
    expect(b.reservationId).not.toBe(a.reservationId);
    const [held] = await t.db.select().from(bookingReservations).where(eq(bookingReservations.id, b.reservationId!));
    expect(held!.endAt.getTime() - held!.startAt.getTime()).toBe(60 * MIN);
  });

  it("the fingerprint ignores key order (jsonb) and the click's request id", () => {
    const base = { target: { kind: "event_type" as const, eventTypeId: "x" }, start: "2030-10-08T17:00:00.000Z", invitee: { name: "Ana", email: "a@x.test", timezone: "UTC" } };
    const reordered = { invitee: { timezone: "UTC", email: "a@x.test", name: "Ana" }, start: "2030-10-08T17:00:00Z", target: { eventTypeId: "x", kind: "event_type" as const }, clientRequestId: "abc12345" };
    expect(holdFingerprint(reordered)).toBe(holdFingerprint(base));
    expect(holdFingerprint({ ...base, invitee: { ...base.invitee, name: "Ana Lima" } })).not.toBe(holdFingerprint(base));
  });

  it("a hold of the same email for another slot still blocks that slot (SCH-19 same slot only)", async () => {
    const fx = await setupSolo(t.db, { eventType: { slotIncrementMinutes: 15 } });
    await f.createReservation(t.db, { eventType: fx.target.eventType, start: la("2030-10-08 10:00"), hostUserIds: [fx.owner.id], inviteeEmail: "ana@example.com", expiresAt: new Date(NOW.getTime() + 10 * MIN) });
    // The recheck of the held slot itself ignores the email's own hold (retrying, replacing an edited submission).
    const own = await getAvailability({ target: fx.target, start: la("2030-10-08 10:00"), end: la("2030-10-08 10:01"), now: NOW, reservationEmail: "ana@example.com" });
    expect(own.slots).toHaveLength(1);
    // 09:45 to 10:15 is another slot: the 10:00 hold still blocks it, even for the same email.
    const other = await getAvailability({ target: fx.target, start: la("2030-10-08 09:45"), end: la("2030-10-08 09:46"), now: NOW, reservationEmail: "ana@example.com" });
    expect(other.slots).toEqual([]);
  });

  it("a host block added while the hold was pending cancels it at completion (BK-28)", async () => {
    const fx = await setupSolo(t.db, { eventType: { requireEmailVerification: true } });
    const r = await createBooking(bookingInput(fx.target, la("2030-10-08 11:00"), { invitee: { name: "S", email: "spam@example.com", timezone: "UTC" } }), { now: NOW });
    if (r.ok || !r.reservationId) throw new Error("expected a hold");
    await t.db.insert(blockedInvitees).values({ userId: fx.owner.id, email: "spam@example.com", emailNormalized: "spam@example.com" });
    const done = await completeReservation(r.reservationId, { verifiedEmail: true, now: NOW });
    expect(done).toEqual({ ok: false, code: "slot_unavailable", message: MESSAGES.slotTaken });
    expect((await t.db.select().from(bookingReservations).where(eq(bookingReservations.id, r.reservationId)))[0]!.status).toBe("canceled");
    expect(await t.db.select().from(invitees).where(eq(invitees.eventTypeId, fx.target.eventType.id))).toHaveLength(0);
  });

  it("a remembered device records the verified email; the status reports an expired code hold", async () => {
    const fx = await setupSolo(t.db, { eventType: { requireEmailVerification: true } });
    const r = await createBooking(bookingInput(fx.target, la("2030-10-08 14:00"), { invitee: { name: "Ana", email: "ana@example.com", timezone: "UTC" } }), { now: NOW });
    if (r.ok || !r.reservationId) throw new Error("expected a hold");
    expect(await getReservationStatus(r.reservationId, { now: new Date(NOW.getTime() + 11 * MIN) })).toMatchObject({ status: "expired" });
    expect(await getReservationStatus(r.reservationId, { now: NOW })).toMatchObject({ status: "pending" });
    const { code } = await codeOf(r.reservationId);
    const ok = await verifyReservationCode(r.reservationId, code, { now: NOW, rememberDevice: true });
    if (!ok.ok) throw new Error(ok.message);
    const next = await createBooking(bookingInput(fx.target, la("2030-10-08 15:00"), { invitee: { name: "Ana", email: "ana@example.com", timezone: "UTC" } }), {
      now: NOW,
      trustedDeviceTokens: ok.trustedDevice!.value.split("."),
    });
    if (!next.ok) throw new Error(next.message);
    const [inv] = await t.db.select().from(invitees).where(eq(invitees.id, next.inviteeId));
    expect(inv!.emailVerifiedAt).not.toBeNull();
  });

  it("the code email shows the event's locked time zone", async () => {
    const fx = await setupSolo(t.db, { eventType: { requireEmailVerification: true, timeZoneDisplay: "locked", lockedTimeZone: "Europe/Berlin" } });
    const r = await createBooking(bookingInput(fx.target, la("2030-10-08 10:00"), { invitee: { name: "Ana", email: "ana@example.com", timezone: "America/New_York" } }), { now: NOW });
    if (r.ok || !r.reservationId) throw new Error("expected a hold");
    const { text } = await codeOf(r.reservationId);
    expect(text).toContain("7:00pm - 7:30pm"); // 10:00 Pacific is 19:00 in Berlin
    expect(text).toMatch(/Central European/);
  });

  it("resending the code of a replaced hold answers in the verify endpoint's error shape", async () => {
    setFakeNow(NOW);
    const fx = await setupSolo(t.db, { eventType: { requireEmailVerification: true } });
    const r = await createBooking(bookingInput(fx.target, la("2030-10-08 16:00"), { invitee: { name: "Ana", email: "ana@example.com", timezone: "UTC" } }), { now: NOW });
    if (r.ok || !r.reservationId) throw new Error("expected a hold");
    await t.db.update(bookingReservations).set({ status: "canceled" }).where(eq(bookingReservations.id, r.reservationId));
    const req = new Request(`http://localhost:3000/api/public/bookings/${r.reservationId}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": "203.0.113.90" },
      body: JSON.stringify({ resend: true }),
    });
    const res = await verifyRoute.POST(req, { params: Promise.resolve({ reservationId: r.reservationId }) });
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ ok: false, code: "expired" });
    expect(await t.db.select().from(verificationCodes).where(and(eq(verificationCodes.contextId, r.reservationId)))).toHaveLength(1);
  });
});

describe("input hygiene", () => {
  it("names, the invitee-provided location, one-line answers and the locale stay on one line", async () => {
    const ask = { id: "5eed0000-0000-4000-8000-000000000201", kind: "ask_invitee" as const, position: 0 };
    const fx = await setupSolo(t.db, {
      locations: [ask],
      questions: [
        { label: "Company", type: "string", required: true },
        { label: "Notes", type: "text", required: false },
      ],
    });
    const [oneLine, multi] = fx.target.eventType.questions;
    const r = await createBooking(
      bookingInput(fx.target, la("2030-10-08 10:00"), {
        invitee: { name: "Ana\r\nBcc: x@evil.test", email: "ana@example.com", timezone: "UTC", locale: "en\nX-Injected: 1" },
        locationAnswer: { configId: ask.id, value: "Cafe\nRoom 2" },
        answers: [
          { questionId: oneLine!.id, value: "Acme\r\nInc" },
          { questionId: multi!.id, value: "line one\nline two" },
        ],
      }),
      { now: NOW },
    );
    if (!r.ok) throw new Error(r.message);
    const [inv] = await t.db.select().from(invitees).where(eq(invitees.id, r.inviteeId));
    expect(inv!.name).toBe("Ana Bcc: x@evil.test");
    expect(inv!.locale).toBe("en");
    expect(inv!.questionsAndAnswers.find((a) => a.questionId === oneLine!.id)?.answer).toBe("Acme Inc");
    expect(inv!.questionsAndAnswers.find((a) => a.questionId === multi!.id)?.answer).toBe("line one\nline two");
    expect(inv!.locationAnswer?.value).toBe("Cafe Room 2");
  });

  it("first and last names are single-line too; valid locales are kept", () => {
    const fxTarget = { kind: "event_type" as const, eventType: { nameFormat: "first_last", locale: "en", questions: [], locations: [], allowGuests: true, kind: "solo", timeZoneDisplay: "auto", lockedTimeZone: null, durationMinutes: 30, durationOptions: [], type: "standard", collectMarketingConsent: false } };
    const out = validateBookingInput(
      { target: { kind: "event_type" }, start: "2030-10-08T17:00:00Z", invitee: { firstName: "Ana\nB", lastName: "Lima\t", email: "a@x.test", timezone: "UTC", locale: "pt-BR" } },
      fxTarget as never,
    );
    expect(out.ok && out.value).toMatchObject({ firstName: "Ana B", lastName: "Lima", name: "Ana B Lima", locale: "pt-BR" });
  });

  it("prefilled names and emails never carry line breaks (BK-15)", () => {
    const p = parsePrefill(new URLSearchParams({ name: "Ana\nLima", email: "ana@example.com\n", location: "Cafe\r\nRoom" }));
    expect(p.name).toBe("Ana Lima");
    expect(p.email).toBe("ana@example.com");
    expect(p.location).toBe("Cafe Room");
  });

  it("a client request id replays only the same booking, never another person's (BK-19)", async () => {
    const fx = await setupSolo(t.db);
    const ana = { name: "Ana", email: "ana@example.com", timezone: "UTC" };
    const a = await createBooking(bookingInput(fx.target, la("2030-10-08 10:00"), { clientRequestId: "click-0001", invitee: ana }), { now: NOW });
    if (!a.ok) throw new Error(a.message);
    const replay = await createBooking(bookingInput(fx.target, la("2030-10-08 10:00"), { clientRequestId: "click-0001", invitee: { ...ana, email: "ANA@example.com" } }), { now: NOW });
    expect(replay).toMatchObject({ ok: true, inviteeId: a.inviteeId });
    const stolen = await createBooking(bookingInput(fx.target, la("2030-10-08 10:00"), { clientRequestId: "click-0001", invitee: { name: "Eve", email: "eve@example.com", timezone: "UTC" } }), { now: NOW });
    expect(stolen).toEqual({ ok: false, code: "validation", message: MESSAGES.staleForm });
    const otherTime = await createBooking(bookingInput(fx.target, la("2030-10-08 11:00"), { clientRequestId: "click-0001", invitee: ana }), { now: NOW });
    expect(otherTime).toMatchObject({ ok: false, code: "validation" });
    expect(await t.db.select().from(invitees).where(eq(invitees.eventTypeId, fx.target.eventType.id))).toHaveLength(1);
  });
});

describe("schedules (GEN-08, AV-09, AV-11)", () => {
  it("ignores a referenced schedule of another person or of another event type and uses the host's default", async () => {
    const fx = await setupSolo(t.db); // default: Mon to Fri 09:00 to 17:00 Los Angeles
    const stranger = await f.createUser(t.db, { timezone: h.LA });
    const foreign = await f.createSchedule(t.db, { userId: stranger.id, timezone: h.LA, weeklyHours: hours("00:00", "23:45"), isDefault: false });
    const { eventType: otherType } = await f.createEventType(t.db, { owner: fx.owner });
    const otherCustom = await f.createSchedule(t.db, { userId: fx.owner.id, timezone: h.LA, weeklyHours: hours("18:00", "20:00"), eventTypeId: otherType.id });
    const expected = startsOn((await getAvailability({ target: fx.target, ...day("2030-10-08"), now: NOW })).slots, "2030-10-08");
    expect(expected[0]).toBe("09:00");

    for (const scheduleId of [foreign.id, otherCustom.id]) {
      await h.updateEventType(t.db, fx.target.eventType.id, { scheduleId });
      expect(startsOn((await getAvailability({ target: await fx.reload(), ...day("2030-10-08"), now: NOW })).slots, "2030-10-08")).toEqual(expected);
      await h.updateEventType(t.db, fx.target.eventType.id, { scheduleId, availabilitySetting: "shared" });
      expect(startsOn((await getAvailability({ target: await fx.reload(), ...day("2030-10-08"), now: NOW })).slots, "2030-10-08")).toEqual(expected);
      await h.updateEventType(t.db, fx.target.eventType.id, { scheduleId: null, availabilitySetting: "host" });
    }
    // A host row pointing at someone else's schedule falls back too.
    await t.db.update(eventTypeHosts).set({ scheduleId: foreign.id }).where(eq(eventTypeHosts.eventTypeId, fx.target.eventType.id));
    expect((await fx.reload()).eventType.hosts.map((x) => x.scheduleId)).toEqual([foreign.id]);
    expect(startsOn((await getAvailability({ target: await fx.reload(), ...day("2030-10-08"), now: NOW })).slots, "2030-10-08")).toEqual(expected);
    // The event type's own custom hours apply.
    const own = await f.createSchedule(t.db, { userId: fx.owner.id, timezone: h.LA, weeklyHours: hours("18:00", "19:00"), eventTypeId: fx.target.eventType.id });
    await t.db.update(eventTypeHosts).set({ scheduleId: own.id }).where(eq(eventTypeHosts.eventTypeId, fx.target.eventType.id));
    expect(startsOn((await getAvailability({ target: await fx.reload(), ...day("2030-10-08"), now: NOW })).slots, "2030-10-08")).toEqual(["18:00", "18:30"]);
  });

  it("a host without any schedule offers nothing (never all day)", async () => {
    const fx = await setupSolo(t.db);
    await t.db.update(availabilitySchedules).set({ deletedAt: new Date() }).where(eq(availabilitySchedules.userId, fx.owner.id));
    const r = await getAvailability({ target: await fx.reload(), ...day("2030-10-08"), now: NOW });
    expect(r.slots).toEqual([]);
  });
});

describe("reschedules (CR-03, SCH-24)", () => {
  it("a weekly host limit reached by the moved meeting itself still offers the rest of the week", async () => {
    const fx = await setupSolo(t.db, { user: { meetingLimitWeek: 1 } });
    const m = await f.createBooking(t.db, { eventType: fx.target.eventType, start: la("2030-10-08 10:00") });
    expect(startsOn((await getAvailability({ target: fx.target, ...day("2030-10-09"), now: NOW })).slots, "2030-10-09")).toEqual([]);
    const r = await getAvailability({ target: fx.target, ...day("2030-10-09"), now: NOW, ignoreInviteeId: m.invitee!.id });
    expect(startsOn(r.slots, "2030-10-09")).toHaveLength(16);
    const moved = await createBooking(bookingInput(fx.target, la("2030-10-09 11:00"), { reschedule: { inviteeId: m.invitee!.id } }), { now: NOW });
    expect(moved.ok).toBe(true);
  });

  it("past, one-off and poll meetings and turned-off event types are not reschedulable", async () => {
    setFakeNow(NOW);
    const fx = await setupSolo(t.db);
    const past = await f.createBooking(t.db, { eventType: fx.target.eventType, start: la("2030-10-07 07:00") }); // before NOW
    const poll = await f.createBooking(t.db, { eventType: fx.target.eventType, start: la("2030-10-09 10:00"), source: "poll" });
    const oneOff = await f.createBooking(t.db, { eventType: fx.target.eventType, start: la("2030-10-10 10:00"), source: "one_off" });
    for (const m of [past, poll, oneOff]) {
      const r = await createBooking(bookingInput(fx.target, la("2030-10-11 10:00"), { reschedule: { inviteeId: m.invitee!.id } }), { now: NOW });
      expect(r).toEqual({ ok: false, code: "slot_unavailable", message: MESSAGES.notReschedulable });
      const err = await publicSlots(
        { target: fx.target.eventType.id, start: "2030-10-11", end: "2030-10-11", tz: h.LA, reschedule: m.invitee!.id },
        null,
      ).catch((e: unknown) => e);
      expect(isAppError(err) && err.code).toBe("not_found");
    }
    // A host may still move a meeting whose start has passed (CR-07); invitees may not.
    const host = await createBooking(
      bookingInput(fx.target, la("2030-10-11 10:00"), { reschedule: { inviteeId: past.invitee!.id }, actor: { type: "host", userId: fx.owner.id } }),
      { now: NOW },
    );
    expect(host.ok).toBe(true);

    const upcoming = await f.createBooking(t.db, { eventType: fx.target.eventType, start: la("2030-10-14 10:00") });
    await h.updateEventType(t.db, fx.target.eventType.id, { active: false });
    const off = await createBooking(bookingInput(fx.target, la("2030-10-15 10:00"), { reschedule: { inviteeId: upcoming.invitee!.id } }), { now: NOW });
    expect(off).toEqual({ ok: false, code: "not_found", message: MESSAGES.notReschedulable });
  });
});

describe("slots endpoint (BK-31)", () => {
  it("groups a locked time zone event in its locked zone whatever zone the page asks for (SCH-22)", async () => {
    setFakeNow(NOW);
    const fx = await setupSolo(t.db, { eventType: { timeZoneDisplay: "locked", lockedTimeZone: "Europe/Berlin" } });
    const r = await publicSlots({ target: fx.target.eventType.id, start: "2030-10-08", end: "2030-10-08", tz: h.LA }, null);
    expect(r.timeZone).toBe("Europe/Berlin");
    expect(Object.keys(r.days)).toEqual(["2030-10-08"]);
    // Tuesday in Berlin starts at Monday 15:00 in Los Angeles.
    expect(r.days["2030-10-08"]![0]!.start).toBe("2030-10-07T22:00:00.000Z");
    expect(r.days["2030-10-08"]!.at(-1)!.start).toBe("2030-10-08T21:30:00.000Z");
  });
});
