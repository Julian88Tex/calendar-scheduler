// OWNER: availability. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Availability contract (ARCHITECTURE section 25): default schedule lookup, schedule-to-engine conversion and the
// default schedule invariant used by createUserAccount (AU-13: "Working hours", Mon to Fri 09:00 to 17:00).
// Foundation implements minimal real versions of all three; the availability module owns them afterwards (schedule
// CRUD, validation, custom schedules).
import "server-only";
import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { availabilityDateOverrides, availabilitySchedules, userHolidayOverrides, users } from "@/db/schema";
import type { WeeklyHours } from "@/db/types";
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
 * one day margin, and observed holidays of the owner's holiday country, all in the schedule's zone. Null when the
 * schedule does not exist or is deleted.
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
  const overrides: Record<string, { start: number; end: number }[]> = {};
  for (const o of overrideRows) overrides[o.date] = o.intervals ?? [];

  let blockedDates: string[] = [];
  if (row.holidayCountry) {
    const holidayRows = await db
      .select({ key: userHolidayOverrides.holidayKey, observed: userHolidayOverrides.observed })
      .from(userHolidayOverrides)
      .where(eq(userHolidayOverrides.userId, row.schedule.userId));
    const holidayOverrides = Object.fromEntries(holidayRows.map((h) => [h.key, h.observed]));
    blockedDates = blockedDatesFor(row.holidayCountry, holidayOverrides, from, to, zone);
  }
  return { timeZone: zone, weekly: row.schedule.weeklyHours, overrides, blockedDates };
}

/**
 * Returns the user's default schedule, creating "Working hours" (Mon to Fri 09:00 to 17:00 in `timezone`, else UTC)
 * when the user has none. Race safe inside the caller's transaction (schedules_one_default_uq).
 */
export async function ensureDefaultSchedule(
  tx: DbOrTx,
  userId: string,
  opts: { timezone?: string | null; name?: string; weeklyHours?: WeeklyHours } = {},
): Promise<ScheduleRow> {
  const existing = await tx
    .select()
    .from(availabilitySchedules)
    .where(and(personalSchedule(userId), eq(availabilitySchedules.isDefault, true)))
    .limit(1);
  if (existing[0]) return existing[0];
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
  const [row] = await tx
    .select()
    .from(availabilitySchedules)
    .where(and(personalSchedule(userId), eq(availabilitySchedules.isDefault, true)))
    .limit(1);
  if (!row) throw new Error("ensureDefaultSchedule: default schedule missing after conflict");
  return row;
}
