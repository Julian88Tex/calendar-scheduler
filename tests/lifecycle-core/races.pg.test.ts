// Race safety of the lifecycle services on real Postgres (SPEC CR-02, CR-04, SCH-20; ARCHITECTURE 9 lock order; run
// with npm run test:pg): a cancel racing a reschedule of the same invitee serializes (exactly one wins, the other sees
// the invitee already canceled or rescheduled), two cancels of one invitee cancel once, and concurrent cancels of every
// invitee of a group slot cancel the meeting exactly once with one meetingCanceled event.
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/calendars", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/calendars")>();
  return {
    ...real,
    getExternalBusy: async (p: { userIds: string[] }) => Object.fromEntries(p.userIds.map((id) => [id, { ok: true, stale: false, nocal: false, busy: [] }])),
    getDestinationCalendar: async () => null,
  };
});
vi.mock("@/lib/links", () => ({
  resolveBookingCode: async () => null,
  consumeLinkInTx: async () => {},
  getReservedIntervals: async () => ({}),
  LinkUsedError: class LinkUsedError extends Error {},
}));
vi.mock("@/lib/polls", () => ({ getPollReservedIntervals: async () => ({}), markPollBookedInTx: async () => {} }));
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [], getSubscriber: () => null, isSubscriberKey: () => false }));

const { domainEvents, invitees, scheduledEvents } = await import("@/db/schema");
const { setFakeNow, resetFakeTime } = await import("@/lib/time/now");
const { createTestDb } = await import("../helpers/db");
const { cancelInvitee } = await import("@/lib/lifecycle/cancel");
const { rescheduleInvitee } = await import("@/lib/lifecycle/reschedule");
const h = await import("./helpers");
const { CAFE, NOW, book, la, setupHost } = h;

describe.runIf(process.env.TEST_DATABASE_URL)("lifecycle races on real Postgres", () => {
  it("a cancel racing a reschedule of one invitee: exactly one wins", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 16 });
    setFakeNow(NOW);
    try {
      const fx = await setupHost(t.db, { locations: [CAFE] });
      for (let i = 0; i < 4; i++) {
        const day = String(8 + i).padStart(2, "0");
        const r = await book(fx, la(`2030-10-${day} 10:00`));
        const [cancel, resched] = await Promise.allSettled([
          cancelInvitee({ inviteeId: r.inviteeId, actor: { type: "invitee" }, reason: "race" }),
          rescheduleInvitee({ inviteeId: r.inviteeId, start: la(`2030-10-${day} 14:00`).toISOString(), actor: { type: "invitee" } }),
        ]);
        const cancelWon = cancel.status === "fulfilled";
        const reschedWon = resched.status === "fulfilled" && resched.value.ok;
        expect(Number(cancelWon) + Number(reschedWon)).toBe(1);
        if (cancelWon) {
          expect(resched.status === "fulfilled" && !resched.value.ok && resched.value.message).toBe("This event can no longer be rescheduled.");
        } else {
          expect(cancel.status === "rejected" && (cancel.reason as { code?: string }).code).toBe("conflict");
        }
        const [old] = await t.db.select().from(invitees).where(eq(invitees.id, r.inviteeId));
        expect(old!.status).toBe("canceled");
        const successors = await t.db.select().from(invitees).where(eq(invitees.oldInviteeId, r.inviteeId));
        expect(successors).toHaveLength(reschedWon ? 1 : 0);
        expect(old!.rescheduled).toBe(reschedWon);
      }
    } finally {
      resetFakeTime();
      await t.close();
    }
  });

  it("two concurrent cancels of one invitee cancel once", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 12 });
    setFakeNow(NOW);
    try {
      const fx = await setupHost(t.db, { locations: [CAFE] });
      const r = await book(fx, la("2030-10-08 11:00"));
      const results = await Promise.allSettled([1, 2, 3].map(() => cancelInvitee({ inviteeId: r.inviteeId, actor: { type: "invitee" } })));
      expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      const events = await t.db.select().from(domainEvents).where(eq(domainEvents.type, "booking.canceled"));
      expect(events).toHaveLength(1);
    } finally {
      resetFakeTime();
      await t.close();
    }
  });

  it("concurrent cancels of every group invitee cancel the slot exactly once", async () => {
    const t = await createTestDb({ kind: "postgres", poolSize: 16 });
    setFakeNow(NOW);
    try {
      const fx = await setupHost(t.db, { kind: "group", maxInvitees: 5, locations: [CAFE] });
      const start = la("2030-10-09 10:00");
      const seats = [];
      for (const n of ["a", "b", "c", "d"]) seats.push(await book(fx, start, { invitee: { name: n, email: `${n}.race@example.com`, timezone: "UTC" } }));
      const meetingId = seats[0]!.scheduledEventId;
      const results = await Promise.all(seats.map((s) => cancelInvitee({ inviteeId: s.inviteeId, actor: { type: "invitee" } })));
      expect(results.filter((r) => r.meetingCanceled)).toHaveLength(1);
      const [m] = await t.db.select().from(scheduledEvents).where(eq(scheduledEvents.id, meetingId));
      expect(m!.status).toBe("canceled");
      const active = await t.db.select().from(invitees).where(and(eq(invitees.scheduledEventId, meetingId), eq(invitees.status, "active")));
      expect(active).toHaveLength(0);
      const events = await t.db.select().from(domainEvents).where(eq(domainEvents.type, "booking.canceled"));
      expect(events.filter((e) => (e.payload as { meetingCanceled: boolean }).meetingCanceled)).toHaveLength(1);
    } finally {
      resetFakeTime();
      await t.close();
    }
  });
});
