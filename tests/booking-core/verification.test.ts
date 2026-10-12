// Email verification (BK-17) and payment reservations (SCH-19, ARCHITECTURE section 9) on PGlite: holds under the
// booking locks, HMAC-stored codes sent by the job with the code encrypted at rest, wrong, expired and exhausted
// codes, resend, remember this device, completion at most once, recheck at completion, and the status endpoint data.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const pay = vi.hoisted(() => ({ configured: false }));
vi.mock("@/lib/calendars", () => ({
  getExternalBusy: async (p: { userIds: string[] }) => Object.fromEntries(p.userIds.map((id) => [id, { ok: true, stale: false, nocal: false, busy: [] }])),
  getDestinationCalendar: async () => null,
}));
vi.mock("@/lib/links", () => ({
  resolveBookingCode: async () => null,
  consumeLinkInTx: async () => {},
  getReservedIntervals: async () => ({}),
  LinkUsedError: class LinkUsedError extends Error {},
}));
vi.mock("@/lib/polls", () => ({ getPollReservedIntervals: async () => ({}), markPollBookedInTx: async () => {} }));
vi.mock("@/lib/payments", () => ({ isPaymentsConfigured: () => pay.configured }));
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { bookingReservations, emailOutbox, invitees, jobs, trustedDevices, verificationCodes } = await import("@/db/schema");
const create = await import("@/lib/booking/create");
const { createBooking, completeReservation, createReservation, verifyReservationCode, resendReservationCode, getReservationStatus } = create;
const { handlers } = await import("@/lib/booking/jobs");
const { log } = await import("@/lib/logger");
const factories = await import("../factories");
const { useTestDb } = await import("../helpers/db");
const h = await import("./helpers");
const { la, setupSolo, bookingInput, MIN } = h;

const t = useTestDb();
const NOW = la("2030-10-07 08:00");

beforeEach(() => {
  pay.configured = false;
});

async function runCodeJob(reservationId: string, at = NOW): Promise<string> {
  const rows = await t.db.select().from(jobs).where(eq(jobs.type, "booking.send_verification_code"));
  const job = rows.filter((j) => (j.payload as { reservationId?: string }).reservationId === reservationId).at(-1)!;
  await handlers["booking.send_verification_code"]!(job.payload, { db: t.db, jobId: job.id, attempt: 1, now: at, log });
  const [mail] = await t.db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.template, "booking.verification_code"), eq(emailOutbox.idempotencyKey, `booking.verification_code:${(job.payload as { codeId: string }).codeId}`)));
  const code = /^(\d{6}) is your verification code$/.exec(mail!.subject)?.[1];
  expect(code).toBeTruthy();
  return code!;
}

