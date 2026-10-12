// The Schedules tab (SPEC AV-01 to AV-10; walkthrough 9.2). Top card header: "Schedule" with the schedule dropdown
// ("Working hours (default)", others, "+ Create schedule"), "Active on: N event types", the Troubleshoot link, the
// List / Calendar switch and the kebab (Rename, Set as default, Clone, Delete). List view: "Weekly hours" on the left,
// "Date-specific hours" on the right (stacked on phones); Calendar view: the month grid. The schedule "Time zone" sits
// at the bottom. Every change saves automatically (weekly hours debounced 600ms, optimistic) with the inline "Saved"
// indicator; failures revert and show "Couldn't save your changes. Try again.".
"use client";

import { CalendarDays, ChevronDown, Copy, List, MoreHorizontal, Pencil, Plus, Star, Stethoscope, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { MinuteRange, WeeklyHours } from "@/db/types";
import { DateOverridesEditor } from "@/components/availability/date-overrides-editor";
import { scheduleLabel } from "@/components/availability/schedule-select";
import { ScheduleTimeZoneField } from "@/components/availability/schedule-time-zone-field";
import { WeeklyHoursEditor } from "@/components/availability/weekly-hours-editor";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { todayIn } from "@/components/ui/month-calendar-utils";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { toast } from "@/components/ui/toast";
import type { ActionResult } from "@/lib/actions";
import {
  applyOverrideChange,
  cloneWeekly,
  sameWeekly,
  sortOverrides,
  weeklyIsValid,
  type DateOverride,
  type OverrideChange,
} from "@/lib/availability/intervals";
import { scheduleHref, troubleshootHref } from "@/lib/availability/links";
import { MAX_SCHEDULES } from "@/lib/availability/schemas";
import type { ActiveOnEventType, ScheduleDetail, ScheduleSummary } from "@/lib/availability/types";
import { cn } from "@/lib/cn";
import {
  applyActiveOnAction,
  cloneScheduleAction,
  createScheduleAction,
  deleteDateOverrideAction,
  deleteScheduleAction,
  renameScheduleAction,
  saveDateOverridesAction,
  saveScheduleTimezoneAction,
  saveWeeklyHoursAction,
  setDefaultScheduleAction,
} from "../actions";
import { ActiveOnPopover } from "./active-on-popover";
import { CalendarView } from "./calendar-view";
import { SAVE_FAILED, SaveIndicator, useSaveQueue } from "./save-status";
import { CreateScheduleDialog, DeleteScheduleDialog, RenameScheduleDialog } from "./schedule-dialogs";

export type SchedulesViewProps = {
  schedules: ScheduleSummary[];
  schedule: ScheduleDetail;
  eventTypes: ActiveOnEventType[];
  /** Today in the schedule's zone. */
  today: string;
  hour12: boolean;
  weekStart: 0 | 1;
  view: "list" | "calendar";
};

type AnyResult = ActionResult<unknown>;
const NETWORK_FAILURE: AnyResult = { ok: false, error: { code: "internal", message: SAVE_FAILED } };

/** Calls a server action, mapping a thrown request (offline, server down) to a failed result. */
async function call<T extends AnyResult>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return NETWORK_FAILURE as T;
  }
}

const messageOf = (res: AnyResult, field?: string) =>
  res.ok ? null : ((field && res.error.fieldErrors?.[field]?.[0]) ?? (res.error.code === "internal" ? SAVE_FAILED : res.error.message));

