// Named schedule services on PGlite (SPEC AV-02, AV-03, AV-04, AV-06, AV-08, AV-15): create, rename, clone, set
// default, delete with reassignment, weekly hours, zone, date-specific hours, limits and ownership checks.
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { availabilityDateOverrides, availabilitySchedules, eventTypeHosts, eventTypes } from "@/db/schema";
import type { WeeklyHours } from "@/db/types";
import {
  cloneSchedule,
  copyName,
  createSchedule,
  deleteDateOverride,
  deleteSchedule,
  ensureDefaultSchedule,
  getDefaultSchedule,
  getSchedule,
  listSchedules,
  renameSchedule,
  setDefaultSchedule,
  updateScheduleTimezone,
  updateWeeklyHours,
  upsertDateOverrides,
} from "@/lib/availability";
import { isAppError } from "@/lib/errors";
import { createEventType, createSchedule as seedSchedule, createUser, type TestUser } from "../factories";
import { useTestDb } from "../helpers/db";

const t = useTestDb();
const h = (hh: number, mm = 0) => hh * 60 + mm;
const NINE_FIVE = [{ start: h(9), end: h(17) }];

async function expectAppError(p: Promise<unknown>, code: string, message?: string) {
  try {
    await p;
  } catch (e) {
    expect(isAppError(e)).toBe(true);
    expect((e as { code: string }).code).toBe(code);
    if (message) expect((e as Error).message).toBe(message);
    return;
  }
  throw new Error(`expected AppError ${code}`);
}

async function userWithDefault(): Promise<{ user: TestUser; defaultId: string }> {
  const user = await createUser(t.db, { timezone: "America/Los_Angeles" });
  const row = await seedSchedule(t.db, {
    userId: user.id,
    name: "Working hours",
    timezone: "America/Los_Angeles",
    weeklyHours: [[{ start: h(14), end: h(19) }], NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE, []],
  });
  return { user, defaultId: row.id };
}

async function defaults(userId: string) {
  return t.db
    .select({ id: availabilitySchedules.id })
    .from(availabilitySchedules)
    .where(
      and(
        eq(availabilitySchedules.userId, userId),
        eq(availabilitySchedules.isDefault, true),
        isNull(availabilitySchedules.eventTypeId),
        isNull(availabilitySchedules.deletedAt),
      ),
    );
}

describe("create, rename, clone", () => {
  it("creates a schedule from the default's hours and zone (not default)", async () => {
    const { user, defaultId } = await userWithDefault();
    const created = await createSchedule(t.db, user.id, { name: "  Block Off Work " });
    expect(created.name).toBe("Block Off Work");
    expect(created.isDefault).toBe(false);
    expect(created.timezone).toBe("America/Los_Angeles");
    const def = await getSchedule(user.id, defaultId);
    expect(created.weeklyHours).toEqual(def?.weeklyHours);
    const list = await listSchedules(user.id);
    expect(list.map((s) => [s.name, s.isDefault])).toEqual([
      ["Working hours", true],
      ["Block Off Work", false],
    ]);
  });

  it("makes the first schedule of a user without any the default", async () => {
    const user = await createUser(t.db, { timezone: "Europe/Berlin" });
    const created = await createSchedule(t.db, user.id, { name: "Mine", timezone: "Europe/Berlin" });
    expect(created.isDefault).toBe(true);
    expect(created.timezone).toBe("Europe/Berlin");
  });

  it("limits a user to 50 schedules", async () => {
    const { user } = await userWithDefault();
    for (let i = 0; i < 49; i++) await seedSchedule(t.db, { userId: user.id, name: `S${i}`, isDefault: false });
    await expectAppError(createSchedule(t.db, user.id, { name: "One too many" }), "conflict", "You can have up to 50 schedules.");
  });

  it("renames, and clones hours, zone and date-specific hours", async () => {
    const { user, defaultId } = await userWithDefault();
    await upsertDateOverrides(t.db, user.id, defaultId, { dates: ["2030-10-22", "2030-10-23"], intervals: [] });
    await updateScheduleTimezone(t.db, user.id, defaultId, "America/New_York");
    const renamed = await renameSchedule(t.db, user.id, defaultId, "Office");
    expect(renamed.name).toBe("Office");
    const clone = await cloneSchedule(t.db, user.id, defaultId);
    expect(clone.name).toBe("Office (copy)");
    expect(clone.isDefault).toBe(false);
    const detail = await getSchedule(user.id, clone.id);
    expect(detail?.timezone).toBe("America/New_York");
    expect(detail?.overrides).toEqual([
      { date: "2030-10-22", intervals: [] },
      { date: "2030-10-23", intervals: [] },
    ]);
    expect(copyName("x".repeat(60))).toHaveLength(60);
  });

  it("never touches another user's schedule", async () => {
    const { defaultId } = await userWithDefault();
    const other = await createUser(t.db);
    await expectAppError(renameSchedule(t.db, other.id, defaultId, "Mine now"), "not_found");
    await expectAppError(updateWeeklyHours(t.db, other.id, defaultId, [[], [], [], [], [], [], []]), "not_found");
    await expectAppError(upsertDateOverrides(t.db, other.id, defaultId, { dates: ["2030-01-01"], intervals: [] }), "not_found");
    await expectAppError(deleteSchedule(t.db, other.id, defaultId), "not_found");
    await expectAppError(renameSchedule(t.db, other.id, "not-a-uuid", "x"), "not_found");
    expect(await getSchedule(other.id, defaultId)).toBeNull();
  });
});

