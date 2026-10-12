// "Active on" assignment and event-type custom schedules on PGlite (SPEC AV-09, AV-11, AV-12, ET-19).
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { availabilitySchedules, eventTypeHosts, eventTypes } from "@/db/schema";
import {
  createCustomSchedule,
  createSchedule,
  getSchedule,
  listActiveOnEventTypes,
  listSchedules,
  resolveEventTypeSchedule,
  setEventTypeSchedule,
  setScheduleEventTypes,
  updateWeeklyHours,
} from "@/lib/availability";
import { isAppError } from "@/lib/errors";
import { createEventType, createSchedule as seedSchedule, createUser } from "../factories";
import { useTestDb } from "../helpers/db";

const t = useTestDb();
const h = (hh: number) => hh * 60;
const NINE_FIVE = [{ start: h(9), end: h(17) }];

async function owner() {
  const user = await createUser(t.db, { timezone: "America/Los_Angeles" });
  const working = await seedSchedule(t.db, { userId: user.id, name: "Working hours", timezone: "America/Los_Angeles" });
  const block = await seedSchedule(t.db, {
    userId: user.id,
    name: "Block Off Work",
    isDefault: false,
    timezone: "America/Los_Angeles",
    weeklyHours: [[{ start: h(13), end: h(21) }], [], [{ start: h(17), end: h(20) }], [], [], [], []],
  });
  const thirty = (await createEventType(t.db, { owner: user, name: "30 Minute Virtual", overrides: { scheduleId: working.id, position: 0 } })).eventType;
  const sixty = (await createEventType(t.db, { owner: user, name: "60 Minute Virtual", overrides: { scheduleId: null, position: 1 } })).eventType;
  const meal = (await createEventType(t.db, { owner: user, name: "In-Person Meal or Coffee", overrides: { scheduleId: block.id, position: 2 } })).eventType;
  return { user, working, block, thirty, sixty, meal };
}

const scheduleOf = async (eventTypeId: string) => (await t.db.select().from(eventTypes).where(eq(eventTypes.id, eventTypeId)))[0]?.scheduleId;

