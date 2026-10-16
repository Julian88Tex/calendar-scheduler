// OWNER: foundation-ui.
//
// MonthCalendar (ARCHITECTURE 20.2, SPEC BK-04, GEN-05, walkthrough 11.2): the booking calendar. Month header "October
// 2026" (14px bold) between 38px circular arrows 183px apart ("Go to previous month" / "Go to next month"; 8x14 blue
// chevrons with a #F4F8FF hover fill, #476788 when disabled, as on the owner's live page), weekday header in #476788
// 12px semibold, and 44px circle day buttons with 15px proportional figures (docs/research/calendly-live-capture.md):
// available days #E6F0FF fill with bold #004EBA text (stronger than Calendly's #F4F8FF and weight 460, which friends
// could not tell apart from unavailable days on phones and under a browser's automatic dark mode), unavailable days
// plain #476788 at regular weight and disabled, hover #D1E4FF (size "md": Figtree 545 / 640 carry the ink of the
// semibold weekdays and the bold month; on phones the day circles sit 1.25px right of the weekday labels, as
// captured), selected #006BFF fill with
// white text, today with a 4px dot 13px below the number and aria-current="date", and adjacent-month cells hidden.
// Every blue derives from --primary-color (branding, embed primary_color). The table is labelled "Select a Day"; day
// buttons read "Monday, October 12 - Times available" or "Sunday, October 4 - No times available"; a live region
// announces "October is now displayed" after a month change. Arrow keys move between enabled days (PageUp/PageDown
// change month). Single or multiple selection. Dates are local "YYYY-MM-DD" strings and months "YYYY-MM", so the
// component never does time zone math. Used by the booking page, date overrides and polls.
"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { addDays, dayLabel, monthGrid, monthLabel, monthName, monthOf, shiftMonth, weekdayNames } from "./month-calendar-utils";
import { Spinner } from "./spinner";

export type MonthCalendarLabels = {
  /** "Go to previous month" */
  previousMonth?: string;
  /** "Go to next month" */
  nextMonth?: string;
  /** Suffix for selectable days: "Times available" (an empty string drops the suffix). */
  available?: string;
  /** Suffix for disabled days: "No times available". */
  unavailable?: string;
  /** Live region text: (monthName) => "October is now displayed". */
  monthDisplayed?: (month: string) => string;
  /** Loading status text: "Loading". */
  loading?: string;
};

export type MonthCalendarProps = {
  /** Visible month "YYYY-MM". */
  month: string;
  onMonthChange: (month: string) => void;
  mode?: "single" | "multiple";
  /** Selected date(s) "YYYY-MM-DD". */
  selected?: string | string[] | null;
  onSelect?: (date: string) => void;
  /** Dates with availability (tinted, selectable). When omitted every non-disabled date is selectable. */
  availableDates?: readonly string[];
  isDisabled?: (date: string) => boolean;
  /** Today's local date (highlighted). */
  today?: string;
  weekStart?: 0 | 1;
  minMonth?: string;
  maxMonth?: string;
  locale?: string;
  loading?: boolean;
  className?: string;
  /** Accessible name of the grid (default "Select a Day"). */
  "aria-label"?: string;
  /** Localized UI strings (booking pages pass the invitee language). */
  labels?: MonthCalendarLabels;
  /** "md" (44px days, booking page) or "sm" (36px, date pickers and compact panels). */
  size?: "md" | "sm";
  /** Days of the visible month outside [min, max] dates are disabled (YYYY-MM-DD, inclusive). */
  minDate?: string;
  maxDate?: string;
  /** Highlight a continuous range (DateRangePicker). */
  range?: { start: string | null; end: string | null };
};

const DEFAULT_LABELS: Required<MonthCalendarLabels> = {
  previousMonth: "Go to previous month",
  nextMonth: "Go to next month",
  available: "Times available",
  unavailable: "No times available",
  monthDisplayed: (m) => `${m} is now displayed`,
  loading: "Loading",
};

