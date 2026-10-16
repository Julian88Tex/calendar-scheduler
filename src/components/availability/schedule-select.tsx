// ScheduleSelect (SPEC ET-19, AV-11, AV-12): the event type editor's "Schedule:" dropdown: the user's named schedules
// ("Working hours (default)", others) and, with allowCustom, "Custom schedule" (event-only hours). The value is a
// schedule id or CUSTOM_SCHEDULE_VALUE.
//
//   <ScheduleSelect schedules={[{ id, name, isDefault }]} value={scheduleId ?? CUSTOM_SCHEDULE_VALUE} onChange={...} allowCustom />
"use client";

import { Select, type SelectOption } from "@/components/ui/select";

/** The option value of "Custom schedule". */
export const CUSTOM_SCHEDULE_VALUE = "custom";

export type ScheduleOption = { id: string; name: string; isDefault: boolean };

export type ScheduleSelectProps = {
  schedules: ScheduleOption[];
  /** A schedule id, or CUSTOM_SCHEDULE_VALUE. */
  value: string;
  onChange: (value: string) => void;
  /** Offer "Custom schedule" (default true). */
  allowCustom?: boolean;
  /** Label of the custom option (default "Custom schedule"; per-host rows use "Custom hours for this event"). */
  customLabel?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

/** "Working hours (default)" for the default schedule, else the name. */
export function scheduleLabel(s: Pick<ScheduleOption, "name" | "isDefault">): string {
  return s.isDefault ? `${s.name} (default)` : s.name;
}

export function ScheduleSelect({
  schedules,
  value,
  onChange,
  allowCustom = true,
  customLabel = "Custom schedule",
  disabled,
  id,
  className,
  ...aria
}: ScheduleSelectProps) {
  const sorted = [...schedules].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const options: SelectOption[] = sorted.map((s) => ({ value: s.id, label: scheduleLabel(s), textValue: scheduleLabel(s) }));
  if (allowCustom) options.push({ value: CUSTOM_SCHEDULE_VALUE, label: customLabel, textValue: customLabel });
  return (
    <Select
      id={id}
      value={value}
      onValueChange={onChange}
      options={options}
      disabled={disabled}
      className={className}
      aria-label={aria["aria-label"] ?? "Schedule"}
      aria-describedby={aria["aria-describedby"]}
    />
  );
}
