// Limits and buffers section (SPEC ET-21, SCH-07, SCH-08, SCH-09; docs/SCOPE.md owner priority 2): buffers before and
// after the event, per event type meeting limits ("Max number of meetings [n] per [day | week | month]", one row per
// period) and the account-wide meeting limits from Availability > Advanced settings, linked so the owner can tune both
// in one place. Client component.
"use client";

import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { FIELD_BASE } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ADVANCED_SETTINGS_PATH } from "@/lib/availability/links";
import { cn } from "@/lib/cn";
import { BUFFER_MAX, BUFFER_PRESETS, LIMIT_MAX, LIMIT_MIN, MESSAGES } from "@/lib/event-types/constants";
import type { EventTypeDraft } from "@/lib/event-types/types";
import { wholeNumberIn } from "@/lib/event-types/draft";
import { errorOf, FieldGroup, MinutesSelect, type SectionProps } from "./fields";

type Period = "day" | "week" | "month";
const PERIODS: Period[] = ["day", "week", "month"];
const KEY: Record<Period, "limitPerDay" | "limitPerWeek" | "limitPerMonth"> = { day: "limitPerDay", week: "limitPerWeek", month: "limitPerMonth" };
const DEFAULT_LIMIT: Record<Period, number> = { day: 1, week: 5, month: 20 };

function activePeriods(d: EventTypeDraft): Period[] {
  return PERIODS.filter((p) => d[KEY[p]] !== null);
}

function LimitRow({
  period,
  value,
  others,
  onChange,
  onPeriod,
  onRemove,
  disabled,
  error,
}: {
  period: Period;
  value: number;
  others: Period[];
  onChange: (n: number) => void;
  onPeriod: (p: Period) => void;
  onRemove: () => void;
  disabled: boolean;
  error: string | null;
}) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (Number.isFinite(value) ? String(value) : "");
  const bad = text !== null && wholeNumberIn(text, LIMIT_MIN, LIMIT_MAX) === null;
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2 text-body-md text-ink">
        <label htmlFor={`${base}-n`}>Max number of meetings</label>
        <input
          id={`${base}-n`}
          type="number"
          inputMode="numeric"
          min={LIMIT_MIN}
          max={LIMIT_MAX}
          value={shown}
          disabled={disabled}
          aria-invalid={bad || error ? true : undefined}
          onChange={(e) => {
            setText(e.target.value);
            // Invalid input is kept in the draft as NaN so "Save changes" stops on this field (no silent old value).
            onChange(wholeNumberIn(e.target.value, LIMIT_MIN, LIMIT_MAX) ?? Number.NaN);
          }}
          onBlur={() => !bad && setText(null)}
          className={cn(FIELD_BASE, "h-10 w-20 px-3 text-[14px]", (bad || error) && "border-danger")}
        />
        <span>per</span>
        <NativeSelect
          aria-label="Period"
          value={period}
          disabled={disabled}
          options={PERIODS.filter((p) => p === period || !others.includes(p)).map((p) => ({ value: p, label: p }))}
          onChange={(e) => onPeriod(e.target.value as Period)}
          className="w-28"
        />
        <IconButton size="sm" aria-label={`Remove the ${period} limit`} disabled={disabled} onClick={onRemove}>
          <X aria-hidden="true" className="size-4" />
        </IconButton>
      </div>
      {(bad || error) && <FieldError error={bad ? MESSAGES.limit : error} />}
    </li>
  );
}

export function LimitsSection({
  draft,
  update,
  errors,
  disabled,
  hostLimits,
}: SectionProps & { hostLimits: { day: number | null; week: number | null; month: number | null } }) {
  const periods = activePeriods(draft);
  const free = PERIODS.filter((p) => !periods.includes(p));
  const host = PERIODS.filter((p) => hostLimits[p] !== null).map((p) => `${hostLimits[p]} per ${p}`);
  return (
    <div className="flex flex-col gap-7">
      <FieldGroup title="Buffer time" hint="Add time before or after booked events">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-body-sm font-semibold text-ink-2">Before event</span>
            <MinutesSelect
              value={draft.bufferBeforeMinutes}
              onChange={(bufferBeforeMinutes) => update({ bufferBeforeMinutes })}
              presets={BUFFER_PRESETS}
              min={0}
              max={BUFFER_MAX}
              disabled={disabled}
              invalid={Boolean(errorOf(errors, "bufferBeforeMinutes"))}
              aria-label="Before event"
            />
            {errorOf(errors, "bufferBeforeMinutes") && <FieldError error={errorOf(errors, "bufferBeforeMinutes")} />}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-body-sm font-semibold text-ink-2">After event</span>
            <MinutesSelect
              value={draft.bufferAfterMinutes}
              onChange={(bufferAfterMinutes) => update({ bufferAfterMinutes })}
              presets={BUFFER_PRESETS}
              min={0}
              max={BUFFER_MAX}
              disabled={disabled}
              invalid={Boolean(errorOf(errors, "bufferAfterMinutes"))}
              aria-label="After event"
            />
            {errorOf(errors, "bufferAfterMinutes") && <FieldError error={errorOf(errors, "bufferAfterMinutes")} />}
          </div>
        </div>
      </FieldGroup>

      <FieldGroup title="Meeting limits" hint="Limit how many meetings of this event type invitees can book.">
        {periods.length > 0 ? (
          <ul aria-label="Meeting limits" className="flex flex-col gap-2">
            {periods.map((p) => (
              <LimitRow
                key={p}
                period={p}
                value={draft[KEY[p]] ?? DEFAULT_LIMIT[p]}
                others={periods.filter((x) => x !== p)}
                disabled={disabled}
                error={errorOf(errors, KEY[p])}
                onChange={(n) => update({ [KEY[p]]: n } as Partial<EventTypeDraft>)}
                onPeriod={(next) => update({ [KEY[p]]: null, [KEY[next]]: draft[KEY[p]] } as Partial<EventTypeDraft>)}
                onRemove={() => update({ [KEY[p]]: null } as Partial<EventTypeDraft>)}
              />
            ))}
          </ul>
        ) : (
          <p className="text-body-md text-ink-2">No limit on the number of meetings.</p>
        )}
        {free.length > 0 && (
          <Button
            variant="tertiary"
            size="sm"
            disabled={disabled}
            leftIcon={<Plus aria-hidden="true" />}
            className="self-start"
            onClick={() => update({ [KEY[free[0]!]]: DEFAULT_LIMIT[free[0]!] } as Partial<EventTypeDraft>)}
          >
            Set limit
          </Button>
        )}
      </FieldGroup>

      <div className="flex flex-col gap-1 rounded-[var(--radius-card)] bg-pebble px-4 py-3">
        <p className="text-label text-ink">Meeting limits across all event types</p>
        <p className="text-body-md text-ink-2">
          {host.length ? `Max ${host.join(", ")}, whichever is reached first.` : "No account-wide limit. Set one to cap your meetings per day or week."}
        </p>
        <Link href={ADVANCED_SETTINGS_PATH} className="self-start text-body-md font-semibold text-primary-text hover:underline">
          {host.length ? "Edit in Availability" : "Set in Availability"}
        </Link>
      </div>
    </div>
  );
}