describe("email verification (BK-17)", () => {
  it("holds the slot, stores an HMAC of the code, emails it and books after the right code", async () => {
    const fx = await setupSolo(t.db, { eventType: { requireEmailVerification: true } });
    const start = la("2030-10-08 10:00");
    const input = bookingInput(fx.target, start, { invitee: { name: "Ana", email: "ana@example.com", timezone: "UTC" } });
    const r = await createBooking(input, { now: NOW });
    expect(r).toMatchObject({ ok: false, code: "verification_required", message: "To complete your booking, enter the 6-digit code sent to ana@example.com" });
    if (r.ok || !r.reservationId) throw new Error("expected a reservation");
    const reservationId = r.reservationId;

    const [res] = await t.db.select().from(bookingReservations).where(eq(bookingReservations.id, reservationId));
    expect(res).toMatchObject({ kind: "email_verification", status: "pending", hostUserIds: [fx.owner.id], isGroupSeat: false });
    expect(res!.expiresAt.getTime() - NOW.getTime()).toBe(10 * MIN);
    expect(await t.db.select().from(invitees).where(eq(invitees.eventTypeId, fx.target.eventType.id))).toHaveLength(0);

    // The job payload carries the code encrypted; the table stores only an HMAC.
    const [job] = await t.db.select().from(jobs).where(eq(jobs.type, "booking.send_verification_code"));
    expect(JSON.stringify(job!.payload)).not.toMatch(/"\d{6}"/);
    const code = await runCodeJob(reservationId);
    const [row] = await t.db.select().from(verificationCodes).where(eq(verificationCodes.contextId, reservationId));
    expect(row!.codeHash).not.toContain(code);
    expect(row!.codeHash).toMatch(/^[0-9a-f]{64}$/);

    // Another invitee cannot take the held slot (SCH-19).
    const other = await createBooking(bookingInput(fx.target, start), { now: NOW });
    expect(other).toMatchObject({ ok: false, code: "slot_unavailable" });

    // A double click reuses the live hold and sends no second code.
    const again = await createBooking(input, { now: new Date(NOW.getTime() + 5_000) });
    expect(again).toMatchObject({ code: "verification_required", reservationId });
    expect(await t.db.select().from(verificationCodes).where(eq(verificationCodes.contextId, reservationId))).toHaveLength(1);

    const wrong = await verifyReservationCode(reservationId, code === "000000" ? "111111" : "000000", { now: NOW });
    expect(wrong).toEqual({ ok: false, code: "invalid_code", message: "That code isn't correct. Try again." });
    const ok = await verifyReservationCode(reservationId, code, { now: NOW, rememberDevice: true });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.trustedDevice?.cookieName).toBe("kairos_trusted_device");
    const [inv] = await t.db.select().from(invitees).where(eq(invitees.id, ok.inviteeId));
    expect(inv).toMatchObject({ reservationId, email: "ana@example.com" });
    expect(inv!.emailVerifiedAt).not.toBeNull();
    expect((await t.db.select().from(bookingReservations).where(eq(bookingReservations.id, reservationId)))[0]!.status).toBe("completed");
    // Idempotent: verifying again returns the same booking.
    const replay = await verifyReservationCode(reservationId, code, { now: NOW });
    expect(replay.ok && replay.inviteeId).toBe(ok.inviteeId);
    expect(await getReservationStatus(reservationId)).toMatchObject({ status: "completed", inviteeId: ok.inviteeId, kind: "email_verification" });

    // Remember this device: the next booking for that email skips verification.
    expect(await t.db.select().from(trustedDevices)).toHaveLength(1);
    const tokens = ok.trustedDevice!.value.split(".");
    const next = await createBooking(bookingInput(fx.target, la("2030-10-08 11:00"), { invitee: { name: "Ana", email: "ANA@example.com", timezone: "UTC" } }), {
      now: NOW,
      trustedDeviceTokens: tokens,
    });
    expect(next.ok).toBe(true);
    const otherEmail = await createBooking(bookingInput(fx.target, la("2030-10-08 12:00")), { now: NOW, trustedDeviceTokens: tokens });
    expect(otherEmail).toMatchObject({ code: "verification_required" });
  });

  it("rejects expired codes and locks the code after 5 wrong attempts; resend issues a new code (max 5 per hour)", async () => {
    const fx = await setupSolo(t.db, { eventType: { requireEmailVerification: true } });
    const r = await createBooking(bookingInput(fx.target, la("2030-10-08 13:00")), { now: NOW });
    const reservationId = (r as { reservationId: string }).reservationId;
    const code = await runCodeJob(reservationId);
    const wrong = code === "123456" ? "654321" : "123456";
    for (let i = 0; i < 4; i++) expect((await verifyReservationCode(reservationId, wrong, { now: NOW })).ok).toBe(false);
    expect(await verifyReservationCode(reservationId, wrong, { now: NOW })).toMatchObject({ code: "too_many_attempts" });
    expect(await verifyReservationCode(reservationId, code, { now: NOW })).toMatchObject({ code: "too_many_attempts" });

    await resendReservationCode(reservationId, { now: new Date(NOW.getTime() + 60_000) });
    const fresh = await runCodeJob(reservationId, new Date(NOW.getTime() + 60_000));
    if (fresh !== code) expect(await verifyReservationCode(reservationId, code, { now: NOW })).toMatchObject({ ok: false });
    // The hold was extended with the resend; an expired code is refused.
    expect(await verifyReservationCode(reservationId, fresh, { now: new Date(NOW.getTime() + 12 * MIN) })).toMatchObject({ code: "expired" });
    for (let i = 0; i < 4; i++) await resendReservationCode(reservationId, { now: new Date(NOW.getTime() + (2 + i) * 60_000) });
    await expect(resendReservationCode(reservationId, { now: new Date(NOW.getTime() + 7 * 60_000) })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("never asks for verification on reschedules", async () => {
    const fx = await setupSolo(t.db);
    const first = await createBooking(bookingInput(fx.target, la("2030-10-08 09:00")), { now: NOW });
    expect(first.ok).toBe(true);
    await h.updateEventType(t.db, fx.target.eventType.id, { requireEmailVerification: true });
    const target = await fx.reload();
    const moved = await createBooking(bookingInput(target, la("2030-10-08 15:00"), { reschedule: { inviteeId: (first as { inviteeId: string }).inviteeId } }), { now: NOW });
    expect(moved.ok).toBe(true);
  });
});

describe("reservations (SCH-19)", () => {
  it("payment holds complete at most once and refund when the slot is gone", async () => {
    pay.configured = true;
    const fx = await setupSolo(t.db, { eventType: { paymentEnabled: true, priceMinor: 5000, currency: "USD" } });
    const r = await createBooking(bookingInput(fx.target, la("2030-10-09 10:00")), { now: NOW });
    expect(r).toMatchObject({ ok: false, code: "payment_required" });
    const id = (r as { reservationId: string }).reservationId;
    const [a, b] = await Promise.all([
      completeReservation(id, { paymentId: "pay_1", now: NOW }),
      completeReservation(id, { paymentId: "pay_1", now: NOW }),
    ]);
    expect(a.ok && b.ok && a.inviteeId === b.inviteeId).toBe(true);
    expect(await t.db.select().from(invitees).where(eq(invitees.reservationId, id))).toHaveLength(1);

    // A hold whose slot was taken meanwhile (for example by a host override) is canceled with a refund job.
    const r2 = await createReservation({ ...bookingInput(fx.target, la("2030-10-09 11:00")), kind: "payment" }, { now: NOW });
    expect(r2.ok).toBe(true);
    const id2 = (r2 as { reservationId: string }).reservationId;
    await factories.createBooking(t.db, { eventType: fx.target.eventType, start: la("2030-10-09 11:00") });
    const lost = await completeReservation(id2, { paymentId: "pay_2", now: NOW });
    expect(lost).toMatchObject({ ok: false, code: "slot_unavailable" });
    expect((await t.db.select().from(bookingReservations).where(eq(bookingReservations.id, id2)))[0]!.status).toBe("canceled");
    const refunds = await t.db.select().from(jobs).where(eq(jobs.type, "payments.refund"));
    expect(refunds.map((j) => (j.payload as { reservationId: string }).reservationId)).toContain(id2);
  });

  it("an expired payment hold can still complete while the slot is free; expiry jobs mark holds expired", async () => {
    pay.configured = true;
    const fx = await setupSolo(t.db, { eventType: { paymentEnabled: true, priceMinor: 100, currency: "USD" } });
    const r = await createReservation({ ...bookingInput(fx.target, la("2030-10-10 10:00")), kind: "payment" }, { now: NOW });
    const id = (r as { reservationId: string }).reservationId;
    const later = new Date(NOW.getTime() + 20 * MIN);
    await handlers["booking.reservation_expire"]!({ reservationId: id }, { db: t.db, jobId: "j", attempt: 1, now: later, log });
    expect((await getReservationStatus(id))?.status).toBe("expired");
    const done = await completeReservation(id, { paymentId: "pay_late", now: later });
    expect(done.ok).toBe(true);
  });
});
