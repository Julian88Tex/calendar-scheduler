// OWNER: availability. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Availability contract (ARCHITECTURE section 25) plus the module's services. Server only; client code imports the
// pure helpers from their own files: @/lib/availability/intervals (validation, sorting, summaries, override helpers),
// @/lib/availability/schemas (zod schemas and limits), @/lib/availability/links (hrefs, e.g. troubleshootHref for the
// booking page owner banner) and @/lib/availability/troubleshoot-view (Troubleshoot copy).
//
// Contract (foundation signatures, unchanged):
//   getDefaultSchedule(userId, db?)                       the default schedule (else the oldest personal one) or null
//   loadScheduleInput(scheduleId, { start, end }, { db }) slot engine ScheduleInput: weekly, overrides in range (+1 day
//                                                         margin), blockedDates from holidays (beat overrides)
//   ensureDefaultSchedule(tx, userId, opts)               exactly one default schedule (AV-15)
//
// Services (additive):
//   schedules.ts  named schedule CRUD, clone, set default, delete with reassignment, weekly hours, zone, date-specific
//                 hours, "Active on" (listActiveOnEventTypes, setScheduleEventTypes)
//   custom.ts     event-type custom schedules and per-host custom hours for the event type editor
//                 (resolveEventTypeSchedule, setEventTypeSchedule, createCustomSchedule, deleteCustomSchedules)
//   limits.ts     host meeting limits across all event types (getMeetingLimits, setMeetingLimits, countHostMeetings)
//   page-data.ts  the Schedules tab loader (loadSchedulesPage)
//
// The Troubleshoot view data (getTroubleshootDay) lives in @/lib/availability/troubleshoot and is not re-exported here:
// it calls booking-core, whose availability service imports this contract (no import cycle).
import "server-only";

export {
  DEFAULT_SCHEDULE_NAME,
  DEFAULT_WEEKLY_HOURS,
  ensureDefaultSchedule,
  getDefaultSchedule,
  loadScheduleInput,
  normalizeWeekly,
  type ScheduleRange,
  type ScheduleRow,
} from "./core";

export {
  cloneSchedule,
  copyName,
  createSchedule,
  CUSTOM_HOURS_CONFLICT_MESSAGE,
  deleteDateOverride,
  deleteSchedule,
  effectiveSchedules,
  getSchedule,
  getScheduleDetailById,
  listActiveOnEventTypes,
  listSchedules,
  loadOwnedSchedule,
  lockUserSchedules,
  renameSchedule,
  setDefaultSchedule,
  setScheduleEventTypes,
  updateScheduleTimezone,
  updateWeeklyHours,
  upsertDateOverrides,
  weeklyOf,
  writeOverrides,
  type ActiveOnEventType,
  type ScheduleDetail,
  type ScheduleSummary,
} from "./schedules";

export {
  assertValidContent,
  createCustomSchedule,
  CUSTOM_SCHEDULE_NAME,
  deleteCustomSchedules,
  getScheduleContent,
  resolveEventTypeSchedule,
  saveScheduleContent,
  setEventTypeSchedule,
  type EventTypeScheduleChoice,
  type EventTypeScheduleState,
  type ScheduleContent,
} from "./custom";

export { countHostMeetings, getMeetingLimits, periodBounds, setMeetingLimits, type HostMeetingCounts, type PeriodBounds } from "./limits";
export { loadSchedulesPage, type SchedulesPageData } from "./page-data";

export type { DateOverride, OverrideChange } from "./intervals";
export { MAX_OVERRIDES, MAX_SCHEDULES, MEETING_LIMIT_MAX, SCHEDULE_NAME_MAX, type LimitPeriod, type MeetingLimits } from "./schemas";
export { troubleshootHref } from "./links";
