// Race safety on real Postgres (SPEC SCH-19, SCH-20, BK-19, CR-04; ARCHITECTURE section 9; run with npm run test:pg):
// 10 concurrent bookings of one solo slot produce one booking; two submits with one client request id return the
// same invitee; two concurrent reschedules of one invitee produce one new invitee; a cancel racing a reschedule
// serializes; 10 concurrent reservations for one slot create one; completeReservation called concurrently creates one
// invitee; two concurrent round robin bookings at one time go to different hosts; concurrent first bookings of a
// group slot share one scheduled event.
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/payments", () => ({ isPaymentsConfigured: () => true }));
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));

const { bookingReservations, invitees, scheduledEventHosts, scheduledEvents } = await import("@/db/schema");
const { completeReservation, createBooking, createReservation } = await import("@/lib/booking/create");
const { lockHostsInTx, lockInviteeForChangeInTx } = await import("@/lib/booking/locks");
const { loadEventType } = await import("@/lib/booking/target");
const { isAppError } = await import("@/lib/errors");
const f = await import("../factories");
const { createTestDb } = await import("../helpers/db");
const h = await import("./helpers");
const { la, setupSolo, bookingInput, everyDay } = h;

const NOW = la("2030-10-07 08:00");
const ctx = { now: NOW };

