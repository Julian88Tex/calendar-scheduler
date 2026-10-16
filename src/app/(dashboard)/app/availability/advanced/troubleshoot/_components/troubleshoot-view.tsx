// Troubleshoot view (docs/SCOPE.md priority 4; SPEC SCH-21, BK-24, Appendix B). Controls: event type ("All event
// types" or one), duration (when the event type offers several) and the date (previous / next day, a date picker,
// "Today"). Left: the day summary (time zone, the hours of each schedule that day, busy times with titles, host meeting
// limits with this period's counts). Right: one card per event type listing every candidate start: available ones in
// blue, unavailable ones with a dashed border, the reason chip (CALENDAR, BUFFER, TOO SOON, ... or OUTSIDE HOURS) and
// the exact reason; runs of identical outcomes collapse into one range row. A row opens the details sheet with the
// meaning, the fix and a link to the setting.
"use client";

import { ChevronLeft, ChevronRight, ChevronDown, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { ReasonChip, reasonChipLabel } from "@/components/availability/reason-chip";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { addDays } from "@/components/ui/month-calendar-utils";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { TroubleshootEntry } from "@/lib/booking/types";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/time/format";
import { friendlyZoneName } from "@/lib/time/zones";
import { formatInterval, formatLongDate } from "@/lib/availability/intervals";
import { ADVANCED_SETTINGS_PATH, scheduleHref, troubleshootHref } from "@/lib/availability/links";
import type { TroubleshootDay } from "@/lib/availability/types";
import {
  blockerTitle,
  blockerWhen,
  countViews,
  describeCandidate,
  groupRows,
  settingsSummary,
  type CandidateView,
  type DescribeContext,
  type ViewRow,
} from "@/lib/availability/troubleshoot-view";
import { CandidateSheet } from "./candidate-sheet";

type Filter = "all" | "available" | "unavailable";

export function TroubleshootView({ day }: { day: TroubleshootDay }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<{ view: CandidateView; entry: TroubleshootEntry } | null>(null);
  const selected = day.eventTypeId ? day.eventTypes.find((e) => e.id === day.eventTypeId) ?? null : null;

  const navigate = (patch: { date?: string; eventTypeId?: string | null; durationMinutes?: number | null }) => {
    const next = {
      date: patch.date ?? day.date,
      eventTypeId: patch.eventTypeId === undefined ? day.eventTypeId : patch.eventTypeId,
      durationMinutes: patch.durationMinutes === undefined ? day.durationMinutes : patch.durationMinutes,
    };
    startTransition(() => router.push(troubleshootHref({ ...next, date: next.date === day.today ? null : next.date })));
  };

  const eventTypeOptions = [
    { value: "all", label: "All event types" },
    ...day.eventTypes.map((e) => ({
      value: e.id,
      textValue: e.name,
      label: (
        <span className="inline-flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: e.color }} />
          <span className="truncate">{e.name}</span>
        </span>
      ),
    })),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={ADVANCED_SETTINGS_PATH as Route} className="inline-flex w-fit items-center gap-1 text-body-md font-semibold text-primary-text hover:underline">
          <ChevronLeft aria-hidden="true" className="size-4" />
          Advanced settings
        </Link>
        <h2 className="text-title-lg font-bold text-ink">Troubleshoot availability</h2>
        <p className="max-w-3xl text-body-md text-ink-2">
          See every start time of a day and why each unavailable one is blocked. Only you can see this page.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-card)] lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-label text-ink" id="ts-event-type">
              Event type
            </span>
            <Select
              aria-labelledby="ts-event-type"
              value={day.eventTypeId ?? "all"}
              onValueChange={(v) => navigate({ eventTypeId: v === "all" ? null : v, durationMinutes: null })}
              options={eventTypeOptions}
              className="w-full sm:w-72"
              disabled={day.eventTypes.length === 0}
            />
          </div>
          {selected && selected.durationOptions.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-label text-ink" id="ts-duration">
                Duration
              </span>
              <Select
                aria-labelledby="ts-duration"
                value={String(day.durationMinutes ?? selected.durationMinutes)}
                onValueChange={(v) => navigate({ durationMinutes: Number(v) })}
                options={selected.durationOptions.map((m) => ({ value: String(m), label: formatDuration(m) }))}
                className="w-full sm:w-36"
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-label text-ink" id="ts-date">
              Date
            </span>
            <div className="flex min-w-0 items-center gap-1">
              <IconButton aria-label="Previous day" variant="secondary" size="md" onClick={() => navigate({ date: addDays(day.date, -1) })}>
                <ChevronLeft aria-hidden="true" />
              </IconButton>
              <DatePicker
                aria-label="Date"
                value={day.date}
                onChange={(d) => d && navigate({ date: d })}
                weekStart={day.weekStart}
                className="min-w-0 flex-1 sm:w-48 sm:flex-none"
              />
              <IconButton aria-label="Next day" variant="secondary" size="md" onClick={() => navigate({ date: addDays(day.date, 1) })}>
                <ChevronRight aria-hidden="true" />
              </IconButton>
              {day.date !== day.today && (
                <Button variant="tertiary" size="sm" onClick={() => navigate({ date: day.today })}>
                  Today
                </Button>
              )}
            </div>
          </div>
        </div>
        <SegmentedControl
          aria-label="Show"
          size="sm"
          value={filter}
          onValueChange={setFilter}
          options={[
            { value: "all", label: "All times" },
            { value: "available", label: "Available" },
            { value: "unavailable", label: "Unavailable" },
          ]}
        />
      </div>

      <div className="flex items-center gap-2" aria-live="polite">
        <h3 className="text-title-md font-bold text-ink">{formatLongDate(day.date)}</h3>
        {pending && <Spinner size="sm" label="Loading" />}
      </div>

      <div className={cn("grid min-w-0 gap-6 transition-opacity lg:grid-cols-[320px_minmax(0,1fr)]", pending && "pointer-events-none opacity-60")} aria-busy={pending || undefined}>
        <DaySummary day={day} />
        <div className="flex min-w-0 flex-col gap-6">
          {day.error && (
            <Banner variant="error" title="We couldn't troubleshoot this date">
              {day.error}
            </Banner>
          )}
          {day.eventTypes.length === 0 && (
            <Card>
              <EmptyState
                heading="You don't have any event types yet."
                body="Create an event type to see which times invitees can book."
                action={
                  <Button asChild>
                    <Link href="/app/scheduling">Go to Scheduling</Link>
                  </Button>
                }
              />
            </Card>
          )}
          {day.result?.calendar.status === "nocal" && (
            <Banner variant="warning" title="Your calendar can't be checked">
              Reconnect your calendar so busy times are respected. Until then, these times are shown as unavailable.
            </Banner>
          )}
          {day.result?.entries.map((entry) => (
            <EntryCard key={entry.eventType.id} entry={entry} day={day} filter={filter} onOpen={(view) => setOpen({ view, entry })} />
          ))}
        </div>
      </div>

      {open && (
        <CandidateSheet
          view={open.view}
          entry={open.entry}
          day={day}
          onOpenChange={(v) => !v && setOpen(null)}
        />
      )}
    </div>
  );
}

