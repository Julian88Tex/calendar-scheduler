// Small dialogs of the poll creation calendar (SPEC MP-02; research B3.1): "Add time" (date, start time and the current
// duration; the primary input on phones and a keyboard friendly alternative to the grid) and "Copy this day's times
// to..." (pick the target dates on a month calendar; times keep their local clock time across DST changes). Client
// components.
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FormField } from "@/components/ui/form-field";
import { MonthCalendar } from "@/components/ui/month-calendar";
import { TimeInput } from "@/components/ui/time-input";
import { OPTION_HORIZON_DAYS } from "@/lib/polls/constants";
import { copyDayTimes, dayStart, instantsForWallTime, localDate } from "@/lib/polls/grid";
import { formatDateMedium, formatDuration } from "@/lib/time/format";
import { addDays } from "@/lib/time/luxon";
import { allDay, timed, type DraftOption } from "../lib/options";
import { pt } from "../lib/t";

export function AddTimeDialog({
  open,
  onOpenChange,
  zone,
  hour12,
  now,
  weekStart,
  durationMinutes,
  initialDate,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  zone: string;
  hour12: boolean;
  now: number;
  weekStart: 0 | 1;
  durationMinutes: number | null;
  initialDate: string;
  onAdd: (o: DraftOption) => void;
}) {
  const today = localDate(now, zone);
  const [date, setDate] = useState<string | null>(initialDate >= today ? initialDate : today);
  const [minutes, setMinutes] = useState<number | null>(9 * 60);
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    setError(null);
    if (!date) {
      setError(pt("wizard.addTimeDate"));
      return;
    }
    if (durationMinutes === null) {
      if (dayStart(date, zone) <= now) {
        setError(pt("wizard.pastTime"));
        return;
      }
      onAdd(allDay(date));
      onOpenChange(false);
      return;
    }
    if (minutes === null) {
      setError(pt("wizard.addTimeStart"));
      return;
    }
    const at = instantsForWallTime(date, minutes, zone)[0];
    if (at === undefined) {
      setError(pt("wizard.nonexistent"));
      return;
    }
    if (at <= now) {
      setError(pt("wizard.pastTime"));
      return;
    }
    onAdd(timed(at, at + durationMinutes * 60_000));
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={pt("wizard.addTimeTitle")}
      description={durationMinutes === null ? pt("common.allDay") : `${pt("wizard.duration")}: ${formatDuration(durationMinutes)}`}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {pt("common.cancel")}
          </Button>
          <Button onClick={add} data-testid="add-time-submit">
            {pt("wizard.addTimeSubmit")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label={pt("wizard.addTimeDate")} required>
          {(control) => <DatePicker id={control.id} value={date} onChange={setDate} min={today} max={addDays(today, OPTION_HORIZON_DAYS)} weekStart={weekStart} />}
        </FormField>
        {durationMinutes !== null && (
          <FormField label={pt("wizard.addTimeStart")} required>
            {(control) => <TimeInput id={control.id} value={minutes} onChange={setMinutes} stepMinutes={15} hour12={hour12} />}
          </FormField>
        )}
        <FieldError error={error} />
      </div>
    </Dialog>
  );
}

export function CopyDayDialog({
  open,
  onOpenChange,
  zone,
  now,
  weekStart,
  fromDate,
  options,
  onCopy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  zone: string;
  now: number;
  weekStart: 0 | 1;
  fromDate: string;
  options: DraftOption[];
  onCopy: (list: DraftOption[]) => void;
}) {
  const today = localDate(now, zone);
  const [month, setMonth] = useState(fromDate.slice(0, 7));
  const [dates, setDates] = useState<string[]>([]);
  const dayOptions = options.filter((o): o is DraftOption & { kind: "timed" } => o.kind === "timed" && localDate(o.start, zone) === fromDate);
  const apply = () => {
    const copies = copyDayTimes(
      dayOptions.map((o) => ({ start: new Date(o.start).toISOString(), end: new Date(o.end).toISOString() })),
      fromDate,
      dates,
      zone,
    )
      .map((c) => timed(new Date(c.start).getTime(), new Date(c.end).getTime()))
      .filter((o) => o.kind === "timed" && o.start > now);
    onCopy(copies);
    onOpenChange(false);
  };
  const dayName = formatDateMedium(`${fromDate}T12:00:00Z`, "UTC");
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={pt("wizard.copyDayTitle", { day: dayName })}
      description={dayOptions.length ? pt("wizard.copyDayBody") : pt("wizard.copyDayNone")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {pt("common.cancel")}
          </Button>
          <Button onClick={apply} disabled={!dates.length || !dayOptions.length}>
            {pt("wizard.copyDayApply")}
          </Button>
        </>
      }
    >
      {dayOptions.length > 0 && (
        <MonthCalendar
          month={month}
          onMonthChange={setMonth}
          mode="multiple"
          selected={dates}
          onSelect={(d) => setDates((l) => (l.includes(d) ? l.filter((x) => x !== d) : [...l, d]))}
          isDisabled={(d) => d === fromDate}
          today={today}
          minDate={today}
          maxDate={addDays(today, OPTION_HORIZON_DAYS)}
          minMonth={today.slice(0, 7)}
          weekStart={weekStart}
          size="sm"
          aria-label={pt("wizard.copyDayTitle", { day: dayName })}
        />
      )}
    </Dialog>
  );
}
