// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// TimeZoneSelect (dashboard picker: friendly names, current local time, GEN-06 groups, search) and TimeZoneButton
// (booking page style trigger with the am/pm and 24h toggle) (ARCHITECTURE 20.2). Uses src/lib/time/zones.ts; pass
// `names` (the zones i18n namespace) for non-English invitee pages.
"use client";

import { cn } from "@/lib/cn";
import { currentLocalTime, friendlyZoneName, groupedZones } from "@/lib/time/zones";

export type TimeZoneSelectProps = {
  value: string;
  onChange: (zone: string) => void;
  locale?: string;
  /** Localized zone names (zones i18n namespace). */
  names?: Readonly<Record<string, string>>;
  hour12?: boolean;
  /** Show the current local time next to each zone (default true). */
  showCurrentTime?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** Default "Time zone". */
  "aria-label"?: string;
  "aria-describedby"?: string;
};

export function TimeZoneSelect({ value, onChange, locale = "en", names, hour12 = true, showCurrentTime = true, disabled, id, className, ...aria }: TimeZoneSelectProps) {
  const groups = groupedZones({ locale, names, extraZone: value });
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      aria-label={aria["aria-label"] ?? "Time zone"}
      aria-describedby={aria["aria-describedby"]}
      onChange={(e) => onChange(e.target.value)}
      className={cn("h-10 w-full rounded-[var(--radius-input)] border border-line bg-white px-3 text-body-md", className)}
    >
      {groups.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.zones.map((z) => (
            <option key={z.id} value={z.id}>
              {showCurrentTime ? `${z.label} (${currentLocalTime(z.id, { hour12, locale })})` : z.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

export type TimeZoneButtonProps = {
  value: string;
  onChange: (zone: string) => void;
  hour12: boolean;
  onHour12Change?: (hour12: boolean) => void;
  locale?: string;
  names?: Readonly<Record<string, string>>;
  /** Heading above the button (default "Time zone"). */
  label?: string;
  className?: string;
};

export function TimeZoneButton({ value, onChange, hour12, onHour12Change, locale = "en", names, label = "Time zone", className }: TimeZoneButtonProps) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-label">{label}</span>
      <span className="text-body-md">
        {friendlyZoneName(value, locale, names)} ({currentLocalTime(value, { hour12, locale })})
      </span>
      <TimeZoneSelect value={value} onChange={onChange} locale={locale} names={names} hour12={hour12} aria-label={label} />
      {onHour12Change && (
        <span className="flex gap-2 text-body-sm">
          <button type="button" aria-pressed={hour12} onClick={() => onHour12Change(true)}>
            am/pm
          </button>
          <button type="button" aria-pressed={!hour12} onClick={() => onHour12Change(false)}>
            24h
          </button>
        </span>
      )}
    </div>
  );
}
