// Reminder timing helpers (SPEC NT-09, NT-11): offsets in minutes before the event, shown as "24 hours before event".
// Pure and client safe (the event type section uses them for its inputs, labels and validation).

export const OFFSET_UNITS = ["minutes", "hours", "days"] as const;
export type OffsetUnit = (typeof OFFSET_UNITS)[number];

export const UNIT_MINUTES: Readonly<Record<OffsetUnit, number>> = { minutes: 1, hours: 60, days: 1440 };

/** NT-11: offsets up to 365 days (WORKFLOW_MAX_OFFSET_MINUTES in the schema). */
export const MAX_OFFSET_MINUTES = 525_600;
/** NT-11: a "before event starts" timing is at least 1 minute. */
export const MIN_BEFORE_OFFSET_MINUTES = 1;
/** NT-09: up to 3 email reminder timings per event type (our choice); host reminders follow the same rule. */
export const MAX_REMINDER_TIMINGS = 3;
/** NT-09: the default reminder timing (24 hours before the event, Calendly's default). */
export const DEFAULT_REMINDER_OFFSET_MINUTES = 1440;
/** NT-11: timings shorter than this need a pinger that runs every 5 minutes. */
export const SHORT_TIMING_MINUTES = 30;

export const TIMING_MESSAGES = {
  amount: "Enter a number greater than 0.",
  max: "Choose a time up to 365 days.",
  duplicate: "Each reminder needs a different time.",
  tooMany: `You can add up to ${MAX_REMINDER_TIMINGS} reminders.`,
  none: "Add at least one reminder time.",
} as const;

export type Timing = { amount: number; unit: OffsetUnit };

/** Minutes for an amount and unit (NaN when the amount is not a positive whole number). */
export function toOffsetMinutes(amount: number, unit: OffsetUnit): number {
  if (!Number.isInteger(amount) || amount < 1) return Number.NaN;
  return amount * UNIT_MINUTES[unit];
}

/**
 * The natural amount and unit of an offset: whole days from 2 days up, whole hours (so the default reads
 * "24 hours", like Calendly), otherwise minutes.
 */
export function splitOffset(minutes: number): Timing {
  const m = Math.max(0, Math.trunc(minutes));
  if (m >= 2 * 1440 && m % 1440 === 0) return { amount: m / 1440, unit: "days" };
  if (m >= 60 && m % 60 === 0) return { amount: m / 60, unit: "hours" };
  return { amount: m, unit: "minutes" };
}

const UNIT_WORDS: Record<OffsetUnit, [string, string]> = {
  minutes: ["minute", "minutes"],
  hours: ["hour", "hours"],
  days: ["day", "days"],
};

/** "24 hours", "1 hour", "15 minutes", "3 days". */
export function offsetDuration(minutes: number): string {
  const { amount, unit } = splitOffset(minutes);
  const [one, many] = UNIT_WORDS[unit];
  return `${amount} ${amount === 1 ? one : many}`;
}

/** "24 hours before event". */
export function offsetLabel(minutes: number): string {
  return `${offsetDuration(minutes)} before event`;
}

/** Offsets sorted from the earliest reminder (largest offset) to the latest. */
export function sortOffsets(offsets: readonly number[]): number[] {
  return [...new Set(offsets)].sort((a, b) => b - a);
}

/** "24 hours and 1 hour before event"; "1 day, 1 hour and 15 minutes before event". */
export function offsetsSummary(offsets: readonly number[]): string {
  const parts = sortOffsets(offsets).map(offsetDuration);
  if (!parts.length) return "";
  const list = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `${list} before event`;
}

/** Per-row and list errors for reminder timings (keys: "{index}" for a row, "list" for the whole list). */
export function validateTimings(timings: readonly Timing[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!timings.length) errors.list = TIMING_MESSAGES.none;
  if (timings.length > MAX_REMINDER_TIMINGS) errors.list = TIMING_MESSAGES.tooMany;
  const seen = new Map<number, number>();
  timings.forEach((t, i) => {
    const minutes = toOffsetMinutes(t.amount, t.unit);
    if (!Number.isFinite(minutes) || minutes < MIN_BEFORE_OFFSET_MINUTES) {
      errors[String(i)] = TIMING_MESSAGES.amount;
      return;
    }
    if (minutes > MAX_OFFSET_MINUTES) {
      errors[String(i)] = TIMING_MESSAGES.max;
      return;
    }
    if (seen.has(minutes)) errors[String(i)] = TIMING_MESSAGES.duplicate;
    else seen.set(minutes, i);
  });
  return errors;
}
