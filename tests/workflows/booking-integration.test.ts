// Reminders with the real booking service (booking-core) on PGlite: createBooking publishes booking.created and the
// workflows subscriber (through the real event registry and job runner) schedules the 24 hour reminder; a reschedule
// through createBooking cancels it and schedules the new meeting's reminder (SPEC NT-15, ET-25).
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { WeeklyHours } from "@/db/types";

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

const { workflowExecutions } = await import("@/db/schema");
const { createBooking } = await import("@/lib/booking/create");
const { runDueJobs } = await import("@/lib/jobs");
const { loadActorCtx } = await import("@/lib/authz");
const { now } = await import("@/lib/time/now");
const { setEventTypeRemindersEnabled } = await import("@/lib/workflows/reminders");
const f = await import("../factories");
const { useTestDb } = await import("../helpers/db");
const { DAY, executionsWhere, scheduledFor } = await import("./helpers");

const t = useTestDb();

const day = [{ start: 0, end: 24 * 60 }];
const ALL_DAY: WeeklyHours = [day, day, day, day, day, day, day];
/** A start N days from now on a 30 minute boundary. */
const slotIn = (days: number) => new Date(Math.ceil((now().getTime() + days * DAY) / (30 * 60_000)) * 30 * 60_000);

async function runEventJobs() {
  await runDueJobs({ budgetMs: 20_000, types: ["event:booking.created:workflows", "event:booking.rescheduled:workflows"] });
}

describe("reminders for real bookings", () => {
  it("schedules on booking and moves to the new meeting on reschedule", async () => {
    const owner = await f.createUser(t.db, { name: "Julian Joseph", timezone: "America/Los_Angeles" });
    await f.createSchedule(t.db, { userId: owner.id, timezone: "America/Los_Angeles", weeklyHours: ALL_DAY });
    const { eventType } = await f.createEventType(t.db, {
      owner,
      durationMinutes: 30,
      overrides: { slotIncrementMinutes: 30, minimumNoticeMinutes: 0, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, dateRangeDays: 60 },
    });
    const actor = await loadActorCtx(t.db, owner);
    await setEventTypeRemindersEnabled(actor, { eventTypeId: eventType.id, kind: "invitee", enabled: true }, t.db);

    const start = slotIn(3);
    const booked = await createBooking(
      {
        target: { kind: "event_type", eventTypeId: eventType.id },
        start: start.toISOString(),
        invitee: { name: "Ana Lima", email: "ana.lima@example.com", timezone: "America/New_York" },
        answers: [],
      },
      { now: now() },
    );
    expect(booked.ok).toBe(true);
    if (!booked.ok) return;
    await runEventJobs();
    const [reminder] = await scheduledFor(t.db, booked.inviteeId);
    expect(reminder).toBeDefined();
    expect(reminder!.runAt.getTime()).toBe(start.getTime() - DAY);

    const newStart = slotIn(5);
    const moved = await createBooking(
      {
        target: { kind: "event_type", eventTypeId: eventType.id },
        start: newStart.toISOString(),
        invitee: { name: "Ana Lima", email: "ana.lima@example.com", timezone: "America/New_York" },
        answers: [],
        reschedule: { inviteeId: booked.inviteeId, reason: "Conflict" },
      },
      { now: now() },
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    await runEventJobs();
    expect((await executionsWhere(t.db, eq(workflowExecutions.id, reminder!.id)))[0]).toMatchObject({ status: "canceled", skipReason: "rescheduled" });
    const [next] = await scheduledFor(t.db, moved.inviteeId);
    expect(next!.runAt.getTime()).toBe(newStart.getTime() - DAY);
  });
});
