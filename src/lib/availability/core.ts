// Availability contract implementations (ARCHITECTURE section 25; SPEC AU-13, AV-06, AV-13, AV-15): the default
// schedule lookup, schedule-to-engine conversion and the default schedule invariant. Re-exported by ./index.ts.
import "server-only";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { advisoryXactLock } from "@/db/helpers";
import { availabilityDateOverrides, availabilitySchedules, userHolidayOverrides, users } from "@/db/schema";
import type { MinuteRange, WeeklyHours } from "@/db/types";
import { blockedDatesFor } from "@/lib/holidays";
import type { ScheduleInput } from "@/lib/slots/types";
import { addDays, localDateOf } from "@/lib/time/luxon";
import { zoneOrUtc } from "@/lib/time/zones";

export type ScheduleRow = typeof availabilitySchedules.$inferSelect;
export type ScheduleRange = { start: Date; end: Date };

export const DEFAULT_SCHEDULE_NAME = "Working hours";

const NINE_TO_FIVE = [{ start: 9 * 60, end: 17 * 60 }];
/** Mon to Fri 09:00 to 17:00 (index 0 = Sunday). */
export const DEFAULT_WEEKLY_HOURS: WeeklyHours = [[], NINE_TO_FIVE, NINE_TO_FIVE, NINE_TO_FIVE, NINE_TO_FIVE, NINE_TO_FIVE, []];

const personalSchedule = (userId: string) =>
  and(
    eq(availabilitySchedules.userId, userId),
    isNull(availabilitySchedules.eventTypeId),
    isNull(availabilitySchedules.singleUseLinkId),
    isNull(availabilitySchedules.deletedAt),
  );

const isRange = (r: unknown): r is MinuteRange => {
  const x = r as MinuteRange | null;
  return Boolean(x) && Number.isFinite(x!.start) && Number.isFinite(x!.end);
};

/** Seven arrays of finite ranges (malformed jsonb degrades to unavailable days; the engine drops invalid ranges). */
export function normalizeWeekly(raw: unknown): WeeklyHours {
  const days = Array.isArray(raw) ? raw : [];
  return Array.from({ length: 7 }, (_, d) => (Array.isArray(days[d]) ? (days[d] as unknown[]).filter(isRange).map((r) => ({ start: r.start, end: r.end })) : [])) as WeeklyHours;
}

/** The user's default schedule (falls back to their oldest personal schedule), or null. */
export async function getDefaultSchedule(userId: string, db?: DbOrTx): Promise<ScheduleRow | null> {
  const d = db ?? (await getDb());
  const rows = await d
    .select()
    .from(availabilitySchedules)
    .where(personalSchedule(userId))
    .orderBy(desc(availabilitySchedules.isDefault), asc(availabilitySchedules.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Engine input for one schedule (ARCHITECTURE section 8 step 1): weekly hours, date overrides within the range plus a
 * one day margin, and observed holidays of the owner's holiday country (substitute days included), all in the
 * schedule's zone. Holidays beat date-specific hours (the engine applies blockedDates first). Null when the schedule
 * does not exist or is deleted.
 */
export async function loadScheduleInput(
  scheduleId: string,
  range: ScheduleRange,
  opts: { db?: DbOrTx } = {},
): Promise<ScheduleInput | null> {
  const db = opts.db ?? (await getDb());
  const [row] = await db
    .select({ schedule: availabilitySchedules, holidayCountry: users.holidayCountry })
    .from(availabilitySchedules)
    .innerJoin(users, eq(users.id, availabilitySchedules.userId))
    .where(and(eq(availabilitySchedules.id, scheduleId), isNull(availabilitySchedules.deletedAt)))
    .limit(1);
  if (!row) return null;
  const zone = zoneOrUtc(row.schedule.timezone);
  const from = addDays(localDateOf(range.start, zone), -1);
  const to = addDays(localDateOf(range.end, zone), 1);
  const overrideRows = await db
    .select({ date: availabilityDateOverrides.date, intervals: availabilityDateOverrides.intervals })
    .from(availabilityDateOverrides)
    .where(
      and(
        eq(availabilityDateOverrides.scheduleId, scheduleId),
        gte(availabilityDateOverrides.date, from),
        lte(availabilityDateOverrides.date, to),
      ),
    );
  const overrides: Record<string, MinuteRange[]> = {};
  for (const o of overrideRows) overrides[o.date] = Array.isArray(o.intervals) ? o.intervals.filter(isRange) : [];

  let blockedDates: string[] = [];
  if (row.holidayCountry) {
    const holidayRows = await db
      .select({ key: userHolidayOverrides.holidayKey, observed: userHolidayOverrides.observed })
      .from(userHolidayOverrides)
      .where(eq(userHolidayOverrides.userId, row.schedule.userId));
    const holidayOverrides = Object.fromEntries(holidayRows.map((h) => [h.key, h.observed]));
    blockedDates = blockedDatesFor(row.holidayCountry, holidayOverrides, from, to, zone);
  }
  return { timeZone: zone, weekly: normalizeWeekly(row.schedule.weeklyHours), overrides, blockedDates };
}

/**
 * Returns the user's default schedule (AV-15: users always have exactly one). When none is marked default, the oldest
 * live personal schedule is promoted; when the user has no schedule at all, "Working hours" (Mon to Fri 09:00 to 17:00
 * in `timezone`, else UTC) is created. Race safe inside the caller's transaction (schedules_one_default_uq).
 */
export async function ensureDefaultSchedule(
  tx: DbOrTx,
  userId: string,
  opts: { timezone?: string | null; name?: string; weeklyHours?: WeeklyHours } = {},
): Promise<ScheduleRow> {
  const findDefault = async () =>
    (
      await tx
        .select()
        .from(availabilitySchedules)
        .where(and(personalSchedule(userId), eq(availabilitySchedules.isDefault, true)))
        .limit(1)
    )[0] ?? null;
  const existing = await findDefault();
  if (existing) return existing;

  // Serialize with the schedule services (same key as lockUserSchedules; transaction advisory locks are re-entrant).
  await advisoryXactLock(tx, `availability:${userId}`);
  const again = await findDefault();
  if (again) return again;
  const [oldest] = await tx
    .select({ id: availabilitySchedules.id })
    .from(availabilitySchedules)
    .where(personalSchedule(userId))
    .orderBy(asc(availabilitySchedules.createdAt))
    .limit(1);
  if (oldest) {
    const [promoted] = await tx
      .update(availabilitySchedules)
      .set({ isDefault: true })
      .where(and(eq(availabilitySchedules.id, oldest.id), isNull(availabilitySchedules.deletedAt)))
      .returning();
    if (promoted) return promoted;
  }

  const inserted = await tx
    .insert(availabilitySchedules)
    .values({
      userId,
      name: opts.name ?? DEFAULT_SCHEDULE_NAME,
      timezone: zoneOrUtc(opts.timezone),
      isDefault: true,
      weeklyHours: opts.weeklyHours ?? DEFAULT_WEEKLY_HOURS,
    })
    .onConflictDoNothing({
      target: availabilitySchedules.userId,
      where: sql`is_default and event_type_id is null and single_use_link_id is null and deleted_at is null`,
    })
    .returning();
  if (inserted[0]) return inserted[0];
  const row = await findDefault();
  if (!row) throw new Error("ensureDefaultSchedule: default schedule missing after conflict");
  return row;
}
