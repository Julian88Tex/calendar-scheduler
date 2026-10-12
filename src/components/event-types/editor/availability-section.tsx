// Availability section (SPEC ET-19, SCH-02 to SCH-06, AV-11): the date range sentence with inline dropdowns
// ("Invitees can schedule [60 days] into the future with at least [4 hours] notice"), the "Schedule:" select (the
// owner's named schedules or "Custom schedule"), the selected schedule's weekly hours (read only, with a link to edit
// the schedule) or the editable custom hours, date-specific hours and the schedule time zone. Client component.
"use client";

import { ExternalLink } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useId, useState } from "react";
import { CUSTOM_SCHEDULE_VALUE, ScheduleHoursEditor, ScheduleSelect } from "@/components/availability";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { DateRangePicker } from "@/components/ui/date-picker";
import { FieldError } from "@/components/ui/form-field";
import { FIELD_BASE } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover } from "@/components/ui/popover";
import { RadioGroup } from "@/components/ui/radio-group";
import { cn } from "@/lib/cn";
import { dayOrder, formatDayIntervals, formatOverrideDate, WEEKDAY_SHORT, type ScheduleContent } from "@/lib/availability/intervals";
import { scheduleHref } from "@/lib/availability/links";
import { DATE_RANGE_DAYS_MAX, DATE_RANGE_DAYS_MIN, NOTICE_MAX_MINUTES } from "@/lib/event-types/constants";
import { noticeText, noticeUnitOf, rollingRangeText, scheduleContentOf } from "@/lib/event-types/draft";
import type { DateRangeDraft, EditorScheduleOption, ScheduleChoiceDraft } from "@/lib/event-types/types";
import { formatZoneLabel } from "@/lib/time/format";
import { errorOf, InlineDropdownButton, wholeNumberIn, type SectionProps } from "./fields";

type Props = SectionProps & {
  schedules: EditorScheduleOption[];
  hour12: boolean;
  weekStart: 0 | 1;
  today: string;
  /** False for team event types (each host's own schedule applies). */
  scheduleEditable: boolean;
};

function cloneContent(c: ScheduleContent): ScheduleContent {
  return {
    timezone: c.timezone,
    weeklyHours: c.weeklyHours.map((d) => d.map((r) => ({ start: r.start, end: r.end }))) as ScheduleContent["weeklyHours"],
    overrides: c.overrides.map((o) => ({ date: o.date, intervals: o.intervals.map((r) => ({ start: r.start, end: r.end })) })),
  };
}

function longDate(date: string | null): string {
  return date ? formatOverrideDate(date) : "a date";
}

function RangePopover({ value, onChange, disabled, today, error, weekStart }: { value: DateRangeDraft; onChange: (v: DateRangeDraft) => void; disabled: boolean; today: string; error: string | null; weekStart: 0 | 1 }) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [daysText, setDaysText] = useState<string | null>(null);
  const days = daysText ?? (Number.isFinite(value.days) ? String(value.days) : "");
  const daysBad = daysText !== null && wholeNumberIn(daysText, DATE_RANGE_DAYS_MIN, DATE_RANGE_DAYS_MAX) === null;
  // While the typed number is invalid the sentence shows what was typed (the draft holds NaN until it is fixed).
  const shownDays = Number.isFinite(value.days) ? value.days : Number(daysText) || 0;
  const label =
    value.type === "rolling"
      ? rollingRangeText(shownDays, value.mode)
      : value.type === "fixed"
        ? `between ${longDate(value.start)} and ${longDate(value.end)}`
        : "indefinitely";
  const modes = [
    { value: "calendar_days", label: "calendar days" },
    { value: "weekdays", label: "week days" },
    ...(value.mode === "available_days" ? [{ value: "available_days", label: "days with availability" }] : []),
  ];
  return (
    <Popover
      align="start"
      aria-label="Date range"
      className="w-[340px] p-4"
      trigger={
        <InlineDropdownButton disabled={disabled} aria-label={`Date range: ${label}`} className={cn((error || daysBad) && "text-danger-text")}>
          {label}
        </InlineDropdownButton>
      }
    >
      <div className="flex flex-col gap-4">
        <RadioGroup
          aria-label="Date range"
          value={value.type}
          disabled={disabled}
          onValueChange={(v) => {
            const type = v as DateRangeDraft["type"];
            if (type === "fixed" && !value.start) onChange({ ...value, type, start: today, end: null });
            else onChange({ ...value, type });
          }}
          options={[
            { value: "rolling", label: "Number of days into the future" },
            { value: "fixed", label: "Within a date range" },
            { value: "unlimited", label: "Indefinitely into the future" },
          ]}
        />
        {value.type === "rolling" && (
          <div className="flex flex-col gap-1.5 border-t border-line pt-4">
            <div className="flex items-center gap-2">
              <input
                id={`${base}-days`}
                type="number"
                inputMode="numeric"
                min={DATE_RANGE_DAYS_MIN}
                max={DATE_RANGE_DAYS_MAX}
                value={days}
                disabled={disabled}
                aria-label="Number of days"
                aria-invalid={daysBad ? true : undefined}
                onChange={(e) => {
                  setDaysText(e.target.value);
                  onChange({ ...value, days: wholeNumberIn(e.target.value, DATE_RANGE_DAYS_MIN, DATE_RANGE_DAYS_MAX) ?? Number.NaN });
                }}
                onBlur={() => !daysBad && setDaysText(null)}
                className={cn(FIELD_BASE, "h-10 w-24 px-3 text-[14px]", daysBad && "border-danger")}
              />
              <NativeSelect
                aria-label="Day type"
                value={value.mode}
                disabled={disabled}
                options={modes}
                onChange={(e) => onChange({ ...value, mode: e.target.value as DateRangeDraft["mode"] })}
                className="flex-1"
              />
            </div>
            {daysBad && <FieldError error={`Enter a number of days from ${DATE_RANGE_DAYS_MIN} to ${DATE_RANGE_DAYS_MAX.toLocaleString("en-US")}.`} />}
            <p className="text-body-sm text-ink-2">
              {value.mode === "weekdays" ? "Weekends are skipped when counting days." : "Counted from the current time, so the window rolls forward every day."}
            </p>
          </div>
        )}
        {value.type === "fixed" && (
          <div className="flex flex-col gap-1.5 border-t border-line pt-4">
            <DateRangePicker
              aria-label="Dates invitees can schedule"
              value={{ start: value.start, end: value.end }}
              min={today}
              weekStart={weekStart}
              disabled={disabled}
              onChange={(r) => onChange({ ...value, start: r.start, end: r.end })}
            />
            {error && <FieldError error={error} />}
          </div>
        )}
      </div>
    </Popover>
  );
}

