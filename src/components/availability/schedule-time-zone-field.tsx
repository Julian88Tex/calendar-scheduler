// The schedule "Time zone" dropdown (SPEC AV-08, GEN-06): searchable, the local time next to every zone, and the travel
// hint under it. Hours are wall-clock times in this zone, so changing it keeps 9 to 5 as 9 to 5 in the new zone.
"use client";

import { useId } from "react";
import { TimeZoneSelect } from "@/components/ui/time-zone-select";
import { cn } from "@/lib/cn";

export const TRAVEL_HINT = "Traveling? Add date-specific hours in the local time of your trip.";

export type ScheduleTimeZoneFieldProps = {
  value: string;
  onChange: (zone: string) => void;
  hour12?: boolean;
  disabled?: boolean;
  className?: string;
};

export function ScheduleTimeZoneField({ value, onChange, hour12 = true, disabled, className }: ScheduleTimeZoneFieldProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={`${id}-tz`} className="text-label text-ink">
        Time zone
      </label>
      <TimeZoneSelect
        id={`${id}-tz`}
        value={value}
        onChange={onChange}
        hour12={hour12}
        disabled={disabled}
        aria-label="Time zone"
        aria-describedby={`${id}-hint`}
        className="w-full max-w-[420px]"
      />
      <p id={`${id}-hint`} className="text-body-sm text-ink-2">
        {TRAVEL_HINT}
      </p>
    </div>
  );
}
