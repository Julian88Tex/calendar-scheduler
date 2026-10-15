// OWNER: foundation-ui.
//
// TimeZoneSelect (dashboard picker) and TimeZoneButton (booking page trigger, SPEC BK-05) (ARCHITECTURE 20.2, GEN-06):
// friendly Calendly-style names from src/lib/time/zones.ts ("Eastern Time - US & Canada"), the current local time of
// every zone (refreshed each minute), the GEN-06 groups (US/CANADA, AMERICA, ... UTC) and search by name, city or IANA
// id. TimeZoneButton renders the "Time zone" label, a 13.5px navy grid globe + name + "(6:53pm)" + a 10x5.5 caret
// 6px after the text (a neutral 10% navy pill on hover and while open), and a 250px popup centered over the button
// and overlapping its top by 2px (docs/research/calendly-live-capture.md item 17) with search, a "TIME ZONE" row
// holding the "am/pm [switch] 24h" toggle (a "Time format" radio group for assistive technology; the knob has a
// #A6BBD1 ring) lined up with the times column, and the grouped list whose names wrap in a column of at most 119px
// (so "Mountain Time -" / "US & Canada" break where Calendly's do). Pass `names` (the zones i18n namespace) and
// `labels` for non-English invitee pages. Any valid IANA zone (including legacy aliases) stays selectable.
"use client";

import { Globe } from "lucide-react";
import { useId, useMemo } from "react";
import { GlobeIcon } from "./booking-icons";
import { cn } from "@/lib/cn";
import { currentLocalTime, friendlyZoneName, groupedZones } from "@/lib/time/zones";
import { Combobox, type ComboboxOption } from "./combobox";
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

/**
 * A booking picker row: the zone name wraps over two lines in a column of at most 119px (about Calendly's), the local
 * time stays on the right in navy.
 */
function PublicZoneRow({ option, hour12, locale, now }: { option: ZoneOption; hour12: boolean; locale: string; now: number | null }) {
  return (
    <span className="flex w-full min-w-0 items-center justify-between gap-3">
      <span className="min-w-0 max-w-[119px] break-words">{option.label}</span>
      {now !== null && <span className="shrink-0 text-[14px] font-normal text-ink">{currentLocalTime(option.zone, { hour12, locale, at: now })}</span>}
    </span>
  );
}

/**
 * Calendly's "am/pm [switch] 24h" control. The two words are the options of a "Time format" radio group (arrow keys
 * move between them) and the small track between them flips the choice; the knob sits left for am/pm, right for 24h.
 */
function HourFormatToggle({ hour12, onChange, labels }: { hour12: boolean; onChange: (hour12: boolean) => void; labels?: TimeZoneLabels }) {
  const option = (value: boolean, text: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={hour12 === value}
      tabIndex={hour12 === value ? 0 : -1}
      onClick={() => onChange(value)}
      onKeyDown={(e) => {
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
          e.preventDefault();
          onChange(!hour12);
          const group = e.currentTarget.parentElement;
          window.setTimeout(() => group?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus(), 0);
        }
      }}
      className="rounded-[4px] text-[12px] leading-4 text-ink"
    >
      {text}
    </button>
  );
  return (
    <div role="radiogroup" aria-label={labels?.timeFormat ?? "Time format"} className="flex items-center gap-1">
      {option(true, labels?.h12 ?? "am/pm")}
      <span
        aria-hidden="true"
        onClick={() => onChange(!hour12)}
        className="relative inline-flex h-3 w-8 shrink-0 cursor-pointer items-center rounded-full bg-mist"
      >
        <span
          className={cn(
            "absolute top-1/2 left-0 size-4 -translate-y-1/2 rounded-full border border-line-medium bg-white shadow-[0_1px_2px_rgba(10,37,64,0.2)] transition-transform duration-150",
            !hour12 && "translate-x-4",
          )}
        />
      </span>
      {option(false, labels?.h24 ?? "24h")}
    </div>
  );
}

export function TimeZoneButton({ value, onChange, hour12, onHour12Change, locale = "en", names, label = "Time zone", className, labels, disabled }: TimeZoneButtonProps) {
  const now = useMinuteClock();
  const options = useZoneOptions(value, locale, names);
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const name = friendlyZoneName(value, locale, names);
  const time = now !== null ? currentLocalTime(value, { hour12, locale, at: now }) : null;
  const headingId = `tz-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <div className={cn("flex min-w-0 flex-col items-start", className)}>
      {/* Weight 640: Figtree's bold carries more ink than Calendly's at this size. */}
      <span id={headingId} className="text-[14px] leading-5 font-[640] text-ink">
        {label}
      </span>
      <Combobox
        value={value}
        onChange={(v) => v && onChange(v)}
        options={options}
        disabled={disabled}
        variant="public"
        searchPlaceholder={labels?.search ?? "Search..."}
        emptyText={labels?.noResults ?? "No time zones found"}
        contentClassName="w-[250px]"
        align="center"
        side="top"
        sideOffset={-2}
        trigger={
          <button
            type="button"
            aria-haspopup="listbox"
            aria-labelledby={`${headingId} ${headingId}-value`}
            disabled={disabled}
            className="group mt-px inline-flex h-8 w-full max-w-full min-w-0 items-center gap-px rounded-full px-2.5 text-left text-[14px] leading-5 text-ink transition-colors duration-100 hover:bg-ink/10 data-[state=open]:bg-ink/10 disabled:cursor-not-allowed"
          >
            {/* A 13.5px globe half a pixel in from the pill padding, like Calendly's; the text keeps its place. */}
            <GlobeIcon className="ml-[0.5px] size-[13.5px] shrink-0 text-navy" radius={10.5} strokeWidth={2.2} />
            <span id={`${headingId}-value`} className="min-w-0 truncate">
              {name}
              {time && <span> ({time})</span>}
            </span>
            {/* Calendly's caret: 10x5.5, 6px after the text and 1px below the text's center. */}
            <svg
              aria-hidden="true"
              viewBox="0 0 20 11"
              className="ml-[6px] h-[5.5px] w-2.5 shrink-0 translate-y-px fill-navy transition-transform group-data-[state=open]:rotate-180"
            >
              <path d="M0 0h20L10 11z" />
            </svg>
          </button>
        }
        header={
          <div className="flex items-center justify-between gap-3 pt-[21px] pr-8 pb-2 pl-5">
            <span className="text-[12px] leading-4 font-bold text-ink uppercase">{label}</span>
            {onHour12Change && <HourFormatToggle hour12={hour12} onChange={onHour12Change} labels={labels} />}
          </div>
        }
        renderOption={(o) => <PublicZoneRow option={byValue.get(o.value) ?? { ...o, zone: o.value }} hour12={hour12} locale={locale} now={now} />}
      />
    </div>
  );
}