describe("default schedule invariant (AV-15)", () => {
  it("moves the default label and pins event types that relied on the old default", async () => {
    const { user, defaultId } = await userWithDefault();
    const second = await createSchedule(t.db, user.id, { name: "Block Off Work" });
    const implicit = await createEventType(t.db, { owner: user, overrides: { scheduleId: null } });
    const explicit = await createEventType(t.db, { owner: user, overrides: { scheduleId: second.id } });
    await setDefaultSchedule(t.db, user.id, second.id);
    expect((await defaults(user.id)).map((r) => r.id)).toEqual([second.id]);
    expect((await getDefaultSchedule(user.id))?.id).toBe(second.id);
    const [a] = await t.db.select().from(eventTypes).where(eq(eventTypes.id, implicit.eventType.id));
    const [b] = await t.db.select().from(eventTypes).where(eq(eventTypes.id, explicit.eventType.id));
    expect(a?.scheduleId).toBe(defaultId);
    expect(b?.scheduleId).toBe(second.id);
    // idempotent
    await setDefaultSchedule(t.db, user.id, second.id);
    expect((await defaults(user.id)).length).toBe(1);
  });

  it("cannot delete the default schedule", async () => {
    const { user, defaultId } = await userWithDefault();
    await expectAppError(deleteSchedule(t.db, user.id, defaultId), "conflict", "Set another schedule as default first.");
  });

  it("ensureDefaultSchedule promotes the oldest schedule instead of creating one", async () => {
    const user = await createUser(t.db);
    const a = await seedSchedule(t.db, { userId: user.id, name: "A", isDefault: false });
    await seedSchedule(t.db, { userId: user.id, name: "B", isDefault: false });
    const def = await t.db.transaction((tx) => ensureDefaultSchedule(tx, user.id));
    expect(def.id).toBe(a.id);
    expect(def.isDefault).toBe(true);
    expect((await listSchedules(user.id)).filter((s) => s.isDefault)).toHaveLength(1);
  });

  it("ensureDefaultSchedule creates Working hours (Mon to Fri 9 to 5) for a user without schedules", async () => {
    const user = await createUser(t.db);
    const def = await t.db.transaction((tx) => ensureDefaultSchedule(tx, user.id, { timezone: "Asia/Tokyo" }));
    expect(def.name).toBe("Working hours");
    expect(def.timezone).toBe("Asia/Tokyo");
    expect(def.weeklyHours).toEqual([[], NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE, NINE_FIVE, []]);
    const again = await t.db.transaction((tx) => ensureDefaultSchedule(tx, user.id, { timezone: "UTC" }));
    expect(again.id).toBe(def.id);
  });
});