/** Minutes of a typed notice amount in a unit of `factor` minutes, or null when invalid (SCH-06: 0 to 365 days). */
export function noticeMinutesOf(text: string, factor: number): number | null {
  if (!text.trim()) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  const minutes = Math.round(n * factor * 1e6) / 1e6;
  return Number.isInteger(minutes) && minutes <= NOTICE_MAX_MINUTES ? minutes : null;
}

function NoticePopover({ minutes, onChange, disabled, error }: { minutes: number; onChange: (m: number) => void; disabled: boolean; error: string | null }) {
  const [unit, setUnit] = useState(() => noticeUnitOf(minutes));
  const factor = unit === "days" ? 1440 : unit === "hours" ? 60 : 1;
  const [text, setText] = useState<string | null>(null);
  const amount = text ?? (Number.isFinite(minutes) ? String(Math.round((minutes / factor) * 100) / 100) : "");
  const bad = text !== null && noticeMinutesOf(text, factor) === null;
  // While the typed amount is invalid the sentence shows what was typed (the draft holds NaN until it is fixed).
  const label = Number.isFinite(minutes) ? noticeText(minutes) : `${text?.trim() || "0"} ${unit}`;
  return (
    <Popover
      align="start"
      aria-label="Minimum notice"
      className="w-[300px] p-4"
      trigger={
        <InlineDropdownButton disabled={disabled} aria-label={`Minimum notice: ${label}`} className={cn((error || bad) && "text-danger-text")}>
          {label}
        </InlineDropdownButton>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-label text-ink">Minimum scheduling notice</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={amount}
            disabled={disabled}
            aria-label="Notice amount"
            aria-invalid={bad ? true : undefined}
            onChange={(e) => {
              setText(e.target.value);
              onChange(noticeMinutesOf(e.target.value, factor) ?? Number.NaN);
            }}
            onBlur={() => !bad && setText(null)}
            className={cn(FIELD_BASE, "h-10 w-24 px-3 text-[14px]", bad && "border-danger")}
          />
          <NativeSelect
            aria-label="Notice unit"
            value={unit}
            disabled={disabled}
            options={[
              { value: "minutes", label: "minutes" },
              { value: "hours", label: "hours" },
              { value: "days", label: "days" },
            ]}
            onChange={(e) => {
              const next = e.target.value as typeof unit;
              const nextFactor = next === "days" ? 1440 : next === "hours" ? 60 : 1;
              setUnit(next);
              // The number stays and the unit changes ("4 hours" becomes "4 days"); an amount that is not valid in the
              // new unit stays visible with its error instead of being rounded or capped silently.
              const m = noticeMinutesOf(amount, nextFactor);
              setText(m === null ? amount : null);
              onChange(m ?? Number.NaN);
            }}
            className="flex-1"
          />
        </div>
        {bad && <FieldError error="Enter a notice of up to 365 days." />}
        <p className="text-body-sm text-ink-2">Invitees can&apos;t schedule within this much time of the start.</p>
      </div>
    </Popover>
  );
}

function WeeklyReadOnly({ content, hour12, weekStart, today }: { content: ScheduleContent; hour12: boolean; weekStart: 0 | 1; today: string }) {
  const upcoming = content.overrides.filter((o) => o.date >= today);
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Weekly hours" className="flex flex-col gap-1.5">
        {dayOrder(weekStart).map((d) => (
          <li key={d} className="flex gap-3 text-body-md">
            <span className="w-10 shrink-0 font-bold text-ink uppercase">{WEEKDAY_SHORT[d]}</span>
            <span className={cn("min-w-0", (content.weeklyHours[d] ?? []).length ? "text-ink" : "text-ink-2")}>{formatDayIntervals(content.weeklyHours[d] ?? [], hour12)}</span>
          </li>
        ))}
      </ul>
      {upcoming.length > 0 && (
        <p className="text-body-sm text-ink-2">
          {upcoming.length} upcoming date-specific {upcoming.length === 1 ? "change" : "changes"}
        </p>
      )}
      <p className="text-body-sm text-ink-2">{formatZoneLabel(content.timezone)}</p>
    </div>
  );
}

