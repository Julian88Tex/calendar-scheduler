// Availability schedules and date overrides.
import type { DbOrTx } from "@/db";
import { availabilityDateOverrides, availabilitySchedules } from "@/db/schema";
import type { MinuteRange, WeeklyHours } from "@/db/types";
import { one, WEEKDAYS_9_TO_5 } from "./_util";

export type ScheduleRow = typeof availabilitySchedules.$inferSelect;

export type CreateScheduleOptions = {
  userId: string;
  name?: string;
  timezone?: string;
  /** Default true unless eventTypeId or singleUseLinkId is set (custom schedules are never the default). */
  isDefault?: boolean;
  weeklyHours?: WeeklyHours;
  eventTypeId?: string | null;
  singleUseLinkId?: string | null;
  dateOverrides?: { date: string; intervals: MinuteRange[] }[];
  overrides?: Partial<typeof availabilitySchedules.$inferInsert>;
};

export async function createSchedule(db: DbOrTx, opts: CreateScheduleOptions): Promise<ScheduleRow> {
  const custom = Boolean(opts.eventTypeId || opts.singleUseLinkId);
  const schedule = one(
    await db
      .insert(availabilitySchedules)
      .values({
        userId: opts.userId,
        name: opts.name ?? "Working hours",
        timezone: opts.timezone ?? "America/New_York",
        isDefault: opts.isDefault ?? !custom,
        weeklyHours: opts.weeklyHours ?? WEEKDAYS_9_TO_5,
        eventTypeId: opts.eventTypeId ?? null,
        singleUseLinkId: opts.singleUseLinkId ?? null,
        ...opts.overrides,
      })
      .returning(),
    "schedule",
  );
  if (opts.dateOverrides?.length) {
    await db
      .insert(availabilityDateOverrides)
      .values(opts.dateOverrides.map((o) => ({ scheduleId: schedule.id, date: o.date, intervals: o.intervals })));
  }
  return schedule;
}
