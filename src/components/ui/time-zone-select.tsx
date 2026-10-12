// OWNER: foundation-ui.
//
// TimeZoneSelect (dashboard picker) and TimeZoneButton (booking page trigger, SPEC BK-05) (ARCHITECTURE 20.2, GEN-06):
// friendly Calendly-style names from src/lib/time/zones.ts ("Eastern Time - US & Canada"), the current local time of
// every zone (refreshed each minute), the GEN-06 groups (US/CANADA, AMERICA, ... UTC) and search by name, city or IANA
// id. TimeZoneButton renders the "Time zone" label, a globe + name + "(6:53pm)" + caret button, and a dropdown with
// search, the "am/pm | 24h" toggle and the grouped list. Pass `names` (the zones i18n namespace) and `labels` for
// non-English invitee pages. Any valid IANA zone (including legacy aliases) stays selectable.
"use client";

import { Globe } from "lucide-react";
import { useId, useMemo } from "react";
import { cn } from "@/lib/cn";
import { currentLocalTime, friendlyZoneName, groupedZones } from "@/lib/time/zones";
import { Combobox, type ComboboxOption } from "./combobox";
import { SegmentedControl } from "./segmented-control";
import { useMinuteClock } from "./use-minute-clock";

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
  size?: "md" | "lg";
  /** UI strings for invitee pages (defaults are English). */
  labels?: TimeZoneLabels;
};

export type TimeZoneLabels = {
  /** "Search..." */
  search?: string;
  /** "No time zones found" */
  noResults?: string;
  /** "am/pm" */
  h12?: string;
  /** "24h" */
  h24?: string;
  /** "Time format" (accessible name of the toggle) */
  timeFormat?: string;
};

type ZoneOption = ComboboxOption & { zone: string };

function useZoneOptions(value: string, locale: string, names?: Readonly<Record<string, string>>): ZoneOption[] {
  return useMemo(() => {
    const groups = groupedZones({ locale, names, extraZone: value });
    const out: ZoneOption[] = [];
    for (const g of groups) {
      for (const z of g.zones) {
        const city = z.id.split("/").pop()?.replace(/_/g, " ") ?? z.id;
        out.push({ value: z.id, zone: z.id, label: z.label, group: g.group, keywords: [z.id, city, z.name] });
      }
    }
    // The stored value may be an alias of a catalog entry (Asia/Kolkata for Asia/Calcutta): keep it selectable.
    if (value && !out.some((o) => o.value === value)) {
      const label = friendlyZoneName(value, locale, names);
      const entryIndex = out.findIndex((o) => o.label === label);
      if (entryIndex >= 0) out[entryIndex] = { ...out[entryIndex]!, value, zone: value };
    }
    return out;
  }, [value, locale, names]);
}

function ZoneRow({ option, hour12, locale, now, showTime }: { option: ZoneOption; hour12: boolean; locale: string; now: number | null; showTime: boolean }) {
  return (
    <span className="flex w-full min-w-0 items-center justify-between gap-3">
      <span className="min-w-0 truncate">{option.label}</span>
      {showTime && now !== null && (
        <span className="shrink-0 text-body-md font-normal text-ink-2 tabular-nums">{currentLocalTime(option.zone, { hour12, locale, at: now })}</span>
      )}
    </span>
  );
}

export function TimeZoneSelect({
  value,
  onChange,
  locale = "en",
  names,
  hour12 = true,
  showCurrentTime = true,
  disabled,
  id,
  className,
  size = "md",
  labels,
  ...aria
}: TimeZoneSelectProps) {
  const now = useMinuteClock();
  const options = useZoneOptions(value, locale, names);
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  return (
    <Combobox
      id={id}
      value={value}
      onChange={(v) => v && onChange(v)}
      options={options}
      disabled={disabled}
      size={size}
      className={className}
      aria-label={aria["aria-label"] ?? "Time zone"}
      aria-describedby={aria["aria-describedby"]}
      searchPlaceholder={labels?.search ?? "Search..."}
      emptyText={labels?.noResults ?? "No time zones found"}
      contentClassName="w-[min(420px,calc(100vw-16px))]"
      renderValue={(o) => {
        const label = o?.label ?? friendlyZoneName(value, locale, names);
        return (
          <span className="flex min-w-0 items-center gap-2">
            <Globe aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
            <span className="min-w-0 truncate">
              {label}
              {showCurrentTime && now !== null && <span className="text-ink-2"> ({currentLocalTime(value, { hour12, locale, at: now })})</span>}
            </span>
          </span>
        );
      }}
      renderOption={(o) => <ZoneRow option={byValue.get(o.value) ?? { ...o, zone: o.value }} hour12={hour12} locale={locale} now={now} showTime={showCurrentTime} />}
    />
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
  /** UI strings for invitee pages (defaults are English). */
  labels?: TimeZoneLabels;
  disabled?: boolean;
};

export function TimeZoneButton({ value, onChange, hour12, onHour12Change, locale = "en", names, label = "Time zone", className, labels, disabled }: TimeZoneButtonProps) {
  const now = useMinuteClock();
  const options = useZoneOptions(value, locale, names);
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const name = friendlyZoneName(value, locale, names);
  const time = now !== null ? currentLocalTime(value, { hour12, locale, at: now }) : null;
  const headingId = `tz-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span id={headingId} className="text-[14px] leading-5 font-bold text-ink">
        {label}
      </span>
      <Combobox
        value={value}
        onChange={(v) => v && onChange(v)}
        options={options}
        disabled={disabled}
        searchPlaceholder={labels?.search ?? "Search..."}
        emptyText={labels?.noResults ?? "No time zones found"}
        contentClassName="w-[min(400px,calc(100vw-16px))]"
        align="start"
        trigger={
          <button
            type="button"
            aria-haspopup="listbox"
            aria-labelledby={`${headingId} ${headingId}-value`}
            disabled={disabled}
            className="group inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-[var(--radius-input)] px-2.5 py-1.5 text-left text-[14px] leading-5 text-ink hover:bg-primary-soft data-[state=open]:bg-primary-soft disabled:cursor-not-allowed"
          >
            <Globe aria-hidden="true" className="size-4 shrink-0 text-ink" />
            <span id={`${headingId}-value`} className="min-w-0 truncate">
              {name}
              {time && <span> ({time})</span>}
            </span>
            <svg aria-hidden="true" viewBox="0 0 10 6" className="h-1.5 w-2.5 shrink-0 fill-navy transition-transform group-data-[state=open]:rotate-180">
              <path d="M0 0h10L5 6z" />
            </svg>
          </button>
        }
        header={
          onHour12Change ? (
            <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
              <span className="text-eyebrow text-ink-2">{labels?.timeFormat ?? "Time format"}</span>
              <SegmentedControl<"12h" | "24h">
                size="sm"
                aria-label={labels?.timeFormat ?? "Time format"}
                value={hour12 ? "12h" : "24h"}
                onValueChange={(v) => onHour12Change(v === "12h")}
                options={[
                  { value: "12h", label: labels?.h12 ?? "am/pm" },
                  { value: "24h", label: labels?.h24 ?? "24h" },
                ]}
              />
            </div>
          ) : undefined
        }
        renderOption={(o) => <ZoneRow option={byValue.get(o.value) ?? { ...o, zone: o.value }} hour12={hour12} locale={locale} now={now} showTime />}
      />
    </div>
  );
}