export function SchedulesView({ schedules, schedule, eventTypes, today: serverToday, hour12, weekStart, view: initialView }: SchedulesViewProps) {
  const router = useRouter();
  const { state: saveState, run, idle, markDirty } = useSaveQueue();
  const [, startTransition] = useTransition();
  const scheduleId = schedule.id;
  const timeFormat = hour12 ? "12h" : "24h";

  const [view, setView] = useState(initialView);
  const [weekly, setWeekly] = useState<WeeklyHours>(schedule.weeklyHours);
  const [overrides, setOverrides] = useState<DateOverride[]>(schedule.overrides);
  const [timezone, setTimezone] = useState(schedule.timezone);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menuBusy, setMenuBusy] = useState(false);

  const savedWeekly = useRef<WeeklyHours>(schedule.weeklyHours);
  const pendingWeekly = useRef<WeeklyHours | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const today = useMemo(() => (timezone === schedule.timezone ? serverToday : todayIn(timezone)), [timezone, schedule.timezone, serverToday]);
  const atLimit = schedules.length >= MAX_SCHEDULES;
  const others = schedules.filter((s) => s.id !== scheduleId);
  const summary = schedules.find((s) => s.id === scheduleId) ?? { ...schedule, eventTypeCount: 0 };

  // ---- weekly hours: debounced auto-save of valid values
  const flushWeekly = useCallback((): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const value = pendingWeekly.current;
    pendingWeekly.current = null;
    if (!value || sameWeekly(value, savedWeekly.current)) return Promise.resolve();
    return run(async () => {
      const res = await call(() => saveWeeklyHoursAction({ scheduleId, weeklyHours: value }));
      if (res.ok) {
        savedWeekly.current = value;
      } else {
        if (!pendingWeekly.current) setWeekly(cloneWeekly(savedWeekly.current));
        toast.error(messageOf(res) ?? SAVE_FAILED);
      }
      return res;
    }).then(() => undefined);
  }, [run, scheduleId]);

  const onWeeklyChange = (next: WeeklyHours) => {
    setWeekly(next);
    markDirty();
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!weeklyIsValid(next)) {
      pendingWeekly.current = null;
      return;
    }
    pendingWeekly.current = next;
    timer.current = setTimeout(() => void flushWeekly(), 600);
  };

  // Save pending edits when the tab is hidden or the page unloads, and when this view unmounts.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flushWeekly();
    };
    const onPageHide = () => void flushWeekly();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      void flushWeekly();
    };
  }, [flushWeekly]);

  /** Navigates after the pending saves finished. */
  const go = (href: Parameters<typeof router.push>[0]) =>
    startTransition(async () => {
      await flushWeekly();
      await idle();
      router.push(href);
    });

  // ---- date-specific hours
  const onOverridesChange = async (_next: DateOverride[], change: OverrideChange) => {
    if (change.type === "delete") {
      const removed = overrides.find((o) => o.date === change.date);
      setOverrides((cur) => applyOverrideChange(cur, change));
      const res = await run(() => call(() => deleteDateOverrideAction({ scheduleId, date: change.date })));
      if (!res.ok) {
        if (removed) setOverrides((cur) => sortOverrides([...cur.filter((o) => o.date !== removed.date), removed]));
        toast.error(SAVE_FAILED);
      }
      return;
    }
    const res = await run(() => call(() => saveDateOverridesAction({ scheduleId, dates: change.dates, intervals: change.intervals })));
    if (!res.ok) {
      toast.error(res.error.code === "conflict" || res.error.code === "validation" ? (messageOf(res) ?? SAVE_FAILED) : SAVE_FAILED);
      throw new Error("save failed");
    }
    setOverrides((cur) => applyOverrideChange(cur, change));
  };

  const resetDates = async (dates: string[]) => {
    const removed = overrides.filter((o) => dates.includes(o.date));
    setOverrides((cur) => cur.filter((o) => !dates.includes(o.date)));
    const results = await Promise.all(dates.map((date) => run(() => call(() => deleteDateOverrideAction({ scheduleId, date })))));
    const failed = removed.filter((_, i) => !results[i]?.ok);
    if (failed.length) {
      setOverrides((cur) => sortOverrides([...cur.filter((o) => !failed.some((f) => f.date === o.date)), ...failed]));
      toast.error(SAVE_FAILED);
      throw new Error("save failed");
    }
  };

  const editWeekday = (day: number, intervals: MinuteRange[]) => {
    const next = cloneWeekly(weekly);
    next[day] = intervals;
    onWeeklyChange(next);
  };

  // ---- time zone
  const onTimezoneChange = async (zone: string) => {
    if (zone === timezone) return;
    const previous = timezone;
    setTimezone(zone);
    const res = await run(() => call(() => saveScheduleTimezoneAction({ scheduleId, timezone: zone })));
    if (!res.ok) {
      setTimezone(previous);
      toast.error(SAVE_FAILED);
    }
  };

  // ---- structural actions
  const createSchedule = async (name: string) => {
    const res = await call(() => createScheduleAction({ name }));
    if (!res.ok) return messageOf(res, "name");
    toast.success("Schedule created");
    go(scheduleHref(res.data.id, view));
    return null;
  };

  const rename = async (name: string) => {
    const res = await call(() => renameScheduleAction({ scheduleId, name }));
    if (!res.ok) return messageOf(res, "name");
    toast.success("Schedule renamed");
    router.refresh();
    return null;
  };

  const menuAction = async (fn: () => Promise<AnyResult>, success: string, after?: (res: AnyResult) => void) => {
    setMenuBusy(true);
    try {
      await flushWeekly();
      const res = await call(fn);
      if (!res.ok) {
        toast.error(messageOf(res) ?? SAVE_FAILED);
        return false;
      }
      toast.success(success);
      if (after) after(res);
      else router.refresh();
      return true;
    } finally {
      setMenuBusy(false);
    }
  };

  const changeView = (v: "list" | "calendar") => {
    setView(v);
    window.history.replaceState(null, "", scheduleHref(scheduleId, v));
  };

  return (
    <Card padding="none">
      <div className="flex flex-col gap-4 border-b border-line p-4 sm:p-6 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-body-sm font-semibold text-ink-2" id="schedule-picker-label">
            Schedule
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-labelledby="schedule-picker-label schedule-picker-value"
                className="inline-flex w-fit max-w-full items-center gap-2 rounded-[6px] py-0.5 text-left text-title-md font-bold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <span id="schedule-picker-value" className="min-w-0 truncate">
                  {scheduleLabel(summary)}
                </span>
                <ChevronDown aria-hidden="true" className="size-5 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[min(320px,calc(100vw-32px))]">
              {schedules.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  aria-current={s.id === scheduleId ? "true" : undefined}
                  className={cn(s.id === scheduleId && "font-semibold text-primary-text")}
                  onSelect={() => s.id !== scheduleId && go(scheduleHref(s.id, view))}
                >
                  {scheduleLabel(s)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Plus aria-hidden="true" />} disabled={atLimit} onSelect={() => setCreateOpen(true)} className="font-semibold text-primary-text">
                {atLimit ? `Create schedule (limit of ${MAX_SCHEDULES} reached)` : "Create schedule"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <ActiveOnPopover
            key={`${scheduleId}:${eventTypes.map((e) => `${e.id}=${e.scheduleId}`).join(",")}`}
            scheduleId={scheduleId}
            scheduleName={summary.name}
            isDefault={summary.isDefault}
            eventTypes={eventTypes}
            onApply={async (ids, replaceCustom) => {
              const res = await call(() => applyActiveOnAction({ scheduleId, eventTypeIds: ids, replaceCustom }));
              if (!res.ok) {
                toast.error(messageOf(res) ?? SAVE_FAILED);
                return false;
              }
              toast.success("Changes saved");
              router.refresh();
              return true;
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <SaveIndicator state={saveState} className="mr-1" />
          <Button asChild variant="secondary" size="sm" leftIcon={<Stethoscope aria-hidden="true" />}>
            <Link href={troubleshootHref()}>Troubleshoot</Link>
          </Button>
          <SegmentedControl
            aria-label="View"
            size="sm"
            value={view}
            onValueChange={changeView}
            options={[
              { value: "list", label: "List", icon: <List aria-hidden="true" className="size-4" /> },
              { value: "calendar", label: "Calendar", icon: <CalendarDays aria-hidden="true" className="size-4" /> },
            ]}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton aria-label="Schedule options" variant="secondary" size="md" loading={menuBusy}>
                <MoreHorizontal aria-hidden="true" />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={<Pencil aria-hidden="true" />} onSelect={() => setRenameOpen(true)}>
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<Star aria-hidden="true" />}
                disabled={summary.isDefault}
                onSelect={() => void menuAction(() => setDefaultScheduleAction({ scheduleId }), "Default schedule updated")}
              >
                Set as default
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={<Copy aria-hidden="true" />}
                disabled={atLimit}
                onSelect={() =>
                  void menuAction(
                    () => cloneScheduleAction({ scheduleId }),
                    "Schedule cloned",
                    (res) => res.ok && go(scheduleHref((res.data as { id: string }).id, view)),
                  )
                }
              >
                Clone
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Trash2 aria-hidden="true" />} destructive disabled={summary.isDefault} onSelect={() => setDeleteOpen(true)}>
                <span className="flex flex-col">
                  <span>Delete</span>
                  {summary.isDefault && <span className="text-body-sm text-ink-3">Set another schedule as default first</span>}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="p-4 sm:p-6">
        {view === "list" ? (
          <div className="grid min-w-0 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-0">
            <WeeklyHoursEditor value={weekly} onChange={onWeeklyChange} timeFormat={timeFormat} weekStart={weekStart} className="lg:pr-10" />
            <DateOverridesEditor
              value={overrides}
              onChange={onOverridesChange}
              today={today}
              timeFormat={timeFormat}
              weekStart={weekStart}
              className="border-t border-line pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-10"
            />
          </div>
        ) : (
          <CalendarView
            weekly={weekly}
            overrides={overrides}
            today={today}
            weekStart={weekStart}
            hour12={hour12}
            onEditDates={(dates, intervals) => onOverridesChange(overrides, { type: "upsert", dates, intervals })}
            onEditWeekday={editWeekday}
            onResetDates={resetDates}
          />
        )}
      </div>

      <div className="border-t border-line p-4 sm:p-6">
        <ScheduleTimeZoneField value={timezone} onChange={(z) => void onTimezoneChange(z)} hour12={hour12} />
      </div>

      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={createSchedule} />
      <RenameScheduleDialog open={renameOpen} onOpenChange={setRenameOpen} currentName={summary.name} onRename={rename} />
      {!summary.isDefault && (
        <DeleteScheduleDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          schedule={summary}
          others={others}
          onDelete={async (replacementId) =>
            menuAction(
              () => deleteScheduleAction({ scheduleId, replacementId }),
              "Schedule deleted",
              () => go(scheduleHref(null, view)),
            )
          }
        />
      )}
    </Card>
  );
}