export function AvailabilitySection({ draft, update, errors, disabled, schedules, hour12, weekStart, today, scheduleEditable }: Props) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [pendingNamed, setPendingNamed] = useState<string | null>(null);
  const choice = draft.schedule;
  const content = scheduleContentOf(choice, schedules);
  const selectedId = choice.kind === "custom" ? CUSTOM_SCHEDULE_VALUE : (choice.scheduleId ?? schedules.find((s) => s.isDefault)?.id ?? "");
  const selectedNamed = choice.kind === "schedule" ? schedules.find((s) => s.id === selectedId) : undefined;
  const rangeError = errorOf(errors, "dateRange", true);
  const noticeError = errorOf(errors, "minimumNoticeMinutes");
  const scheduleError = errorOf(errors, "schedule", true);

  const choose = (value: string) => {
    if (value === CUSTOM_SCHEDULE_VALUE) {
      const from = content ?? schedules.find((s) => s.isDefault)?.content;
      if (!from) return;
      update({ schedule: { kind: "custom", content: cloneContent(from) } });
      return;
    }
    if (choice.kind === "custom") {
      setPendingNamed(value);
      return;
    }
    update({ schedule: { kind: "schedule", scheduleId: value } satisfies ScheduleChoiceDraft });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="text-body-md leading-7 text-ink">
          Invitees can schedule{" "}
          <RangePopover value={draft.dateRange} onChange={(dateRange) => update({ dateRange })} disabled={disabled} today={today} error={rangeError} weekStart={weekStart} />
          {draft.dateRange.type !== "fixed" && " into the future"} with at least{" "}
          <NoticePopover minutes={draft.minimumNoticeMinutes} onChange={(minimumNoticeMinutes) => update({ minimumNoticeMinutes })} disabled={disabled} error={noticeError} /> notice
        </p>
        {rangeError && <FieldError error={rangeError} />}
        {noticeError && <FieldError error={noticeError} />}
      </div>

      {scheduleEditable ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${base}-schedule`} className="text-label text-ink">
              Schedule:
            </label>
            <ScheduleSelect id={`${base}-schedule`} schedules={schedules} value={selectedId} onChange={choose} disabled={disabled} aria-label="Schedule" />
          </div>
          {choice.kind === "custom" ? (
            <div className="flex flex-col gap-2">
              <p className="text-body-sm text-ink-2">These hours apply to this event type only.</p>
              <ScheduleHoursEditor
                value={choice.content}
                onChange={(next) => update({ schedule: { kind: "custom", content: next } })}
                timeFormat={hour12 ? "12h" : "24h"}
                weekStart={weekStart}
                disabled={disabled}
                today={today}
                stacked
              />
            </div>
          ) : content ? (
            <div className="flex flex-col gap-3">
              <WeeklyReadOnly content={content} hour12={hour12} weekStart={weekStart} today={today} />
              {selectedNamed && (
                <Link
                  href={scheduleHref(selectedNamed.id) as Route}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 self-start text-body-md font-semibold text-primary-text hover:underline"
                >
                  Edit {selectedNamed.name}
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                  <span className="sr-only">(opens in a new tab)</span>
                </Link>
              )}
              <p className="text-body-sm text-ink-2">Changes to a schedule apply to every event type that uses it.</p>
            </div>
          ) : (
            <p className="text-body-md text-ink-2">No schedule yet. Create one on the Availability page.</p>
          )}
          {scheduleError && <FieldError error={scheduleError} />}
        </div>
      ) : (
        <p className="text-body-md text-ink-2">Each host&apos;s own schedule applies to this event type.</p>
      )}

      <ConfirmDialog
        open={pendingNamed !== null}
        onOpenChange={(v) => !v && setPendingNamed(null)}
        title="Use a named schedule?"
        description="The custom hours of this event type will be deleted when you save your changes."
        confirmLabel="Switch schedule"
        onConfirm={() => {
          if (pendingNamed) update({ schedule: { kind: "schedule", scheduleId: pendingNamed } });
          setPendingNamed(null);
        }}
      />
    </div>
  );
}
