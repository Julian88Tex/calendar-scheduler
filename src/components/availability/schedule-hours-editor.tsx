// ScheduleHoursEditor (SPEC AV-03, AV-06, AV-08, ET-19): weekly hours, date-specific hours and the schedule time zone
// in one controlled component, laid out like the Schedules page list view (two columns from 1024px, one column on
// phones). For the event type editor's "Custom schedule" (AV-11) and per-host custom hours (AV-12); it follows the
// caller's save model (persist with setEventTypeSchedule from @/lib/availability/custom on "Save changes").
//
//   <ScheduleHoursEditor value={{ timezone, weeklyHours, overrides }} onChange={setContent} timeFormat="12h" />
"use client";

import { useMemo } from "react";
import { todayIn } from "@/components/ui/month-calendar-utils";
import { cn } from "@/lib/cn";
import { nowMs } from "@/lib/time/now";
import type { ScheduleContent } from "@/lib/availability/intervals";
import { DateOverridesEditor } from "./date-overrides-editor";
import { ScheduleTimeZoneField } from "./schedule-time-zone-field";
import { WeeklyHoursEditor } from "./weekly-hours-editor";

export type ScheduleHoursEditorProps = {
  value: ScheduleContent;
  onChange: (next: ScheduleContent) => void;
  timeFormat?: "12h" | "24h";
  weekStart?: 0 | 1;
  disabled?: boolean;
  /** Stack the columns even on wide screens (narrow side panels such as the event type editor). */
  stacked?: boolean;
  /** Today in the schedule's zone (default: computed in the browser). Pass it from the server to avoid a hydration gap. */
  today?: string;
  className?: string;
};

export function ScheduleHoursEditor({ value, onChange, timeFormat = "12h", weekStart = 0, disabled, stacked, today: todayProp, className }: ScheduleHoursEditorProps) {
  const computed = useMemo(() => todayIn(value.timezone, nowMs()), [value.timezone]);
  const today = todayProp ?? computed;
  return (
    <div className={cn("flex min-w-0 flex-col gap-8", className)}>
      <div className={cn("grid min-w-0 gap-8", !stacked && "lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10")}>
        <WeeklyHoursEditor
          value={value.weeklyHours}
          onChange={(weeklyHours) => onChange({ ...value, weeklyHours })}
          timeFormat={timeFormat}
          weekStart={weekStart}
          disabled={disabled}
        />
        <DateOverridesEditor
          value={value.overrides}
          onChange={(overrides) => onChange({ ...value, overrides })}
          today={today}
          timeFormat={timeFormat}
          weekStart={weekStart}
          disabled={disabled}
        />
      </div>
      <ScheduleTimeZoneField value={value.timezone} onChange={(timezone) => onChange({ ...value, timezone })} hour12={timeFormat !== "24h"} disabled={disabled} />
    </div>
  );
}
