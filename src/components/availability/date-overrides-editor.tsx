// DateOverridesEditor (SPEC AV-06; walkthrough 9.2): the "Date-specific hours" column. Header "Date-specific hours"
// (subtitle "Adjust hours for specific days") with "+ Hours"; the list of upcoming overrides sorted by date ("Thu, Oct
// 22, 2026" with "10:00am - 2:00pm" or "Unavailable") with edit (pencil) and delete (trash) on hover or focus; past
// overrides behind "Show past dates". "+ Hours" and the pencil open the date picker modal (DateOverridesModal).
//
// Controlled: `value` is every override of the schedule; `onChange(next, change)` receives the new list and the change
// (upsert of dates with their hours, or delete of one date) so auto-saving pages can persist just the change. A
// rejected promise from onChange keeps the modal open (the caller reports the error).
//
//   <DateOverridesEditor value={overrides} onChange={(next) => setOverrides(next)} today="2026-10-12" />
"use client";

import { CalendarDays, Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type { MinuteRange } from "@/db/types";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/cn";
import {
  applyOverrideChange,
  formatInterval,
  formatOverrideDate,
  partitionOverrides,
  sortIntervals,
  type DateOverride,
  type OverrideChange,
} from "@/lib/availability/intervals";
import { MAX_OVERRIDES } from "@/lib/availability/schemas";
import { DateOverridesModal } from "./date-overrides-modal";

export type DateOverridesEditorProps = {
  value: DateOverride[];
  onChange: (next: DateOverride[], change: OverrideChange) => void | Promise<void>;
  /** Today in the schedule's zone ("YYYY-MM-DD"). */
  today: string;
  timeFormat?: "12h" | "24h";
  weekStart?: 0 | 1;
  disabled?: boolean;
  /** Show the heading and subtitle (default true). */
  showHeading?: boolean;
  className?: string;
};

type ModalState = { dates: string[]; intervals: MinuteRange[] | undefined } | null;

export function DateOverridesEditor({ value, onChange, today, timeFormat = "12h", weekStart = 0, disabled, showHeading = true, className }: DateOverridesEditorProps) {
  const hour12 = timeFormat !== "24h";
  const headingId = `${useId().replace(/[^a-zA-Z0-9_-]/g, "")}-date-hours`;
  const [modal, setModal] = useState<ModalState>(null);
  const [showPast, setShowPast] = useState(false);
  const { upcoming, past } = partitionOverrides(value, today);
  const atLimit = value.length >= MAX_OVERRIDES;

  const emit = (change: OverrideChange) => onChange(applyOverrideChange(value, change), change);

  const addButton = (
    <Button
      variant="secondary"
      size="sm"
      leftIcon={<Plus aria-hidden="true" />}
      disabled={disabled || atLimit}
      onClick={() => setModal({ dates: [], intervals: undefined })}
    >
      Hours
    </Button>
  );

  return (
    <section className={cn("min-w-0", className)} aria-label={showHeading ? undefined : "Date-specific hours"} aria-labelledby={showHeading ? headingId : undefined}>
      {showHeading ? (
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={headingId} className="flex items-center gap-2 text-title-sm font-bold text-ink">
              <CalendarDays aria-hidden="true" className="size-4 text-ink-2" />
              Date-specific hours
            </h2>
            <p className="mt-0.5 text-body-md text-ink-2">Adjust hours for specific days</p>
          </div>
          {addButton}
        </header>
      ) : (
        <div className="mb-3 flex justify-end">{addButton}</div>
      )}
      {atLimit && <p className="mb-3 text-body-sm text-ink-2">You can add up to 1,000 date-specific hours to a schedule.</p>}
      {upcoming.length === 0 && (
        <p className="rounded-[var(--radius-card)] border border-dashed border-line px-4 py-3 text-body-md text-ink-2">
          Add dates when your availability changes from your weekly hours.
        </p>
      )}
      {upcoming.length > 0 && <OverrideList items={upcoming} hour12={hour12} disabled={disabled} onEdit={(o) => setModal({ dates: [o.date], intervals: o.intervals })} onDelete={(o) => emit({ type: "delete", date: o.date })} />}
      {past.length > 0 && (
        <div className="mt-4">
          <Button variant="tertiary" size="sm" aria-expanded={showPast} onClick={() => setShowPast((v) => !v)}>
            {showPast ? "Hide past dates" : "Show past dates"}
          </Button>
          {showPast && (
            <OverrideList
              className="mt-2 opacity-80"
              items={past}
              hour12={hour12}
              disabled={disabled}
              onDelete={(o) => emit({ type: "delete", date: o.date })}
            />
          )}
        </div>
      )}
      <DateOverridesModal
        open={modal !== null}
        onOpenChange={(open) => !open && setModal(null)}
        today={today}
        initialDates={modal?.dates}
        initialIntervals={modal?.intervals}
        weekStart={weekStart}
        hour12={hour12}
        onApply={(dates, intervals) => emit({ type: "upsert", dates, intervals: sortIntervals(intervals) })}
      />
    </section>
  );
}

function OverrideList({
  items,
  hour12,
  disabled,
  onEdit,
  onDelete,
  className,
}: {
  items: DateOverride[];
  hour12: boolean;
  disabled?: boolean;
  onEdit?: (o: DateOverride) => void;
  onDelete: (o: DateOverride) => void | Promise<void>;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-col divide-y divide-line rounded-[var(--radius-card)] border border-line", className)} aria-label="Date-specific hours">
      {items.map((o) => {
        const label = formatOverrideDate(o.date);
        return (
          <li key={o.date} className="group flex min-h-14 items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-body-md font-semibold text-ink">{label}</p>
              <p className={cn("text-body-md", o.intervals.length ? "text-ink" : "text-ink-2")}>
                {o.intervals.length
                  ? sortIntervals(o.intervals).map((r, i) => (
                      <span key={i} className="block">
                        {formatInterval(r, hour12)}
                      </span>
                    ))
                  : "Unavailable"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
              {onEdit && (
                <IconButton aria-label={`Edit ${label}`} size="sm" disabled={disabled} onClick={() => onEdit(o)}>
                  <Pencil aria-hidden="true" />
                </IconButton>
              )}
              <IconButton aria-label={`Delete ${label}`} size="sm" disabled={disabled} onClick={() => void onDelete(o)}>
                <Trash2 aria-hidden="true" />
              </IconButton>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
