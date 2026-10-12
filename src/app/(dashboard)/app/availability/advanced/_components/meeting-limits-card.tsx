// "Meeting limits" (SPEC AV-14, SCH-09; walkthrough 9.4): "+ Add a meeting limit" rows "Max number of meetings [n] per
// [day | week | month]" across all event types, saved automatically (valid edits debounced 600ms; failures revert and
// show "Couldn't save your changes. Try again."). Each row shows how many meetings the current period already has.
"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { LIMIT_PERIODS, limitRows, MEETING_LIMIT_MAX, rowsToLimits, type LimitPeriod, type MeetingLimits } from "@/lib/availability/schemas";
import { SAVE_FAILED, SaveIndicator, useSaveQueue } from "../../_components/save-status";
import { saveMeetingLimitsAction } from "../actions";

type Row = { key: number; period: LimitPeriod; text: string };

export type MeetingLimitsCardProps = {
  limits: MeetingLimits;
  /** Active meetings in the current day, week and month (host-level counting). */
  counts: { day: number; week: number; month: number } | null;
};

const PERIOD_LABEL: Record<LimitPeriod, string> = { day: "day", week: "week", month: "month" };
const CURRENT_LABEL: Record<LimitPeriod, string> = { day: "today", week: "this week", month: "this month" };
/** The value a new row starts with. */
const NEW_ROW_COUNT = 1;

let rowSeq = 0;
const newKey = () => ++rowSeq;
const toRows = (l: MeetingLimits): Row[] => limitRows(l).map((r) => ({ key: newKey(), period: r.period, text: String(r.count) }));

export function parseLimit(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= MEETING_LIMIT_MAX ? n : null;
}

export function MeetingLimitsCard({ limits, counts }: MeetingLimitsCardProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [rows, setRows] = useState<Row[]>(() => toRows(limits));
  const saved = useRef<MeetingLimits>(limits);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { state, run } = useSaveQueue();

  const valid = (list: Row[]) => list.every((r) => parseLimit(r.text) !== null);
  const limitsOf = (list: Row[]) => rowsToLimits(list.map((r) => ({ period: r.period, count: parseLimit(r.text) })));
  const same = (a: MeetingLimits, b: MeetingLimits) => a.day === b.day && a.week === b.week && a.month === b.month;

  const save = (list: Row[]) => {
    const value = limitsOf(list);
    if (same(value, saved.current)) return;
    void run(async () => {
      let res: Awaited<ReturnType<typeof saveMeetingLimitsAction>>;
      try {
        res = await saveMeetingLimitsAction(value);
      } catch {
        res = { ok: false, error: { code: "internal", message: SAVE_FAILED } };
      }
      if (res.ok) saved.current = res.data;
      else {
        setRows(toRows(saved.current));
        toast.error(SAVE_FAILED);
      }
      return res;
    });
  };

  const change = (list: Row[], immediate = false) => {
    setRows(list);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!valid(list)) return;
    if (immediate) save(list);
    else timer.current = setTimeout(() => save(list), 600);
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const used = new Set(rows.map((r) => r.period));
  const free = LIMIT_PERIODS.filter((p) => !used.has(p));

  return (
    <Card padding="none" aria-labelledby={`${base}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4 sm:p-6">
        <div className="min-w-0">
          <h2 id={`${base}-title`} className="text-title-md font-bold text-ink">
            Meeting limits
          </h2>
          <p className="mt-1 max-w-2xl text-body-md text-ink-2">
            Set a maximum number of meetings you can have across all event types. Meetings from every event type, meeting poll and one-off
            meeting count toward these limits; once a limit is reached, the remaining times of that period are hidden from your booking pages.
          </p>
        </div>
        <SaveIndicator state={state} />
      </div>
      <div className="flex flex-col gap-4 p-4 sm:p-6">
        {rows.length === 0 && <p className="text-body-md text-ink-2">You have no meeting limits. Invitees can book any open time.</p>}
        {rows.length > 0 && (
          <ul className="flex flex-col gap-4" aria-label="Meeting limits">
            {rows.map((row, i) => {
              const n = parseLimit(row.text);
              const errorId = `${base}-err-${row.key}`;
              const countId = `${base}-count-${row.key}`;
              const options = LIMIT_PERIODS.filter((p) => p === row.period || !used.has(p)).map((p) => ({ value: p, label: PERIOD_LABEL[p] }));
              return (
                <li key={row.key} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <label htmlFor={`${base}-n-${row.key}`} className="text-body-md text-ink">
                      Max number of meetings
                    </label>
                    <Input
                      id={`${base}-n-${row.key}`}
                      inputMode="numeric"
                      autoComplete="off"
                      value={row.text}
                      invalid={n === null}
                      aria-describedby={[n === null ? errorId : null, counts ? countId : null].filter(Boolean).join(" ") || undefined}
                      onChange={(e) => change(rows.map((r, k) => (k === i ? { ...r, text: e.target.value.replace(/[^\d]/g, "").slice(0, 3) } : r)))}
                      className="w-20 text-center"
                    />
                    <span className="text-body-md text-ink" aria-hidden="true">
                      per
                    </span>
                    <Select
                      aria-label="Period"
                      value={row.period}
                      onValueChange={(v) => change(rows.map((r, k) => (k === i ? { ...r, period: v as LimitPeriod } : r)), true)}
                      options={options}
                      className="w-32"
                    />
                    <IconButton aria-label={`Remove the limit per ${PERIOD_LABEL[row.period]}`} size="sm" onClick={() => change(rows.filter((_, k) => k !== i), true)}>
                      <Trash2 aria-hidden="true" />
                    </IconButton>
                  </div>
                  {n === null && (
                    <p id={errorId} role="alert" className="text-body-sm font-semibold text-danger-text">
                      Enter a number from 1 to 999.
                    </p>
                  )}
                  {counts && (
                    <p id={countId} className="text-body-sm text-ink-2">
                      {counts[row.period] === 1 ? "1 meeting" : `${counts[row.period]} meetings`} scheduled {CURRENT_LABEL[row.period]}
                      {n !== null && counts[row.period] >= n ? " (limit reached)" : ""}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div>
          <Button
            variant="tertiary"
            size="sm"
            leftIcon={<Plus aria-hidden="true" />}
            disabled={free.length === 0}
            onClick={() => change([...rows, { key: newKey(), period: free[0]!, text: String(NEW_ROW_COUNT) }], true)}
          >
            Add a meeting limit
          </Button>
        </div>
      </div>
    </Card>
  );
}