describe("Active on (AV-09)", () => {
  it("lists personal event types with the schedule each one uses", async () => {
    const f = await owner();
    const list = await listActiveOnEventTypes(f.user.id);
    expect(list.map((e) => [e.name, e.scheduleId, e.custom])).toEqual([
      ["30 Minute Virtual", f.working.id, false],
      ["60 Minute Virtual", f.working.id, false],
      ["In-Person Meal or Coffee", f.block.id, false],
    ]);
    const counts = Object.fromEntries((await listSchedules(f.user.id)).map((s) => [s.name, s.eventTypeCount]));
    expect(counts).toEqual({ "Working hours": 2, "Block Off Work": 1 });
  });

  it("checking an event type assigns it; unchecking moves it back to the default", async () => {
    const f = await owner();
    await setScheduleEventTypes(t.db, f.user.id, f.block.id, { eventTypeIds: [f.meal.id, f.thirty.id] });
    expect(await scheduleOf(f.thirty.id)).toBe(f.block.id);
    await setScheduleEventTypes(t.db, f.user.id, f.block.id, { eventTypeIds: [f.thirty.id] });
    expect(await scheduleOf(f.meal.id)).toBe(f.working.id);
    expect(await scheduleOf(f.thirty.id)).toBe(f.block.id);
  });

  it("the default schedule's event types cannot be unchecked", async () => {
    const f = await owner();
    const res = await setScheduleEventTypes(t.db, f.user.id, f.working.id, { eventTypeIds: [] });
    expect(res.changed).toBe(0);
    expect(await scheduleOf(f.thirty.id)).toBe(f.working.id);
  });

  it("asks before replacing custom hours, then deletes them", async () => {
    const f = await owner();
    const custom = await createCustomSchedule(t.db, { eventTypeId: f.sixty.id, userId: f.user.id });
    await t.db.update(eventTypes).set({ scheduleId: custom.id }).where(eq(eventTypes.id, f.sixty.id));
    expect((await listActiveOnEventTypes(f.user.id)).find((e) => e.id === f.sixty.id)?.custom).toBe(true);

    try {
      await setScheduleEventTypes(t.db, f.user.id, f.block.id, { eventTypeIds: [f.meal.id, f.sixty.id] });
      throw new Error("expected a conflict");
    } catch (e) {
      expect(isAppError(e) && e.code).toBe("conflict");
      expect(isAppError(e) && e.details).toEqual({ customEventTypeIds: [f.sixty.id] });
    }
    await setScheduleEventTypes(t.db, f.user.id, f.block.id, { eventTypeIds: [f.meal.id, f.sixty.id], replaceCustom: true });
    expect(await scheduleOf(f.sixty.id)).toBe(f.block.id);
    const [row] = await t.db.select().from(availabilitySchedules).where(eq(availabilitySchedules.id, custom.id));
    expect(row?.deletedAt).not.toBeNull();
  });

  it("rejects event types of other users", async () => {
    const f = await owner();
    const g = await owner();
    await expect(setScheduleEventTypes(t.db, f.user.id, f.block.id, { eventTypeIds: [g.thirty.id] })).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("custom schedules (AV-11)", () => {
  it("a custom schedule starts as a copy of the default and is hidden from the Schedules list", async () => {
    const f = await owner();
    const custom = await createCustomSchedule(t.db, { eventTypeId: f.thirty.id, userId: f.user.id });
    expect(custom.eventTypeId).toBe(f.thirty.id);
    expect(custom.weeklyHours).toEqual(f.working.weeklyHours);
    expect((await listSchedules(f.user.id)).some((s) => s.id === custom.id)).toBe(false);
    expect(await getSchedule(f.user.id, custom.id)).toBeNull();
    // idempotent
    expect((await createCustomSchedule(t.db, { eventTypeId: f.thirty.id, userId: f.user.id })).id).toBe(custom.id);
  });

  it("copies the chosen schedule and rejects schedules the user cannot use", async () => {
    const f = await owner();
    const g = await owner();
    const custom = await createCustomSchedule(t.db, { eventTypeId: f.meal.id, userId: f.user.id, from: f.block.id });
    expect(custom.weeklyHours).toEqual(f.block.weeklyHours);
    await expect(createCustomSchedule(t.db, { eventTypeId: f.sixty.id, userId: f.user.id, from: g.block.id })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("editing event A's custom schedule does not affect event B", async () => {
    const f = await owner();
    const a = await setEventTypeSchedule(t.db, {
      eventTypeId: f.thirty.id,
      userId: f.user.id,
      choice: { kind: "custom", content: { timezone: "America/Los_Angeles", weeklyHours: [[], NINE_FIVE, [], [], [], [], []], overrides: [{ date: "2030-01-02", intervals: [] }] } },
    });
    const b = await setEventTypeSchedule(t.db, {
      eventTypeId: f.sixty.id,
      userId: f.user.id,
      choice: { kind: "custom", content: { timezone: "America/Los_Angeles", weeklyHours: [[], [], NINE_FIVE, [], [], [], []], overrides: [] } },
    });
    expect(a.custom && b.custom).toBe(true);
    await setEventTypeSchedule(t.db, {
      eventTypeId: f.thirty.id,
      userId: f.user.id,
      choice: { kind: "custom", content: { timezone: "Europe/London", weeklyHours: [[], [], [], NINE_FIVE, [], [], []], overrides: [] } },
    });
    const ra = await resolveEventTypeSchedule(f.thirty.id, f.user.id);
    const rb = await resolveEventTypeSchedule(f.sixty.id, f.user.id);
    expect(ra.scheduleId).toBe(a.scheduleId);
    expect(ra.custom).toBe(true);
    expect(ra.schedule?.timezone).toBe("Europe/London");
    expect(ra.schedule?.weeklyHours[3]).toEqual(NINE_FIVE);
    expect(ra.schedule?.overrides).toEqual([]);
    expect(rb.schedule?.weeklyHours[2]).toEqual(NINE_FIVE);
    expect(rb.schedule?.timezone).toBe("America/Los_Angeles");
  });

  it("switching back to a named schedule deletes the custom one", async () => {
    const f = await owner();
    const { scheduleId } = await setEventTypeSchedule(t.db, {
      eventTypeId: f.meal.id,
      userId: f.user.id,
      choice: { kind: "custom", content: { timezone: "America/Los_Angeles", weeklyHours: [[], [], [], [], [], [], NINE_FIVE], overrides: [] } },
    });
    await setEventTypeSchedule(t.db, { eventTypeId: f.meal.id, userId: f.user.id, choice: { kind: "schedule", scheduleId: f.working.id } });
    expect(await scheduleOf(f.meal.id)).toBe(f.working.id);
    const live = await t.db
      .select()
      .from(availabilitySchedules)
      .where(and(eq(availabilitySchedules.eventTypeId, f.meal.id), isNull(availabilitySchedules.deletedAt)));
    expect(live).toHaveLength(0);
    expect(scheduleId).not.toBe(f.working.id);
    const state = await resolveEventTypeSchedule(f.meal.id, f.user.id);
    expect(state).toMatchObject({ scheduleId: f.working.id, custom: false });
  });

  it("per-host custom hours point the host row at the custom schedule (AV-12)", async () => {
    const f = await owner();
    const res = await setEventTypeSchedule(t.db, {
      eventTypeId: f.thirty.id,
      userId: f.user.id,
      scope: "host",
      choice: { kind: "custom", content: { timezone: "America/Los_Angeles", weeklyHours: [NINE_FIVE, [], [], [], [], [], []], overrides: [] } },
    });
    const [host] = await t.db.select().from(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, f.thirty.id));
    expect(host?.scheduleId).toBe(res.scheduleId);
    expect((await listActiveOnEventTypes(f.user.id)).find((e) => e.id === f.thirty.id)).toMatchObject({ scheduleId: res.scheduleId, custom: true });
  });

  it("rejects invalid custom hours and foreign named schedules", async () => {
    const f = await owner();
    const g = await owner();
    await expect(
      setEventTypeSchedule(t.db, {
        eventTypeId: f.thirty.id,
        userId: f.user.id,
        choice: { kind: "custom", content: { timezone: "UTC", weeklyHours: [[{ start: h(9), end: h(12) }, { start: h(11), end: h(13) }], [], [], [], [], [], []], overrides: [] } },
      }),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      setEventTypeSchedule(t.db, { eventTypeId: f.thirty.id, userId: f.user.id, choice: { kind: "schedule", scheduleId: g.working.id } }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("a named schedule edit reaches every event type using it", async () => {
    const f = await owner();
    await updateWeeklyHours(t.db, f.user.id, f.working.id, [[], [], [], [], [], [], NINE_FIVE]);
    const a = await resolveEventTypeSchedule(f.thirty.id, f.user.id);
    const b = await resolveEventTypeSchedule(f.sixty.id, f.user.id);
    expect(a.schedule?.weeklyHours[6]).toEqual(NINE_FIVE);
    expect(b.scheduleId).toBe(f.working.id);
    expect(b.schedule?.weeklyHours[6]).toEqual(NINE_FIVE);
  });

  it("createSchedule then Active on uses the new schedule for new assignments", async () => {
    const f = await owner();
    const evenings = await createSchedule(t.db, f.user.id, { name: "Evenings" });
    await setScheduleEventTypes(t.db, f.user.id, evenings.id, { eventTypeIds: [f.sixty.id] });
    expect((await listActiveOnEventTypes(f.user.id)).find((e) => e.id === f.sixty.id)?.scheduleId).toBe(evenings.id);
  });
});
