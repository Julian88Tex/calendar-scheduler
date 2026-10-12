// Host meeting limits across all event types (SPEC AV-14, SCH-09): users.meeting_limit_day / _week / _month. The
// availability service (booking-core) reads the same columns for every event type where the user is a host; this
// module owns editing them and the counts shown next to them.
import "server-only";
import { and, count, eq, gte, isNull, lt } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { scheduledEventHosts, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { addDays, DateTime, localDateOf, startOfLocalDay } from "@/lib/time/luxon";
import { now } from "@/lib/time/now";
import { zoneOrUtc } from "@/lib/time/zones";
import { getDefaultSchedule } from "./core";
import { MEETING_LIMIT_MAX, type MeetingLimits } from "./schemas";
import type { HostMeetingCounts } from "./types";

export type { MeetingLimits } from "./schemas";
export type { HostMeetingCounts } from "./types";

/** The user's host-level limits (null = no limit for that period). */
export async function getMeetingLimits(userId: string, db?: DbOrTx): Promise<MeetingLimits> {
  const d = db ?? (await getDb());
  const [row] = await d
    .select({ day: users.meetingLimitDay, week: users.meetingLimitWeek, month: users.meetingLimitMonth })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!row) throw new AppError("not_found", "This person could not be found.");
  return { day: row.day ?? null, week: row.week ?? null, month: row.month ?? null };
}

const validLimit = (v: number | null) => v === null || (Number.isInteger(v) && v >= 1 && v <= MEETING_LIMIT_MAX);

/** Replaces the user's host-level limits (each 1 to 999 or null). */
export async function setMeetingLimits(db: DbOrTx, userId: string, limits: MeetingLimits): Promise<MeetingLimits> {
  if (![limits.day, limits.week, limits.month].every(validLimit)) {
    throw new AppError("validation", "Enter a number from 1 to 999.");
  }
  const [row] = await db
    .update(users)
    .set({ meetingLimitDay: limits.day, meetingLimitWeek: limits.week, meetingLimitMonth: limits.month, updatedAt: now() })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .returning({ day: users.meetingLimitDay, week: users.meetingLimitWeek, month: users.meetingLimitMonth });
  if (!row) throw new AppError("not_found", "This person could not be found.");
  return { day: row.day ?? null, week: row.week ?? null, month: row.month ?? null };
}

export type PeriodBounds = { start: Date; end: Date };

/** The day, week (from `weekStart`) and month containing local `date` in `zone`, as UTC instants [start, end). */
export function periodBounds(date: string, zone: string, weekStart: 0 | 1): Record<"day" | "week" | "month", PeriodBounds> {
  const z = zoneOrUtc(zone);
  const day = DateTime.fromISO(date, { zone: z });
  const weekday = day.weekday % 7; // luxon: Monday 1 .. Sunday 7 -> Sunday 0
  const weekFirst = addDays(date, -((weekday - weekStart + 7) % 7));
  const monthFirst = `${date.slice(0, 7)}-01`;
  const nextMonth = DateTime.fromISO(monthFirst, { zone: "utc" }).plus({ months: 1 }).toISODate()!;
  return {
    day: { start: startOfLocalDay(date, z), end: startOfLocalDay(addDays(date, 1), z) },
    week: { start: startOfLocalDay(weekFirst, z), end: startOfLocalDay(addDays(weekFirst, 7), z) },
    month: { start: startOfLocalDay(monthFirst, z), end: startOfLocalDay(nextMonth, z) },
  };
}


/**
 * Active meetings where the user is a host (every event type and source, SCH-09), by start, in the day, week and month
 * of local `date` (default: today), evaluated in the user's default schedule zone with their week start (like the slot
 * engine).
 */
export async function countHostMeetings(userId: string, date?: string | null, db?: DbOrTx): Promise<HostMeetingCounts> {
  const d = db ?? (await getDb());
  const [user] = await d
    .select({ timezone: users.timezone, weekStart: users.weekStart })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const schedule = await getDefaultSchedule(userId, d);
  const zone = zoneOrUtc(schedule?.timezone ?? user?.timezone);
  const weekStart: 0 | 1 = user?.weekStart === 1 ? 1 : 0;
  const bounds = periodBounds(date ?? localDateOf(now(), zone), zone, weekStart);
  const countIn = async (b: PeriodBounds) => {
    const [row] = await d
      .select({ n: count() })
      .from(scheduledEventHosts)
      .where(
        and(
          eq(scheduledEventHosts.userId, userId),
          eq(scheduledEventHosts.isActive, true),
          gte(scheduledEventHosts.startAt, b.start),
          lt(scheduledEventHosts.startAt, b.end),
        ),
      );
    return Number(row?.n ?? 0);
  };
  const [day, week, month] = await Promise.all([countIn(bounds.day), countIn(bounds.week), countIn(bounds.month)]);
  return { day, week, month, zone, weekStart };
}
