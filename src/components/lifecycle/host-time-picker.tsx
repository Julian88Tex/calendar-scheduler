// The host's time picker of "Reschedule meeting now" (SPEC CR-07, OO-14, SCH-24): a compact month calendar with the
// event type's availability (the meeting being moved ignored) and the start times of the chosen date, shown in the
// host's zone with "Switch to your invitee's time zone" / "Switch to my time zone"; for single-host events,
// "Override available times" swaps the calendar for a free date and start time. Client component.
"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { FormField } from "@/components/ui/form-field";
import { MonthCalendar } from "@/components/ui/month-calendar";
import { dayLabel, monthName, shiftMonth } from "@/components/ui/month-calendar-utils";
import { Spinner } from "@/components/ui/spinner";
import { TimeInput } from "@/components/ui/time-input";
import { cn } from "@/lib/cn";
import { formatMeetingWhen, formatTime, isoDateInZone } from "@/lib/time/format";
import { friendlyZoneName } from "@/lib/time/zones";
import { hostRescheduleSlotsAction, type HostSlotsResult } from "./actions";
import { lt } from "./lib/t";
import type { HostMeetingInvitee, HostMeetingSummary } from "./types";

const LOCALE = "en-US";

export type HostPick =
  | { kind: "slot"; start: string; zone: string }
  | { kind: "override"; date: string | null; minutes: number | null; zone: string };

export type HostTimePickerProps = {
  meeting: HostMeetingSummary;
  invitee: HostMeetingInvitee;
  /** Single-host events only (OO-14). */
  allowOverride: boolean;
  /** Business clock (ms). */
  now: number;
  value: HostPick | null;
  onChange: (pick: HostPick | null) => void;
  /** Bumped by the dialog after a taken time: reload the slots. */
  reloadKey?: number;
};

/** "9:00am" / "09:00" for minutes from midnight. */
export function minutesLabel(minutes: number, hour12: boolean): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!hour12) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

/** The pick as text for the "New time" line, or null when incomplete. */
export function pickText(pick: HostPick | null, meeting: Pick<HostMeetingSummary, "durationMinutes" | "hour12">): string | null {
  if (!pick) return null;
  if (pick.kind === "slot") {
    const end = new Date(Date.parse(pick.start) + meeting.durationMinutes * 60_000).toISOString();
    return formatMeetingWhen(pick.start, end, pick.zone, LOCALE, meeting.hour12);
  }
  if (!pick.date || pick.minutes === null) return null;
  return `${minutesLabel(pick.minutes, meeting.hour12)}, ${dayLabel(pick.date, LOCALE)}`;
}

type Loaded = { status: "error"; message: string } | { status: "ready"; data: HostSlotsResult };