describe.runIf(process.env.TEST_DATABASE_URL)("booking races on real Postgres", () => {
  it("10 concurrent bookings of one solo slot produce exactly 1 booking", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 24 });
    try {
      const fx = await setupSolo(t.db);
      const start = la("2030-10-08 10:00");
      const results = await Promise.all(Array.from({ length: 10 }, () => createBooking(bookingInput(fx.target, start), ctx)));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      expect(results.filter((r) => !r.ok && r.code === "slot_unavailable")).toHaveLength(9);
      const events = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.eventTypeId, fx.target.eventType.id));
      expect(events).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it("two submits with one client request id return the same invitee", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 12 });
    try {
      const fx = await setupSolo(t.db);
      const input = bookingInput(fx.target, la("2030-10-08 11:00"), { clientRequestId: "same-click-123" });
      const [a, b] = await Promise.all([createBooking(input, ctx), createBooking(input, ctx)]);
      expect(a.ok && b.ok).toBe(true);
      expect(a.ok && b.ok && a.inviteeId === b.inviteeId).toBe(true);
      expect(await t.db.select().from(invitees).where(eq(invitees.clientRequestId, "same-click-123"))).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it("two concurrent reschedules of one invitee produce exactly one new invitee", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 12 });
    try {
      const fx = await setupSolo(t.db);
      const first = await createBooking(bookingInput(fx.target, la("2030-10-08 09:00")), ctx);
      if (!first.ok) throw new Error("setup booking failed");
      const target = await fx.reload();
      const [a, b] = await Promise.all([
        createBooking(bookingInput(target, la("2030-10-09 10:00"), { reschedule: { inviteeId: first.inviteeId } }), ctx),
        createBooking(bookingInput(target, la("2030-10-10 10:00"), { reschedule: { inviteeId: first.inviteeId } }), ctx),
      ]);
      expect([a, b].filter((r) => r.ok)).toHaveLength(1);
      expect([a, b].find((r) => !r.ok)).toMatchObject({ code: "slot_unavailable", message: "This event can no longer be rescheduled." });
      const children = await t.db.select().from(invitees).where(eq(invitees.oldInviteeId, first.inviteeId));
      expect(children).toHaveLength(1);
      const active = await t.db.select().from(scheduledEvents).where(and(eq(scheduledEvents.eventTypeId, fx.target.eventType.id), eq(scheduledEvents.status, "active")));
      expect(active).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it("a cancel racing a reschedule serializes (exactly one wins)", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 12 });
    try {
      const fx = await setupSolo(t.db);
      for (const date of ["2030-10-08", "2030-10-09", "2030-10-10", "2030-10-11"]) {
        const first = await createBooking(bookingInput(fx.target, la(`${date} 09:00`)), ctx);
        if (!first.ok) throw new Error("setup booking failed");
        const target = await fx.reload();
        // lifecycle-core's cancel: host locks, then the invitee row lock, then the update.
        const cancel = t.db
          .transaction(async (tx) => {
            await lockHostsInTx(tx, [fx.owner.id]);
            await lockInviteeForChangeInTx(tx, first.inviteeId);
            await tx.update(invitees).set({ status: "canceled", canceledAt: NOW, cancelerType: "invitee" }).where(eq(invitees.id, first.inviteeId));
            await tx.update(scheduledEvents).set({ status: "canceled", canceledAt: NOW }).where(eq(scheduledEvents.id, first.scheduledEventId));
            await tx.update(scheduledEventHosts).set({ isActive: false }).where(eq(scheduledEventHosts.scheduledEventId, first.scheduledEventId));
            return "canceled" as const;
          })
          .catch((e: unknown) => (isAppError(e) && e.code === "conflict" ? ("conflict" as const) : Promise.reject(e)));
        const reschedule = createBooking(bookingInput(target, la(`${date} 15:00`), { reschedule: { inviteeId: first.inviteeId } }), ctx);
        const [c, r] = await Promise.all([cancel, reschedule]);
        const [old] = await t.db.select().from(invitees).where(eq(invitees.id, first.inviteeId));
        if (c === "canceled") {
          expect(r).toMatchObject({ ok: false, code: "slot_unavailable" });
          expect(old).toMatchObject({ status: "canceled", rescheduled: false, newInviteeId: null });
        } else {
          expect(c).toBe("conflict");
          expect(r.ok).toBe(true);
          expect(old).toMatchObject({ status: "canceled", rescheduled: true });
        }
      }
    } finally {
      await t.close();
    }
  });

  it("10 concurrent reservations for one solo slot create exactly one", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 24 });
    try {
      const fx = await setupSolo(t.db, { eventType: { paymentEnabled: true, priceMinor: 1000, currency: "USD" } });
      const start = la("2030-10-08 13:00");
      const results = await Promise.all(Array.from({ length: 10 }, () => createReservation({ ...bookingInput(fx.target, start), kind: "payment" }, ctx)));
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const rows = await t.db.select().from(bookingReservations).where(eq(bookingReservations.eventTypeId, fx.target.eventType.id));
      expect(rows).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it("completeReservation called concurrently (webhook and return page) creates one invitee", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 24 });
    try {
      const fx = await setupSolo(t.db, { eventType: { paymentEnabled: true, priceMinor: 1000, currency: "USD" } });
      const r = await createReservation({ ...bookingInput(fx.target, la("2030-10-08 14:00")), kind: "payment" }, ctx);
      if (!r.ok) throw new Error("reservation failed");
      const results = await Promise.all(Array.from({ length: 6 }, () => completeReservation(r.reservationId, { paymentId: "pi_1", now: NOW })));
      expect(results.every((x) => x.ok)).toBe(true);
      expect(new Set(results.map((x) => (x.ok ? x.inviteeId : null))).size).toBe(1);
      expect(await t.db.select().from(invitees).where(eq(invitees.reservationId, r.reservationId))).toHaveLength(1);
    } finally {
      await t.close();
    }
  });

  it("two concurrent round robin bookings at one time go to different hosts", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 12 });
    try {
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
      const target = { kind: "event_type" as const, eventType: (await loadEventType(eventType.id, t.db))! };
      const start = la("2030-10-08 10:00");
      const [x, y] = await Promise.all([createBooking(bookingInput(target, start), ctx), createBooking(bookingInput(target, start), ctx)]);
      expect(x.ok && y.ok).toBe(true);
      const hosts = await t.db.select().from(scheduledEventHosts).where(eq(scheduledEventHosts.eventTypeId, eventType.id));
      expect(new Set(hosts.map((r) => r.userId)).size).toBe(2);
    } finally {
      await t.close();
    }
  });

  it("concurrent first bookings of a group slot share one scheduled event", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 24 });
    try {
      const fx = await setupSolo(t.db, { eventType: { kind: "group", maxInvitees: 5, slotIncrementMinutes: 60 } });
      const start = la("2030-10-08 10:00");
      const results = await Promise.all(Array.from({ length: 6 }, () => createBooking(bookingInput(fx.target, start), ctx)));
      expect(results.filter((r) => r.ok)).toHaveLength(5);
      const events = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.eventTypeId, fx.target.eventType.id));
      expect(events).toHaveLength(1);
      expect(await t.db.select().from(invitees).where(eq(invitees.scheduledEventId, events[0]!.id))).toHaveLength(5);
    } finally {
      await t.close();
    }
  });
});