function contextFor(entry: TroubleshootEntry, day: TroubleshootDay): DescribeContext {
  const scheduleId = entry.eventType.scheduleId;
  const hours = scheduleId ? day.scheduleHours[scheduleId] : undefined;
  return {
    zone: day.zone,
    hour12: day.hour12,
    eventTypeName: entry.eventType.name,
    durationMinutes: entry.eventType.durationMinutes,
    settings: entry.eventType.settings,
    hostLimits: day.result?.hostLimits ?? day.hostLimits,
    scheduleName: hours?.custom ? null : (entry.eventType.scheduleName ?? hours?.name ?? null),
    customSchedule: hours?.custom ?? false,
  };
}

function DaySummary({ day }: { day: TroubleshootDay }) {
  const schedules = Object.values(day.scheduleHours);
  const busy = day.result?.busy ?? [];
  const limits = (["day", "week", "month"] as const).filter((p) => day.hostLimits[p]);
  const periodWord = { day: "Per day", week: "Per week", month: "Per month" } as const;
  const currentWord = { day: "on this date", week: "this week", month: "this month" } as const;
  return (
    <Card padding="none" className="h-fit">
      <section className="border-b border-line p-4" aria-labelledby="ts-zone">
        <h4 id="ts-zone" className="text-eyebrow text-ink-2">
          Time zone
        </h4>
        <p className="mt-1 text-body-md text-ink">{friendlyZoneName(day.zone)}</p>
      </section>
      <section className="border-b border-line p-4" aria-labelledby="ts-hours">
        <h4 id="ts-hours" className="text-eyebrow text-ink-2">
          Hours on this date
        </h4>
        {schedules.length === 0 ? (
          <p className="mt-1 text-body-md text-ink-2">No schedule</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-3">
            {schedules.map((s) => (
              <li key={s.scheduleId} className="flex flex-col gap-0.5">
                <span className="text-body-md font-semibold text-ink">{s.name}</span>
                <span className={cn("text-body-md", s.intervals.length && s.source !== "holiday" ? "text-ink" : "text-ink-2")}>
                  {s.source === "holiday" ? "Holiday (unavailable)" : s.intervals.length ? s.intervals.map((r) => formatInterval(r, day.hour12)).join(", ") : "Unavailable"}
                </span>
                <span className="text-body-sm text-ink-2">
                  {s.source === "override" ? "Date-specific hours" : s.source === "holiday" ? "Marked as a holiday" : "Weekly hours"}
                  {(!s.custom || s.eventTypeId) && (
                    <>
                      {" · "}
                      <Link
                        href={s.custom && s.eventTypeId ? (`/app/event-types/${s.eventTypeId}` as Route) : scheduleHref(s.scheduleId)}
                        aria-label={`Edit ${s.name}`}
                        className="font-semibold text-primary-text hover:underline"
                      >
                        Edit
                      </Link>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="border-b border-line p-4" aria-labelledby="ts-busy">
        <h4 id="ts-busy" className="text-eyebrow text-ink-2">
          Busy times
        </h4>
        {busy.length === 0 ? (
          <p className="mt-1 text-body-md text-ink-2">No calendar events or meetings on this date.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2.5">
            {busy.map((b, i) => {
              return (
                <li key={`${b.start}-${b.end}-${i}`} className="flex flex-col gap-0.5">
                  <span className="text-body-md font-semibold break-words text-ink">{blockerTitle(b)}</span>
                  <span className="text-body-sm text-ink-2">
                    {blockerWhen(b, day)}
                    {" · "}
                    {b.source === "calendar" ? "Calendar event" : b.source === "reserved" ? "Held" : "Meeting"}
                    {b.core && (b.core.start !== b.start || b.core.end !== b.end) ? " (with buffers)" : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section className="p-4" aria-labelledby="ts-limits">
        <h4 id="ts-limits" className="text-eyebrow text-ink-2">
          Meeting limits
        </h4>
        {limits.length === 0 ? (
          <p className="mt-1 text-body-md text-ink-2">
            No limits across event types.{" "}
            <Link href={ADVANCED_SETTINGS_PATH as Route} className="font-semibold text-primary-text hover:underline">
              Add a meeting limit
            </Link>
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {limits.map((p) => {
              const n = day.hostLimits[p]!;
              const c = day.hostCounts?.[p];
              const reached = c !== undefined && c >= n;
              return (
                <li key={p} className="flex flex-wrap items-center gap-2 text-body-md text-ink">
                  <span className="font-semibold">{periodWord[p]}:</span>
                  <span>{c !== undefined ? `${c} of ${n} ${n === 1 ? "meeting" : "meetings"} ${currentWord[p]}` : `max ${n}`}</span>
                  {reached && <Badge variant="warning" size="sm">Reached</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Card>
  );
}

function EntryCard({ entry, day, filter, onOpen }: { entry: TroubleshootEntry; day: TroubleshootDay; filter: Filter; onOpen: (v: CandidateView) => void }) {
  const ctx = useMemo(() => contextFor(entry, day), [entry, day]);
  const views = useMemo(() => entry.candidates.map((c) => describeCandidate(c, ctx)), [entry, ctx]);
  const visible = useMemo(
    () => views.filter((v) => (filter === "all" ? true : filter === "available" ? v.status === "available" : v.status !== "available")),
    [views, filter],
  );
  const rows = useMemo(() => groupRows(visible), [visible]);
  const counts = countViews(views);
  const et = entry.eventType;
  const dateBeyond = entry.windowEnd !== null && views.length === 0;

  return (
    <Card padding="none" aria-labelledby={`ts-et-${et.id}`}>
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="mt-1 size-4 shrink-0 rounded-full" style={{ backgroundColor: et.color }} />
          <div className="min-w-0">
            <h4 id={`ts-et-${et.id}`} className="text-title-sm font-bold break-words text-ink">
              {et.name}
              {!et.active && (
                <Badge variant="neutral" size="sm" className="ml-2 align-middle">
                  Off
                </Badge>
              )}
            </h4>
            <p className="mt-0.5 text-body-sm text-ink-2">{settingsSummary(et.settings, et.durationMinutes).join(" · ")}</p>
            <p className="mt-1 text-body-sm text-ink-2">
              Schedule: {et.scheduleName ?? "Custom hours"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Badge variant="success">{counts.available} available</Badge>
          <Badge variant="outline">{counts.unavailable} unavailable</Badge>
          <Button asChild variant="tertiary" size="sm" rightIcon={<ExternalLink aria-hidden="true" />}>
            <Link href={`/app/event-types/${et.id}`}>Edit event type</Link>
          </Button>
        </div>
      </div>
      {!et.active && (
        <p className="border-b border-line bg-pebble px-4 py-3 text-body-md text-ink sm:px-5">
          This event type is turned off, so invitees can&apos;t book it at any time. Turn it on from{" "}
          <Link href="/app/scheduling" className="font-semibold text-primary-text hover:underline">
            Scheduling
          </Link>
          .
        </p>
      )}
      <div className="p-2 sm:p-3">
        {views.length === 0 ? (
          <p className="px-2 py-4 text-body-md text-ink-2">
            {dateBeyond ? "No start times on this date: it is outside the event type's date range." : "No start times on this date."}
          </p>
        ) : rows.length === 0 ? (
          <p className="px-2 py-4 text-body-md text-ink-2">{filter === "available" ? "No available times on this date." : "Every start time on this date is available."}</p>
        ) : (
          <ul className="flex flex-col" aria-label={`${et.name} start times`}>
            {rows.map((row) => (
              <Row key={row.key} row={row} onOpen={onOpen} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function StatusChip({ view }: { view: Pick<CandidateView, "status" | "chip" | "tone"> }) {
  if (view.status === "available") return <Badge variant="success" size="sm">{view.chip}</Badge>;
  if (view.status === "outside_hours") return <ReasonChip tone="outside">{view.chip}</ReasonChip>;
  return <ReasonChip>{reasonChipLabel(view.status)}</ReasonChip>;
}

function TimePill({ view }: { view: CandidateView }) {
  return (
    <span
      className={cn(
        "inline-flex h-9 w-[92px] shrink-0 items-center justify-center rounded-[var(--radius-slot)] border text-body-md font-bold tabular-nums",
        view.status === "available" ? "border-primary text-primary-text" : "border-dashed border-ink-3 text-ink-2",
      )}
    >
      {view.timeLabel}
    </span>
  );
}

function Row({ row, onOpen }: { row: ViewRow; onOpen: (v: CandidateView) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (row.kind === "candidate") return <CandidateRow view={row.view} onOpen={onOpen} />;
  return (
    <li className="flex flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-[6px] px-2 py-2 text-left hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
      >
        <span className="inline-flex h-9 min-w-[92px] shrink-0 items-center justify-center rounded-[var(--radius-slot)] border border-dashed border-ink-3 px-2 text-body-sm font-bold text-ink-2 tabular-nums">
          {row.first.timeLabel} to {row.last.timeLabel}
        </span>
        <StatusChip view={row} />
        <span className="min-w-[min(100%,14rem)] flex-1 text-body-md break-words text-ink">
          <ReasonText reasons={row.reasons} />
          <span className="text-ink-2"> ({row.items.length} start times)</span>
        </span>
        <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-ink-2 transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <ul className="ml-4 border-l border-line pl-2" aria-label={`${row.first.timeLabel} to ${row.last.timeLabel}`}>
          {row.items.map((v) => (
            <CandidateRow key={v.key} view={v} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Every reason of a row: the primary one, then the others in secondary text. */
function ReasonText({ reasons }: { reasons: readonly string[] }) {
  const [primary, ...rest] = reasons;
  return (
    <>
      {primary}
      {rest.length > 0 && <span className="text-ink-2"> {rest.join(" ")}</span>}
    </>
  );
}

function CandidateRow({ view, onOpen }: { view: CandidateView; onOpen: (v: CandidateView) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(view)}
        aria-label={`${view.timeLabel}, ${view.status === "available" ? "available." : `unavailable: ${view.reasons.join(" ")}`} Show details`}
        className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-[6px] px-2 py-2 text-left hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
      >
        <TimePill view={view} />
        <StatusChip view={view} />
        <span className="min-w-[min(100%,14rem)] flex-1 text-body-md break-words text-ink">
          {view.status === "available" ? <span className="text-ink-2">Invitees can book this time.</span> : <ReasonText reasons={view.reasons} />}
        </span>
      </button>
    </li>
  );
}