export function HostTimePicker({ meeting, invitee, allowOverride, now, value, onChange, reloadKey = 0 }: HostTimePickerProps) {
  const hostZone = meeting.timeZone;
  const inviteeZone = invitee.timezone && invitee.timezone !== hostZone ? invitee.timezone : null;
  const [useInviteeZone, setUseInviteeZone] = useState(false);
  const zone = useInviteeZone && inviteeZone ? inviteeZone : hostZone;
  // The clock is unknown (0) while hydrating: the month follows "today" until the host picks one.
  const clockKnown = now > 0;
  const today = isoDateInZone(now, zone);
  const [monthChoice, setMonth] = useState<string | null>(null);
  const month = monthChoice && monthChoice >= today.slice(0, 7) ? monthChoice : today.slice(0, 7);
  const [date, setDate] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Loaded>>({});
  const [retry, setRetry] = useState(0);
  const loadedKeys = useRef(new Set<string>());
  const override = value?.kind === "override";
  const key = `${month}|${zone}|${reloadKey}|${retry}`;
  const loaded = results[key];

  useEffect(() => {
    if (override || !clockKnown || loadedKeys.current.has(key)) return;
    loadedKeys.current.add(key);
    hostRescheduleSlotsAction({ inviteeId: invitee.id, month, zone })
      .then((r) => setResults((prev) => ({ ...prev, [key]: r.ok ? { status: "ready", data: r.data } : { status: "error", message: r.error.message } })))
      .catch(() => setResults((prev) => ({ ...prev, [key]: { status: "error", message: lt("host.reschedule.loadError") } })));
  }, [key, override, clockKnown, invitee.id, month, zone]);

  const data = loaded?.status === "ready" ? loaded.data : null;
  const availableDates = data
    ? Object.entries(data.days)
        .filter(([d, list]) => d.startsWith(`${month}-`) && list.length > 0)
        .map(([d]) => d)
        .sort()
    : [];
  const maxMonth = shiftMonth(today.slice(0, 7), 24);
  // "View next month" only while the booking window reaches into it (like the booking page, BK-04).
  const nextMonth = shiftMonth(month, 1);
  const nextAllowed = month < maxMonth && (!data?.windowEnd || Date.parse(data.windowEnd) > Date.parse(`${nextMonth}-01T00:00:00Z`) - 14 * 3_600_000);
  const effectiveDate = date && availableDates.includes(date) ? date : null;
  const daySlots = effectiveDate && data ? (data.days[effectiveDate] ?? []) : [];
  const selectedStart = value?.kind === "slot" && value.zone === zone ? value.start : null;

  const switchZone = () => {
    setUseInviteeZone((v) => !v);
    setDate(null);
    if (value?.kind === "slot") onChange(null);
    else if (value?.kind === "override") onChange({ ...value, zone: useInviteeZone || !inviteeZone ? hostZone : inviteeZone });
  };

  return (
    <div className="flex flex-col gap-4" data-testid="host-time-picker">
      <div className="flex flex-col gap-1">
        <p className="text-body-md text-ink-2" aria-live="polite">
          {lt("host.reschedule.showingZone", { zone: friendlyZoneName(zone) })}
        </p>
        {inviteeZone && (
          <button type="button" onClick={switchZone} className="self-start text-[14px] font-semibold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            {useInviteeZone ? lt("host.reschedule.myZone") : lt("host.reschedule.inviteeZone")}
          </button>
        )}
      </div>

      {!clockKnown ? (
        <div className="flex h-24 items-center justify-center">
          <Spinner />
        </div>
      ) : override ? (
        <div className="grid gap-4 min-[520px]:grid-cols-2">
          <FormField label={lt("host.reschedule.overrideDate")}>
            {(c) => (
              <DatePicker
                id={c.id}
                aria-describedby={c["aria-describedby"]}
                value={value.date}
                min={today}
                onChange={(d) => onChange({ ...value, date: d })}
                className="sm:w-full"
              />
            )}
          </FormField>
          <FormField label={lt("host.reschedule.overrideTime")}>
            {(c) => (
              <TimeInput
                id={c.id}
                aria-describedby={c["aria-describedby"]}
                value={value.minutes}
                stepMinutes={5}
                max={1435}
                hour12={meeting.hour12}
                onChange={(m) => onChange({ ...value, minutes: m })}
              />
            )}
          </FormField>
        </div>
      ) : (
        <div className="flex flex-col gap-4 min-[620px]:flex-row min-[620px]:items-start">
          <div className="relative min-w-0 min-[620px]:w-[300px] min-[620px]:shrink-0">
            <MonthCalendar
              size="sm"
              month={month}
              onMonthChange={(m) => {
                setMonth(m);
                setDate(null);
              }}
              selected={effectiveDate}
              onSelect={(d) => setDate(d)}
              availableDates={availableDates}
              today={today}
              minMonth={today.slice(0, 7)}
              maxMonth={maxMonth}
              locale={LOCALE}
              loading={!loaded}
              aria-label={lt("host.reschedule.selectDate")}
            />
            {loaded?.status === "ready" && availableDates.length === 0 && (
              <div role="status" className="mt-2 flex flex-col items-center gap-2 text-center">
                <p className="text-[14px] font-semibold text-ink">{lt("host.reschedule.noTimesInMonth", { month: monthName(month, LOCALE) })}</p>
                {nextAllowed && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setMonth(nextMonth);
                      setDate(null);
                    }}
                  >
                    {lt("host.reschedule.viewNextMonth")}
                  </Button>
                )}
              </div>
            )}
            {loaded?.status === "error" && (
              <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-[14px] text-danger-text">
                <span>{loaded.message}</span>
                <Button type="button" variant="secondary" size="sm" onClick={() => setRetry((n) => n + 1)}>
                  {lt("host.reschedule.retry")}
                </Button>
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            {effectiveDate ? (
              <div className="flex flex-col gap-2">
                <p className="text-[14px] font-bold text-ink">{dayLabel(effectiveDate, LOCALE)}</p>
                <ul aria-label={lt("host.reschedule.selectTime")} className="grid max-h-[280px] grid-cols-2 gap-2 overflow-y-auto pr-1 min-[620px]:grid-cols-1">
                  {daySlots.map((s) => {
                    const on = selectedStart === s.start;
                    return (
                      <li key={s.start}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => onChange({ kind: "slot", start: s.start, zone })}
                          className={cn(
                            "flex h-11 w-full items-center justify-center rounded-[4px] border text-[15px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                            on ? "border-primary bg-primary text-white" : "border-primary text-primary-text hover:border-2",
                          )}
                        >
                          {formatTime(s.start, zone, LOCALE, meeting.hour12)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : !loaded ? (
              <div className="flex h-24 items-center justify-center">
                <Spinner />
              </div>
            ) : (
              <p className="text-body-md text-ink-2">{lt("host.reschedule.noDate")}</p>
            )}
          </div>
        </div>
      )}

      {allowOverride && (
        <Checkbox
          label={lt("host.reschedule.override")}
          description={lt("host.reschedule.overrideHint")}
          checked={override}
          onCheckedChange={(on) => onChange(on ? { kind: "override", date: effectiveDate, minutes: null, zone } : null)}
        />
      )}
    </div>
  );
}
