// Availability components (SPEC AV-03 to AV-08, ET-19), exported for the event type editor and other modules. Client
// components; their props are documented in each file:
//   WeeklyHoursEditor({ value: WeeklyHours, onChange, timeFormat?, weekStart?, disabled?, showHeading? })
//   DateOverridesEditor({ value: DateOverride[], onChange(next, change), today, timeFormat?, weekStart?, disabled? })
//   DateOverridesModal({ open, onOpenChange, today, initialDates?, initialIntervals?, onApply(dates, intervals) })
//   ScheduleSelect({ schedules: { id, name, isDefault }[], value: id | CUSTOM_SCHEDULE_VALUE, onChange, allowCustom? })
//   ScheduleHoursEditor({ value: { timezone, weeklyHours, overrides }, onChange, timeFormat?, weekStart?, stacked? })
//   ScheduleTimeZoneField({ value, onChange, hour12? })
//   IntervalList({ value: MinuteRange[], onChange, label, hour12?, firstRowActions? })
// Validation and formatting helpers: @/lib/availability/intervals (weeklyIsValid, dayIsValid, weeklySummary, ...).
export { CopyTimesPopover, type CopyTimesPopoverProps } from "./copy-times-popover";
export { DateOverridesEditor, type DateOverridesEditorProps } from "./date-overrides-editor";
export { DateOverridesModal, type DateOverridesModalProps } from "./date-overrides-modal";
export { IntervalList, type IntervalListProps } from "./interval-list";
export { ScheduleHoursEditor, type ScheduleHoursEditorProps } from "./schedule-hours-editor";
export { CUSTOM_SCHEDULE_VALUE, ScheduleSelect, scheduleLabel, type ScheduleOption, type ScheduleSelectProps } from "./schedule-select";
export { ScheduleTimeZoneField, TRAVEL_HINT, type ScheduleTimeZoneFieldProps } from "./schedule-time-zone-field";
export { WeeklyHoursEditor, type WeeklyHoursEditorProps } from "./weekly-hours-editor";
