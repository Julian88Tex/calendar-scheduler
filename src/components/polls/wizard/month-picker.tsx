// Month view of the poll creation calendar (SPEC MP-02 "Month view: select dates then add start times and a duration,
// or all-day (date-only) options"; research B3.1 Doodle month view). Dates are picked on a month calendar, start
// times typed or picked (any minute), and "Add {n} times" adds every date x start time with the current duration; with
// "All day" it adds date-only options that show the same day for everyone. Client component.
"use client";

import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { IconButton } from "@/components/ui/icon-button";
import { MonthCalendar } from "@/components/ui/month-calendar";
import { TimeInput } from "@/components/ui/time-input";
import { OPTION_HORIZON_DAYS } from "@/lib/polls/constants";
import { dayStart, instantsForWallTime, localDate } from "@/lib/polls/grid";
import { formatDateShort } from "@/lib/time/format";
import { addDays } from "@/lib/time/luxon";
import { allDay, timed, type DraftOption } from "../lib/options";
import { pt } from "../lib/t";

export type MonthPickerProps = {
  zone: string;
  hour12: boolean;
  now: number;
  weekStart: 0 | 1;
  /** Minutes, or null for all day. */
  durationMinutes: number | null;
  onAdd: (options: DraftOption[]) => void;
  locked: string | null;
};

/** Options for every date x start minute (nonexistent DST times skipped, past ones dropped). */
export function monthOptions(dates: readonly string[], starts: readonly number[], durationMinutes: number | null, zone: string, now: number): DraftOption[] {
  const out: DraftOption[] = [];
  for (const d of [...dates].sort()) {
    if (durationMinutes === null) {
      if (dayStart(d, zone) > now) out.push(allDay(d));
      continue;
    }
    for (const m of [...new Set(starts)].sort((a, b) => a - b)) {
      const at = instantsForWallTime(d, m, zone)[0];
      if (at === undefined || at <= now) continue;
      out.push(timed(at, at + durationMinutes * 60_000));
    }
  }
  return out;
}

export function MonthPicker(p: MonthPickerProps) {
  const today = localDate(p.now, p.zone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [dates, setDates] = useState<string[]>([]);
  const [starts, setStarts] = useState<(number | null)[]>([9 * 60]);
  const maxDate = addDays(today, OPTION_HORIZON_DAYS);
  const validStarts = starts.filter((s): s is number => s !== null);
  const preview = useMemo(() => monthOptions(dates, validStarts, p.durationMinutes, p.zone, p.now), [dates, validStarts, p.durationMinutes, p.zone, p.now]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4 md:flex-row md:p-6" data-testid="month-picker">
      <div className="w-full max-w-[360px] shrink-0">
        <p className="mb-3 text-body-md text-ink-2">{pt("wizard.monthHint")}</p>
        <MonthCalendar
          month={month}
          onMonthChange={setMonth}
          mode="multiple"
          selected={dates}
          onSelect={(d) => setDates((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]))}
          today={today}
          weekStart={p.weekStart}
          minMonth={today.slice(0, 7)}
          maxMonth={maxDate.slice(0, 7)}
          minDate={p.durationMinutes === null ? addDays(today, 1) : today}
          maxDate={maxDate}
          size="sm"
          aria-label={pt("wizard.monthDates")}
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <section aria-labelledby="month-dates">
          <h3 id="month-dates" className="text-label text-ink">
            {pt("wizard.monthDates")}
          </h3>
          {dates.length === 0 ? (
            <p className="mt-1 text-body-md text-ink-2">{pt("wizard.monthNoDates")}</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {[...dates].sort().map((d) => (
                <Chip key={d} onRemove={() => setDates((l) => l.filter((x) => x !== d))} removeLabel={`${pt("common.remove")} ${formatDateShort(`${d}T12:00:00Z`, "UTC")}`}>
                  {formatDateShort(`${d}T12:00:00Z`, "UTC")}
                </Chip>
              ))}
            </div>
          )}
        </section>
        {p.durationMinutes === null ? (
          <p className="text-body-md text-ink-2">{pt("wizard.monthAllDayHint")}</p>
        ) : (
          <section aria-labelledby="month-starts" className="flex flex-col gap-2">
            <h3 id="month-starts" className="text-label text-ink">
              {pt("wizard.monthStartTimes")}
            </h3>
            {starts.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <TimeInput value={s} onChange={(v) => setStarts((l) => l.map((x, j) => (j === i ? v : x)))} stepMinutes={15} hour12={p.hour12} aria-label={`${pt("wizard.addTimeStart")} ${i + 1}`} className="w-[160px]" />
                {starts.length > 1 && (
                  <IconButton aria-label={pt("common.remove")} size="sm" onClick={() => setStarts((l) => l.filter((_, j) => j !== i))}>
                    <X aria-hidden="true" />
                  </IconButton>
                )}
              </div>
            ))}
            <div>
              <Button variant="tertiary" size="sm" leftIcon={<Plus aria-hidden="true" className="size-4" />} onClick={() => setStarts((l) => [...l, null])} disabled={starts.length >= 12}>
                {pt("wizard.monthAddStart")}
              </Button>
            </div>
          </section>
        )}
        <div>
          <Button
            onClick={() => {
              p.onAdd(preview);
              setDates([]);
            }}
            disabled={preview.length === 0 || Boolean(p.locked)}
            data-testid="month-add"
          >
            {preview.length === 1 ? pt("wizard.monthAddOne") : pt("wizard.monthAdd", { count: preview.length })}
          </Button>
        </div>
      </div>
    </div>
  );
}