describe("delete with reassignment (AV-02)", () => {
  it("switches event types and per-host hours to the replacement and hides the schedule", async () => {
    const { user, defaultId } = await userWithDefault();
    const doomed = await createSchedule(t.db, user.id, { name: "Old" });
    const other = await createSchedule(t.db, user.id, { name: "Other" });
    const et1 = await createEventType(t.db, { owner: user, overrides: { scheduleId: doomed.id } });
    const et2 = await createEventType(t.db, { owner: user, hosts: [{ userId: user.id, scheduleId: doomed.id }] });
    const listed = (await listSchedules(user.id)).find((s) => s.id === doomed.id);
    expect(listed?.eventTypeCount).toBe(2);

    const res = await deleteSchedule(t.db, user.id, doomed.id, { replacementId: other.id });
    expect(res).toEqual({ reassigned: 2, replacementId: other.id });
    const [a] = await t.db.select().from(eventTypes).where(eq(eventTypes.id, et1.eventType.id));
    const [host] = await t.db.select().from(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, et2.eventType.id));
    expect(a?.scheduleId).toBe(other.id);
    expect(host?.scheduleId).toBe(other.id);
    expect((await listSchedules(user.id)).map((s) => s.id)).toEqual([defaultId, other.id]);
    expect(await getSchedule(user.id, doomed.id)).toBeNull();
  });

  it("defaults the replacement to the default schedule and rejects foreign replacements", async () => {
    const { user, defaultId } = await userWithDefault();
    const doomed = await createSchedule(t.db, user.id, { name: "Old" });
    const et = await createEventType(t.db, { owner: user, overrides: { scheduleId: doomed.id } });
    const stranger = await userWithDefault();
    await expectAppError(deleteSchedule(t.db, user.id, doomed.id, { replacementId: stranger.defaultId }), "not_found");
    await expectAppError(deleteSchedule(t.db, user.id, doomed.id, { replacementId: doomed.id }), "validation");
    const res = await deleteSchedule(t.db, user.id, doomed.id);
    expect(res.replacementId).toBe(defaultId);
    const [row] = await t.db.select().from(eventTypes).where(eq(eventTypes.id, et.eventType.id));
    expect(row?.scheduleId).toBe(defaultId);
  });
});

describe("hours, zone and date-specific hours", () => {
  it("stores weekly hours sorted and rejects overlaps", async () => {
    const { user, defaultId } = await userWithDefault();
    const week: WeeklyHours = [[], [{ start: h(13), end: h(17) }, { start: h(9), end: h(12) }], [], [], [], [], []];
    await updateWeeklyHours(t.db, user.id, defaultId, week);
    expect((await getSchedule(user.id, defaultId))?.weeklyHours[1]).toEqual([
      { start: h(9), end: h(12) },
      { start: h(13), end: h(17) },
    ]);
    await expectAppError(
      updateWeeklyHours(t.db, user.id, defaultId, [[], [{ start: h(9), end: h(12) }, { start: h(11), end: h(13) }], [], [], [], [], []]),
      "validation",
    );
    // touching intervals stay separate rows
    await updateWeeklyHours(t.db, user.id, defaultId, [[], [{ start: h(9), end: h(12) }, { start: h(12), end: h(17) }], [], [], [], [], []]);
    expect((await getSchedule(user.id, defaultId))?.weeklyHours[1]).toHaveLength(2);
  });

  it("validates the zone", async () => {
    const { user, defaultId } = await userWithDefault();
    await expectAppError(updateScheduleTimezone(t.db, user.id, defaultId, "Mars/Olympus"), "validation");
    await updateScheduleTimezone(t.db, user.id, defaultId, "Europe/Paris");
    expect((await getSchedule(user.id, defaultId))?.timezone).toBe("Europe/Paris");
  });

  it("adds date-specific hours for several dates, replaces them, and deletes one", async () => {
    const { user, defaultId } = await userWithDefault();
    await upsertDateOverrides(t.db, user.id, defaultId, { dates: ["2030-10-22", "2030-10-21"], intervals: [{ start: h(14), end: h(16) }, { start: h(10), end: h(12) }] });
    await upsertDateOverrides(t.db, user.id, defaultId, { dates: ["2030-10-22"], intervals: [] });
    let detail = await getSchedule(user.id, defaultId);
    expect(detail?.overrides).toEqual([
      { date: "2030-10-21", intervals: [{ start: h(10), end: h(12) }, { start: h(14), end: h(16) }] },
      { date: "2030-10-22", intervals: [] },
    ]);
    await deleteDateOverride(t.db, user.id, defaultId, "2030-10-21");
    detail = await getSchedule(user.id, defaultId);
    expect(detail?.overrides.map((o) => o.date)).toEqual(["2030-10-22"]);
  });

  it("limits a schedule to 1,000 date-specific hours", async () => {
    const { user, defaultId } = await userWithDefault();
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      scheduleId: defaultId,
      date: new Date(Date.UTC(2031, 0, 1 + i)).toISOString().slice(0, 10),
      intervals: [],
    }));
    await t.db.insert(availabilityDateOverrides).values(rows);
    await expectAppError(
      upsertDateOverrides(t.db, user.id, defaultId, { dates: ["2030-01-01"], intervals: [] }),
      "conflict",
      "You can add up to 1,000 date-specific hours to a schedule.",
    );
    // replacing an existing date stays within the limit
    await upsertDateOverrides(t.db, user.id, defaultId, { dates: [rows[0]!.date], intervals: NINE_FIVE });
  });
});
