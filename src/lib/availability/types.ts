// Serializable shapes of the availability module (client and server safe; the services in ./schedules.ts return them).
import type { MinuteRange, WeeklyHours } from "@/db/types";
import type { TroubleshootResult } from "@/lib/booking/types";
import type { DateOverride } from "./intervals";
import type { MeetingLimits } from "./schemas";

export type ScheduleSummary = {
  id: string;
  name: string;
  isDefault: boolean;
  timezone: string;
  /** Event types whose availability this schedule drives (event and per-host references, plus defaults for the default). */
  eventTypeCount: number;
};

export type ScheduleDetail = {
  id: string;
  name: string;
  isDefault: boolean;
  timezone: string;
  weeklyHours: WeeklyHours;
  /** Every date-specific override, sorted by date. */
  overrides: DateOverride[];
  /** Set for event-type custom schedules. */
  eventTypeId: string | null;
};

export type ActiveOnEventType = {
  id: string;
  name: string;
  color: string;
  active: boolean;
  secret: boolean;
  durationMinutes: number;
  durationOptions: number[];
  /** The schedule the event type uses now (a named schedule id, or its custom schedule id). */
  scheduleId: string | null;
  /** True when the event type uses its own custom hours (AV-11). */
  custom: boolean;
};

/** Active meetings where the user is a host in the day, week and month of a date (SCH-09 counting). */
export type HostMeetingCounts = { day: number; week: number; month: number; zone: string; weekStart: 0 | 1 };

export type TroubleshootScheduleHours = {
  scheduleId: string;
  name: string;
  timezone: string;
  custom: boolean;
  /** The day's wall-clock hours in the schedule's zone (empty = unavailable). */
  intervals: MinuteRange[];
  source: "override" | "weekly" | "holiday";
};

/** The Troubleshoot view of one local date (getTroubleshootDay). */
export type TroubleshootDay = {
  date: string;
  today: string;
  /** Zone of the date and of every time shown. */
  zone: string;
  hour12: boolean;
  weekStart: 0 | 1;
  /** Selected event type (null = every event type). */
  eventTypeId: string | null;
  durationMinutes: number | null;
  eventTypes: ActiveOnEventType[];
  /** Schedule names by id (named schedules). */
  scheduleNames: Record<string, string>;
  scheduleHours: Record<string, TroubleshootScheduleHours>;
  hostLimits: MeetingLimits;
  hostCounts: HostMeetingCounts | null;
  result: TroubleshootResult | null;
  error: string | null;
};