export function MonthCalendar({
  month,
  onMonthChange,
  mode = "single",
  selected,
  onSelect,
  availableDates,
  isDisabled,
  today,
  weekStart = 0,
  minMonth,
  maxMonth,
  locale = "en",
  loading,
  className,
  labels: labelOverrides,
  size = "md",
  minDate,
  maxDate,
  range,
  ...aria
}: MonthCalendarProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const selectedSet = useMemo(() => new Set(selected == null ? [] : Array.isArray(selected) ? selected : [selected]), [selected]);
  const available = useMemo(() => (availableDates ? new Set(availableDates) : null), [availableDates]);
  const rows = useMemo(() => monthGrid(month, weekStart), [month, weekStart]);
  const weekdays = useMemo(() => weekdayNames(locale, weekStart), [locale, weekStart]);
  const title = monthLabel(month, locale);
  const prevDisabled = Boolean(minMonth && month <= minMonth);
  const nextDisabled = Boolean(maxMonth && month >= maxMonth);

  const isEnabled = (date: string) =>
    !loading &&
    (available ? available.has(date) : true) &&
    !isDisabled?.(date) &&
    !(minDate && date < minDate) &&
    !(maxDate && date > maxDate);

  const enabledDates = rows.flat().filter((d): d is string => d !== null && isEnabled(d));
  const firstSelectedInMonth = [...selectedSet].filter((d) => monthOf(d) === month && isEnabled(d)).sort()[0];
  const [focusDate, setFocusDate] = useState<string | null>(null);
  const tabStop =
    focusDate && monthOf(focusDate) === month && isEnabled(focusDate)
      ? focusDate
      : (firstSelectedInMonth ?? (today && monthOf(today) === month && isEnabled(today) ? today : enabledDates[0]));

  // Announce month changes (not the first render).
  const [announcement, setAnnouncement] = useState("");
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setAnnouncement(labels.monthDisplayed(monthName(month, locale)));
    // labels.monthDisplayed is a function prop; only the month and locale matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, locale]);

  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const target = pendingFocus.current;
    if (target && monthOf(target) === month) {
      buttons.current.get(target)?.focus();
      pendingFocus.current = null;
    }
  });

  const moveFocus = (from: string, step: number) => {
    let probe = from;
    for (let i = 0; i < 62; i++) {
      probe = addDays(probe, step);
      if (monthOf(probe) !== month) {
        // Leaving the month: switch months when allowed and focus the first enabled day there later.
        const nextMonth = monthOf(probe);
        if ((step > 0 && nextDisabled) || (step < 0 && prevDisabled)) return;
        if ((minMonth && nextMonth < minMonth) || (maxMonth && nextMonth > maxMonth)) return;
        pendingFocus.current = probe;
        setFocusDate(probe);
        onMonthChange(nextMonth);
        return;
      }
      if (isEnabled(probe)) {
        setFocusDate(probe);
        buttons.current.get(probe)?.focus();
        return;
      }
    }
  };

  // Booking size on phones: Calendly draws the day circles 1.25px right of the weekday labels.
  const circle = size === "md" ? "size-11 max-w-full text-[15px] tracking-normal max-[599px]:translate-x-[1.25px]" : "size-9 text-[14px]";
  const dot = size === "md" ? "top-[33px]" : "top-[27px]";
  // Available numbers are bold over regular unavailable ones, so open days read at a glance.
  const enabledWeight = "font-bold";
  const disabledWeight = "font-normal";
  // Phones (booking size): 48px rows and a tighter header, as captured at 390px.
  const rowHeight = size === "md" ? "h-[52px] max-[599px]:h-12" : "h-10";
  // Booking size: a 21px weekday row (label in its top 20px) on wider screens and 19px on phones (label 1px down in an
  // 18px line) puts the day rows where Calendly's sit under the header.
  const headHeight = size === "md" ? "h-[21px] pb-px max-[599px]:h-[19px] max-[599px]:pt-px max-[599px]:pb-0 max-[599px]:leading-[18px]" : "h-6";

  return (
    <div className={cn("relative flex min-w-0 flex-col", className)} aria-busy={loading || undefined}>
      <div
        className={cn(
          "grid items-center justify-center gap-3",
          // Booking size: a 121px title column puts the arrow centers 183px apart, as Calendly's are.
          size === "md" ? "mb-[18px] grid-cols-[38px_minmax(121px,auto)_38px] max-[599px]:mb-[14px]" : "mb-2 grid-cols-[38px_minmax(120px,auto)_38px]",
        )}
      >
        <button
          type="button"
          aria-label={labels.previousMonth}
          disabled={prevDisabled}
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          className={cn(
            "inline-flex size-[38px] items-center justify-center rounded-full transition-colors duration-100",
            prevDisabled ? "cursor-default text-ink-2" : "text-brand-strong hover:cal-day-hover",
          )}
        >
          <ChevronLeft aria-hidden="true" className={size === "md" ? "size-6" : "size-5"} strokeWidth={2.25} />
        </button>
        <span className={cn("text-center text-ink", size === "md" ? "text-[14px] leading-5 font-[640]" : "text-[14px] font-bold")}>
          <span className="relative inline-block">
            <span aria-hidden="true">{title}</span>
            {/* Beside the month name, not over the grid, where a ring on top of a date read as a marked day. */}
            {loading && <Spinner size="sm" label={labels.loading} className="absolute top-1/2 left-full ml-2 -translate-y-1/2" />}
          </span>
        </span>
        <button
          type="button"
          aria-label={labels.nextMonth}
          disabled={nextDisabled}
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          className={cn(
            "inline-flex size-[38px] items-center justify-center rounded-full transition-colors duration-100",
            nextDisabled ? "cursor-default text-ink-2" : "text-brand-strong hover:cal-day-hover",
          )}
        >
          <ChevronRight aria-hidden="true" className={size === "md" ? "size-6" : "size-5"} strokeWidth={2.25} />
        </button>
      </div>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <table
        aria-label={aria["aria-label"] ?? "Select a Day"}
        data-mode={mode}
        className="w-full table-fixed border-collapse"
      >
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr>
            {weekdays.map((w) => (
              <th
                key={w.long}
                scope="col"
                abbr={w.long}
                className={cn("p-0 text-center text-[12px] leading-5 text-ink-2", size === "md" ? "font-[545]" : "font-semibold", headHeight)}
              >
                {w.short}
              </th>
            ))}
          </tr>
        </thead>
        {/* Only the days dim while loading: they are disabled then, the weekday names stay readable. */}
        <tbody className={cn("transition-opacity duration-150", loading && "opacity-40")}>
          {rows.map((row, r) => (
            <tr key={r}>
              {row.map((date, c) => {
                if (!date) return <td key={`e-${r}-${c}`} aria-hidden="true" className={rowHeight} />;
                const enabled = isEnabled(date);
                const isSelected = selectedSet.has(date);
                const isToday = date === today;
                const inRange = Boolean(range?.start && range?.end && date > range.start && date < range.end);
                const suffix = enabled ? labels.available : labels.unavailable;
                return (
                  <td key={date} className={cn("p-0 text-center", rowHeight, inRange && "bg-brand-soft")}>
                    <button
                      ref={(el) => {
                        if (el) buttons.current.set(date, el);
                        else buttons.current.delete(date);
                      }}
                      type="button"
                      disabled={!enabled}
                      tabIndex={enabled ? (date === tabStop ? 0 : -1) : undefined}
                      aria-pressed={enabled ? isSelected : undefined}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={suffix ? `${dayLabel(date, locale)} - ${suffix}` : dayLabel(date, locale)}
                      onClick={() => {
                        setFocusDate(date);
                        onSelect?.(date);
                      }}
                      onFocus={() => setFocusDate(date)}
                      onKeyDown={(e) => {
                        const map: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
                        if (e.key in map) {
                          e.preventDefault();
                          moveFocus(date, map[e.key]!);
                        } else if (e.key === "PageUp" || e.key === "PageDown") {
                          e.preventDefault();
                          const dir = e.key === "PageUp" ? -1 : 1;
                          if ((dir < 0 && prevDisabled) || (dir > 0 && nextDisabled)) return;
                          onMonthChange(shiftMonth(month, dir));
                        } else if (e.key === "Home" || e.key === "End") {
                          e.preventDefault();
                          const target = e.key === "Home" ? enabledDates[0] : enabledDates[enabledDates.length - 1];
                          if (target) {
                            setFocusDate(target);
                            buttons.current.get(target)?.focus();
                          }
                        }
                      }}
                      className={cn(
                        "relative mx-auto inline-flex aspect-square items-center justify-center rounded-full leading-none transition-colors duration-100",
                        circle,
                        enabled
                          ? isSelected
                            ? cn("bg-brand text-white", enabledWeight)
                            : cn("cal-day-available hover:cal-day-available-hover", enabledWeight)
                          : cn("cursor-default text-ink-2", disabledWeight),
                        !enabled && isSelected && "bg-mist",
                      )}
                    >
                      {Number(date.slice(8))}
                      {isToday && <span aria-hidden="true" className={cn("absolute left-1/2 size-1 -translate-x-1/2 rounded-full bg-current", dot)} />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
