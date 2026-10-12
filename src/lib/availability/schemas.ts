// Zod schemas and limits of the availability module (ARCHITECTURE section 26 rule 4; SPEC AV-02, AV-04, AV-06, AV-14).
// Client and server safe: the Schedules page validates with the same rules before auto-saving.
import { z } from "zod";
import type { MinuteRange, WeeklyHours } from "@/db/types";
import { zId, zTimeZone } from "@/lib/validation";
import { END_BEFORE_START_MESSAGE, intervalErrors, isIsoDate, MAX_INTERVALS_PER_DAY, sortIntervals } from "./intervals";

/** Up to 50 named schedules per user (AV-02, our choice). */
export const MAX_SCHEDULES = 50;
/** Up to 1,000 date-specific hours per schedule (AV-06, our choice). */
export const MAX_OVERRIDES = 1000;
/** Dates one "+ Hours" apply may set at once. */
export const MAX_OVERRIDE_DATES_PER_APPLY = 366;
/** Schedule names: 1 to 60 characters (AV-02). */
export const SCHEDULE_NAME_MAX = 60;
/** Host meeting limits: 1 to 999 per period (SPEC Appendix A). */
export const MEETING_LIMIT_MAX = 999;

export const SCHEDULE_LIMIT_MESSAGE = `You can have up to ${MAX_SCHEDULES} schedules.`;
export const OVERRIDE_LIMIT_MESSAGE = "You can add up to 1,000 date-specific hours to a schedule.";

export const zScheduleName = z
  .string({ error: "Enter a schedule name." })
  .trim()
  .min(1, "Enter a schedule name.")
  .max(SCHEDULE_NAME_MAX, `Use ${SCHEDULE_NAME_MAX} characters or fewer.`);

const zMinute = z.number({ error: "Enter a time." }).int("Enter a time.").min(0, "Enter a time.").max(1440, "Enter a time.");

/**
 * One day's intervals with the AV-04 messages on the offending interval ("{index}.end"); output sorted by start.
 * Touching intervals are valid; zero-length intervals are rejected (the UI never creates them).
 */
export const zDayIntervalsInput: z.ZodType<MinuteRange[]> = z
  .array(z.object({ start: zMinute, end: zMinute }))
  .max(MAX_INTERVALS_PER_DAY, `Add up to ${MAX_INTERVALS_PER_DAY} sets of times per day.`)
  .superRefine((list, ctx) => {
    intervalErrors(list).forEach((message, i) => {
      if (message) ctx.addIssue({ code: "custom", message, path: [i, message === END_BEFORE_START_MESSAGE ? "end" : "start"] });
    });
  })
  .transform((list) => sortIntervals(list));

/** Seven days (index 0 = Sunday), each validated and sorted. */
export const zWeeklyHoursInput: z.ZodType<WeeklyHours> = z
  .tuple([zDayIntervalsInput, zDayIntervalsInput, zDayIntervalsInput, zDayIntervalsInput, zDayIntervalsInput, zDayIntervalsInput, zDayIntervalsInput])
  .transform((v) => v as WeeklyHours);

export const zOverrideDate = z.string().refine(isIsoDate, "Choose a valid date.");

export const zScheduleId = zId;

export const CreateScheduleInput = z.object({ name: zScheduleName });
export const RenameScheduleInput = z.object({ scheduleId: zScheduleId, name: zScheduleName });
export const ScheduleRefInput = z.object({ scheduleId: zScheduleId });
export const DeleteScheduleInput = z.object({ scheduleId: zScheduleId, replacementId: zScheduleId.nullish() });
export const WeeklyHoursInput = z.object({ scheduleId: zScheduleId, weeklyHours: zWeeklyHoursInput });
export const ScheduleTimezoneInput = z.object({ scheduleId: zScheduleId, timezone: zTimeZone });
export const UpsertOverridesInput = z.object({
  scheduleId: zScheduleId,
  dates: z
    .array(zOverrideDate)
    .min(1, "Select at least one date.")
    .max(MAX_OVERRIDE_DATES_PER_APPLY, `Select up to ${MAX_OVERRIDE_DATES_PER_APPLY} dates at a time.`),
  intervals: zDayIntervalsInput,
});
export const DeleteOverrideInput = z.object({ scheduleId: zScheduleId, date: zOverrideDate });
export const ActiveOnInput = z.object({
  scheduleId: zScheduleId,
  eventTypeIds: z.array(zId).max(500),
  replaceCustom: z.boolean().default(false),
});

// ---------------------------------------------------------------------------------------------------------------
// Host meeting limits (AV-14, SCH-09)

export const LIMIT_PERIODS = ["day", "week", "month"] as const;
export type LimitPeriod = (typeof LIMIT_PERIODS)[number];
export type MeetingLimits = { day: number | null; week: number | null; month: number | null };

const zLimit = z
  .number({ error: "Enter a number from 1 to 999." })
  .int("Enter a whole number.")
  .min(1, "Enter a number from 1 to 999.")
  .max(MEETING_LIMIT_MAX, "Enter a number from 1 to 999.")
  .nullable();

export const MeetingLimitsInput = z.object({ day: zLimit, week: zLimit, month: zLimit });

export const LIMIT_PERIOD_LABELS: Record<LimitPeriod, string> = { day: "day", week: "week", month: "month" };

export type LimitRow = { period: LimitPeriod; count: number };

/** Rows of the "Meeting limits" card in period order. */
export function limitRows(limits: MeetingLimits): LimitRow[] {
  return LIMIT_PERIODS.flatMap((period) => (limits[period] ? [{ period, count: limits[period]! }] : []));
}

/** The limits a list of rows describes (the first row of a period wins). */
export function rowsToLimits(rows: readonly { period: LimitPeriod; count: number | null }[]): MeetingLimits {
  const out: MeetingLimits = { day: null, week: null, month: null };
  for (const r of rows) if (out[r.period] === null && r.count !== null) out[r.period] = r.count;
  return out;
}
