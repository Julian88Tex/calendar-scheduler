// Troubleshoot page data on PGlite (docs/SCOPE.md priority 4): the local day in the selected event type's schedule
// zone, the hours each schedule offers that day, host limits and counts, and booking-core's diagnostics (mocked here:
// booking-core owns troubleshootAvailability).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TroubleshootParams, TroubleshootResult } from "@/lib/booking/types";

const booking = vi.hoisted(() => ({
  calls: [] as { actor: { userId: string; organizationId: string; orgRole?: string }; params: TroubleshootParams }[],
  fail: null as Error | null,
}));
vi.mock("@/lib/booking", () => ({
  troubleshootAvailability: async (actor: { userId: string; organizationId: string }, params: TroubleshootParams): Promise<TroubleshootResult> => {
    booking.calls.push({ actor, params });
    if (booking.fail) throw booking.fail;
    return {
      host: { id: actor.userId, name: "Owner", timeZone: "America/Los_Angeles", weekStart: 0 },
      hostLimits: { day: 2, week: null, month: null },
      calendar: { status: "ok", stale: false },
      busy: [],
      entries: [],
    };
  },
}));

const { AppError } = await import("@/lib/errors");
const { setFakeNow, resetFakeTime } = await import("@/lib/time/now");
const { getTroubleshootDay, clampTroubleshootDate } = await import("@/lib/availability/troubleshoot");
const { setMeetingLimits, upsertDateOverrides } = await import("@/lib/availability");
const { createEventType, createSchedule, createUser } = await import("../factories");
const { useTestDb } = await import("../helpers/db");

const t = useTestDb();
const h = (hh: number) => hh * 60;

beforeEach(() => {
  booking.calls = [];
  booking.fail = null;
  resetFakeTime();
});

async function owner() {
  const user = await createUser(t.db, { timezone: "America/New_York" });
  const working = await createSchedule(t.db, {
    userId: user.id,
    timezone: "America/Los_Angeles",
    weeklyHours: [[], [{ start: h(12), end: h(17) }], [{ start: h(11), end: h(23) }], [], [], [], []],
  });
  const tokyo = await createSchedule(t.db, { userId: user.id, name: "Tokyo", isDefault: false, timezone: "Asia/Tokyo" });
  const et = (await createEventType(t.db, { owner: user, name: "30 Minute Virtual", overrides: { scheduleId: working.id } })).eventType;
  const trip = (await createEventType(t.db, { owner: user, name: "Trip", overrides: { scheduleId: tokyo.id } })).eventType;
  const actor = { orgId: user.organizationId, orgRole: user.orgRole, user };
  return { user, working, tokyo, et, trip, actor };
}

describe("getTroubleshootDay", () => {
  it("diagnoses one local day of every event type in the default schedule zone", async () => {
    const f = await owner();
    setFakeNow("2030-10-08T15:00:00Z"); // Tue 08:00 in Los Angeles
    await setMeetingLimits(t.db, f.user.id, { day: 2, week: null, month: null });
    const day = await getTroubleshootDay(f.actor, { date: "2030-10-08" });
    expect(day.zone).toBe("America/Los_Angeles");
    expect(day.today).toBe("2030-10-08");
    expect(day.eventTypeId).toBeNull();
    expect(booking.calls).toHaveLength(1);
    expect(booking.calls[0]!.actor).toEqual({ userId: f.user.id, organizationId: f.user.organizationId, orgRole: "owner" });
    expect(booking.calls[0]!.params.eventTypeId).toBeNull();
    expect(booking.calls[0]!.params.start.toISOString()).toBe("2030-10-08T07:00:00.000Z");
    expect(booking.calls[0]!.params.end.toISOString()).toBe("2030-10-09T07:00:00.000Z");
    expect(day.scheduleHours[f.working.id]).toMatchObject({ name: "Working hours", intervals: [{ start: h(11), end: h(23) }], source: "weekly" });
    expect(day.scheduleHours[f.tokyo.id]?.name).toBe("Tokyo");
    expect(day.hostLimits).toEqual({ day: 2, week: null, month: null });
    expect(day.hostCounts).toMatchObject({ day: 0, week: 0 });
    expect(day.error).toBeNull();
    expect(day.result?.hostLimits.day).toBe(2);
  });

  it("uses the selected event type's schedule zone and its date-specific hours", async () => {
    const f = await owner();
    setFakeNow("2030-10-08T15:00:00Z");
    await upsertDateOverrides(t.db, f.user.id, f.tokyo.id, { dates: ["2030-10-09"], intervals: [{ start: h(8), end: h(10) }] });
    const day = await getTroubleshootDay(f.actor, { date: "2030-10-09", eventTypeId: f.trip.id });
    expect(day.zone).toBe("Asia/Tokyo");
    expect(day.eventTypeId).toBe(f.trip.id);
    expect(booking.calls[0]!.params.eventTypeId).toBe(f.trip.id);
    expect(booking.calls[0]!.params.start.toISOString()).toBe("2030-10-08T15:00:00.000Z");
    expect(Object.keys(day.scheduleHours)).toEqual([f.tokyo.id]);
    expect(day.scheduleHours[f.tokyo.id]).toMatchObject({ source: "override", intervals: [{ start: h(8), end: h(10) }] });
  });

  it("ignores foreign event types and invalid dates", async () => {
    const f = await owner();
    const g = await owner();
    setFakeNow("2030-10-08T15:00:00Z");
    const day = await getTroubleshootDay(f.actor, { date: "2030-13-40", eventTypeId: g.et.id });
    expect(day.eventTypeId).toBeNull();
    expect(day.date).toBe("2030-10-08");
    expect(booking.calls[0]!.params.eventTypeId).toBeNull();
    expect(clampTroubleshootDate("2050-01-01", "2030-10-08")).toBe("2030-10-08");
    expect(clampTroubleshootDate("2031-01-01", "2030-10-08")).toBe("2031-01-01");
  });

  it("reports diagnostics failures inline", async () => {
    const f = await owner();
    booking.fail = new AppError("not_configured");
    expect((await getTroubleshootDay(f.actor, {})).error).toBe("Troubleshooting isn't available right now. Try again later.");
    booking.fail = new Error("boom");
    const day = await getTroubleshootDay(f.actor, {});
    expect(day.error).toBe("We couldn't check your availability. Try again.");
    expect(day.result).toBeNull();
    expect(day.eventTypes).toHaveLength(2);
  });

  it("skips diagnostics for a user without event types", async () => {
    const user = await createUser(t.db);
    await createSchedule(t.db, { userId: user.id });
    const day = await getTroubleshootDay({ orgId: user.organizationId, orgRole: user.orgRole, user }, {});
    expect(booking.calls).toHaveLength(0);
    expect(day.result).toBeNull();
    expect(day.eventTypes).toEqual([]);
  });

  it("passes a duration only when the event type offers it", async () => {
    const f = await owner();
    const multi = (await createEventType(t.db, { owner: f.user, overrides: { durationMinutes: 30, durationOptions: [30, 60], scheduleId: f.working.id } })).eventType;
    await getTroubleshootDay(f.actor, { eventTypeId: multi.id, durationMinutes: 60 });
    await getTroubleshootDay(f.actor, { eventTypeId: multi.id, durationMinutes: 45 });
    expect(booking.calls.map((c) => c.params.durationMinutes)).toEqual([60, undefined]);
  });
});
