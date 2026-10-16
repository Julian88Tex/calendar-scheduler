// The week grid of the poll creation calendar (SPEC MP-02, MP-29; research meeting-polls.md B3.1, B17, B20).
//
// - Columns are local dates of the grid zone, rows 15-minute wall-clock slots (DST: hatched "Doesn't exist (DST)"
//   cells, the repeated fall back hour as labeled rows, src/components/polls/lib/week.ts).
// - Read-only overlays under the options: busy events of the host's conflict calendars (hatched, with titles), app
//   meetings (solid, the buffer as a lighter band), other polls' holds (dashed "Reserved: ..."), co-hosts' busy times
//   (blue tint, never titled, GEN-08), working hours (white) versus off hours (gray), the past (grayed, not clickable)
//   and a red now line.
// - Mouse and pen: click a free slot to add an option of the current duration (an exact duplicate toggles off), drag
//   to create a custom span (Alt snaps to 5 minutes), drag an option to move it (also across days), drag its bottom
//   edge to resize, x to remove. Touch: tap to add, drag an option to move it. Overlapping options sit side by side;
//   an option over a busy block gets an amber outline and "Overlaps '{title}'".
// - Keyboard: every slot is a button in a roving tab stop; arrows move (Page Up/Down by an hour, Home/End), Enter or
//   Space adds or removes the option starting there, Delete removes options covering it. The selected times list in
//   the sidebar is the full keyboard alternative to dragging.
// Client component.
"use client";

import { ChevronDown, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";
import { localDate, offsetLabelAt } from "@/lib/polls/grid";
import { MAX_OPTION_MINUTES, MIN_OPTION_MINUTES } from "@/lib/polls/constants";
import { formatDateMedium, formatTime, formatWeekday } from "@/lib/time/format";
import { assignLanes, buildWeekModel, hourText, instantAt, segmentsFor, yOf, type WeekModel } from "../lib/week";
import { allDay, overlapping, timed, type DraftOption } from "../lib/options";
import { pt } from "../lib/t";

export const ROW_HEIGHT = 20;
const MIN = 60_000;

export type GridBusy = {
  start: number;
  end: number;
  kind: "calendar" | "meeting" | "hold" | "reservation";
  title: string | null;
  /** The requester's own calendar, or a co-host's (no titles). */
  owner: "me" | "cohost";
  /** Meetings: the meeting without its buffers. */
  core: { start: number; end: number } | null;
};

export type WeekGridProps = {
  dates: string[];
  zone: string;
  hour12: boolean;
  now: number;
  options: DraftOption[];
  /** Duration of new options in minutes; null when "All day" is chosen. */
  durationMinutes: number | null;
  busy: GridBusy[];
  working: { start: number; end: number }[];
  /** Why changes are not possible (a booked poll), else null. */
  locked: string | null;
  onToggle: (o: DraftOption) => void;
  onAdd: (o: DraftOption) => void;
  onRemove: (key: string) => void;
  onReplace: (key: string, next: DraftOption) => void;
  onDayAction: (date: string, action: "free" | "copy") => void;
  onError: (message: string) => void;
  /** First scroll position (wall-clock minutes). */
  scrollToMinutes: number;
  label: string;
  /** Show the day menus (Add all free times, Copy this day's times to...). */
  dayMenus: boolean;
};

type Drag =
  | { kind: "create"; date: string; pointerId: number; startY: number; anchor: number; current: number; moved: boolean; touch: boolean }
  | {
      kind: "move";
      key: string;
      pointerId: number;
      grabPx: number;
      durationMs: number;
      date: string;
      start: number;
      moved: boolean;
      originX: number;
      originY: number;
      /** New options move; existing, started or locked ones only take clicks. */
      movable: boolean;
      /** The slot under the press (a click toggles the option starting there, MP-02 overlapping times). */
      pressDate: string;
      pressY: number;
    }
  | { kind: "resize"; key: string; pointerId: number; date: string; start: number; end: number };

function optionInterval(o: DraftOption): { start: number; end: number } | null {
  return o.kind === "timed" ? { start: o.start, end: o.end } : null;
}

function busyLabel(b: GridBusy): string | null {
  if (b.owner === "cohost") return null;
  if (b.kind === "hold") return b.title ?? pt("wizard.legendReserved");
  return b.title;
}

export function WeekGrid(p: WeekGridProps) {
  const nowBucket = Math.floor(p.now / MIN) * MIN;
  const model = useMemo(() => buildWeekModel(p.dates, p.zone, { now: nowBucket, hour12: p.hour12 }), [p.dates, p.zone, nowBucket, p.hour12]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef(new Map<string, HTMLDivElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [focus, setFocus] = useState<{ date: string; row: number }>(() => ({ date: p.dates[0]!, row: 0 }));
  const H = ROW_HEIGHT;
  const today = localDate(p.now, p.zone);
  const allDayMode = p.durationMinutes === null;
  const showAllDayLane = allDayMode || p.options.some((o) => o.kind === "date");

  const setDragState = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  // First scroll position: working hours start (or 7am), once per zone and week.
  const scrolledFor = useRef<string>("");
  useEffect(() => {
    const key = `${p.zone}|${p.dates[0]}`;
    if (scrolledFor.current === key) return;
    scrolledFor.current = key;
    const row = model.rows.find((r) => r.variant === 0 && r.minutes >= Math.max(0, p.scrollToMinutes - 30));
    if (scrollRef.current && row) scrollRef.current.scrollTop = row.index * H;
    setFocus((f) => ({ date: p.dates.includes(f.date) ? f.date : p.dates[0]!, row: row?.index ?? f.row }));
  }, [p.zone, p.dates, p.scrollToMinutes, model, H]);

  const dayLabels = useMemo(() => Object.fromEntries(p.dates.map((d) => [d, formatDateMedium(`${d}T12:00:00Z`, "UTC")])), [p.dates]);

  const timedOptions = useMemo(
    () =>
      p.options
        .map((o) => ({ o, iv: optionInterval(o) }))
        .filter((x): x is { o: DraftOption & { kind: "timed" }; iv: { start: number; end: number } } => Boolean(x.iv)),
    [p.options],
  );
  const startsAt = useMemo(() => {
    const m = new Map<number, DraftOption[]>();
    for (const { o, iv } of timedOptions) m.set(iv.start, [...(m.get(iv.start) ?? []), o]);
    return m;
  }, [timedOptions]);

  const durationMs = (p.durationMinutes ?? 30) * MIN;

  const dateAtX = (clientX: number): string | null => {
    for (const [d, el] of colRefs.current) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX < r.right) return d;
    }
    return null;
  };
  const yIn = (date: string, clientY: number): number => {
    const el = colRefs.current.get(date);
    if (!el) return 0;
    return clientY - el.getBoundingClientRect().top;
  };

  const validNew = (start: number, end: number): boolean => {
    if (start <= p.now) {
      p.onError(pt("wizard.pastTime"));
      return false;
    }
    const minutes = (end - start) / MIN;
    if (minutes < MIN_OPTION_MINUTES || minutes > MAX_OPTION_MINUTES) {
      p.onError(pt("wizard.durationRange"));
      return false;
    }
    return true;
  };

  const toggleAt = useCallback(
    (date: string, row: number) => {
      if (p.locked) return;
      if (allDayMode) {
        if (model.bounds[date]!.start <= p.now) {
          p.onError(pt("wizard.pastTime"));
          return;
        }
        p.onToggle(allDay(date));
        return;
      }
      const cell = model.cells[date]?.[row];
      if (!cell || cell.state !== "ok" || cell.past) return;
      const existing = (startsAt.get(cell.start) ?? []).find((o) => !o.frozen);
      if (existing) {
        p.onRemove(existing.key);
        return;
      }
      p.onToggle(timed(cell.start, cell.start + durationMs));
    },
    [p, allDayMode, model, startsAt, durationMs],
  );

  // -------------------------------------------------------------------------------------------------------------
  // Pointer interactions

  const onColumnPointerDown = (date: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (p.locked || e.button !== 0) return;
    if ((e.target as Element).closest("[data-grid-option]")) return;
    const y = yIn(date, e.clientY);
    const start = instantAt(model, date, y, H, { mode: "floor" });
    if (start === null) return;
    const touch = e.pointerType === "touch";
    if (!touch) e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({ kind: "create", date, pointerId: e.pointerId, startY: y, anchor: start, current: start, moved: false, touch });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const snapMinutes = e.altKey ? 5 : 15;
    if (d.kind === "create") {
      if (d.touch || allDayMode) return;
      const y = yIn(d.date, e.clientY);
      const moved = d.moved || Math.abs(y - d.startY) > 5;
      const current = instantAt(model, d.date, y, H, { mode: "round", snapMinutes }) ?? d.current;
      setDragState({ ...d, current, moved });
    } else if (d.kind === "move") {
      if (!d.movable) return;
      const moved = d.moved || Math.abs(e.clientX - d.originX) > 4 || Math.abs(e.clientY - d.originY) > 4;
      const date = dateAtX(e.clientX) ?? d.date;
      const start = instantAt(model, date, yIn(date, e.clientY) - d.grabPx, H, { mode: "floor", snapMinutes });
      setDragState({ ...d, date, start: start ?? d.start, moved });
    } else {
      const end = instantAt(model, d.date, yIn(d.date, e.clientY), H, { mode: "round", snapMinutes });
      if (end !== null) setDragState({ ...d, end: Math.max(d.start + 15 * MIN, end) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setDragState(null);
    if (d.kind === "create") {
      if (!d.moved || allDayMode) {
        const row = model.index[d.date]?.find((c) => c.start === d.anchor)?.row;
        if (row !== undefined) toggleAt(d.date, row);
        else if (allDayMode) toggleAt(d.date, 0);
        return;
      }
      const lo = Math.min(d.anchor, d.current);
      const hi = Math.max(d.anchor + 15 * MIN, d.current);
      if (validNew(lo, hi)) p.onAdd(timed(lo, hi));
      return;
    }
    if (d.kind === "move") {
      if (!d.moved) {
        // A click on an option: the slot under the pointer toggles (its own start removes it, another slot adds an
        // overlapping time there).
        const at = instantAt(model, d.pressDate, d.pressY, H, { mode: "floor" });
        const row = at === null ? undefined : model.index[d.pressDate]?.find((c) => c.start === at)?.row;
        if (row !== undefined) toggleAt(d.pressDate, row);
        return;
      }
      const end = d.start + d.durationMs;
      if (validNew(d.start, end)) p.onReplace(d.key, timed(d.start, end));
      return;
    }
    if (validNew(d.start, d.end)) p.onReplace(d.key, timed(d.start, d.end));
  };

  const onPointerCancel = () => setDragState(null);

  const startMove = (o: DraftOption & { kind: "timed" }, date: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (p.locked || e.button !== 0) return;
    if ((e.target as Element).closest("button,[data-resize]")) return;
    e.stopPropagation();
    const movable = !o.id && !o.frozen;
    if (movable) e.currentTarget.setPointerCapture(e.pointerId);
    const y = yIn(date, e.clientY);
    const top = yOf(model, date, Math.max(o.start, model.bounds[date]!.start), H);
    setDragState({
      kind: "move",
      key: o.key,
      pointerId: e.pointerId,
      grabPx: y - top,
      durationMs: o.end - o.start,
      date,
      start: o.start,
      moved: false,
      originX: e.clientX,
      originY: e.clientY,
      movable,
      pressDate: date,
      pressY: y,
    });
  };

  const startResize = (o: DraftOption & { kind: "timed" }, date: string) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (p.locked || o.id || o.frozen || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({ kind: "resize", key: o.key, pointerId: e.pointerId, date, start: o.start, end: o.end });
  };

  // -------------------------------------------------------------------------------------------------------------
  // Keyboard

  const focusCell = (date: string, row: number) => {
    setFocus({ date, row });
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-cell="${date}:${row}"]`);
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };

  const onCellKeyDown = (date: string, row: number) => (e: React.KeyboardEvent) => {
    const di = p.dates.indexOf(date);
    const last = model.rows.length - 1;
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        focusCell(date, Math.max(0, row - 1));
        break;
      case "ArrowDown":
        e.preventDefault();
        focusCell(date, Math.min(last, row + 1));
        break;
      case "ArrowLeft":
        e.preventDefault();
        if (di > 0) focusCell(p.dates[di - 1]!, row);
        break;
      case "ArrowRight":
        e.preventDefault();
        if (di < p.dates.length - 1) focusCell(p.dates[di + 1]!, row);
        break;
      case "PageUp":
        e.preventDefault();
        focusCell(date, Math.max(0, row - 4));
        break;
      case "PageDown":
        e.preventDefault();
        focusCell(date, Math.min(last, row + 4));
        break;
      case "Home":
        e.preventDefault();
        focusCell(e.ctrlKey ? p.dates[0]! : date, 0);
        break;
      case "End":
        e.preventDefault();
        focusCell(e.ctrlKey ? p.dates[p.dates.length - 1]! : date, last);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        toggleAt(date, row);
        break;
      case "Delete":
      case "Backspace": {
        e.preventDefault();
        const cell = model.cells[date]?.[row];
        if (!cell || cell.state !== "ok" || p.locked) break;
        for (const { o, iv } of timedOptions) if (!o.frozen && iv.start <= cell.start && iv.end > cell.start) p.onRemove(o.key);
        break;
      }
    }
  };

  // -------------------------------------------------------------------------------------------------------------
  // Rendering

  const preview = (() => {
    if (!drag) return null;
    if (drag.kind === "create" && drag.moved && !allDayMode) {
      return { date: drag.date, start: Math.min(drag.anchor, drag.current), end: Math.max(drag.anchor + 15 * MIN, drag.current) };
    }
    if (drag.kind === "move" && drag.moved) return { date: drag.date, start: drag.start, end: drag.start + drag.durationMs };
    if (drag.kind === "resize") return { date: drag.date, start: drag.start, end: drag.end };
    return null;
  })();
  const draggingKey = drag && drag.kind !== "create" && (drag.kind === "resize" || drag.moved) ? drag.key : null;

  return (
    <div
      ref={scrollRef}
      className="relative min-h-0 flex-1 overflow-auto bg-white scrollbar-thin"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      data-testid="week-grid"
    >
      <div className="min-w-fit">
        {/* Day headers */}
        <div className="sticky top-0 z-30 flex border-b border-line bg-white">
          <div className="sticky left-0 z-10 w-14 shrink-0 bg-white" aria-hidden="true" />
          {p.dates.map((d) => {
            const isToday = d === today;
            const day = Number(d.slice(8, 10));
            return (
              <div key={d} className="flex min-w-[76px] flex-1 items-center justify-center gap-1 border-l border-line px-1 py-2">
                <div className="flex flex-col items-center">
                  <span className={cn("text-label-sm uppercase", isToday ? "text-primary-text" : "text-ink-2")}>{formatWeekday(`${d}T12:00:00Z`, "UTC")}</span>
                  <span className={cn("mt-0.5 inline-flex size-8 items-center justify-center rounded-full text-[16px] font-bold", isToday ? "bg-primary text-white" : "text-ink")}>{day}</span>
                </div>
                {p.dayMenus && !p.locked && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={pt("wizard.dayMenu", { day: dayLabels[d]! })}
                        className="inline-flex size-7 items-center justify-center rounded-full text-ink-2 hover:bg-primary-soft hover:text-primary-text focus-visible:outline-2 focus-visible:outline-focus"
                      >
                        <ChevronDown aria-hidden="true" className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-[220px]">
                      <DropdownMenuItem onSelect={() => p.onDayAction(d, "free")} disabled={allDayMode || model.bounds[d]!.end <= p.now}>
                        {pt("wizard.addFreeTimes")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => p.onDayAction(d, "copy")}>{pt("wizard.copyDayTimes")}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </div>

        {/* All-day lane */}
        {showAllDayLane && (
          <div className="relative z-20 flex border-b border-line bg-white">
            <div className="sticky left-0 z-10 flex w-14 shrink-0 items-center justify-end bg-white pr-2 text-[11px] text-ink-2">{pt("wizard.allDayLane")}</div>
            {p.dates.map((d) => {
              const opt = p.options.find((o) => o.kind === "date" && o.date === d);
              const past = model.bounds[d]!.start <= p.now;
              return (
                <div key={d} className="min-w-[76px] flex-1 border-l border-line p-1">
                  {opt ? (
                    <div className={cn("flex items-center justify-between gap-1 rounded-[4px] px-1.5 py-1 text-[12px] font-semibold", opt.frozen ? "bg-mist text-ink-2" : "bg-brand text-white")} data-testid="grid-all-day">
                      <span className="truncate">{pt("common.allDay")}</span>
                      {!opt.frozen && !p.locked && (
                        <button type="button" aria-label={pt("wizard.removeTime", { when: `${dayLabels[d]}, ${pt("common.allDay")}` })} onClick={() => p.onRemove(opt.key)} className="rounded-full p-0.5 hover:bg-white/20">
                          <X aria-hidden="true" className="size-3" />
                        </button>
                      )}
                    </div>
                  ) : allDayMode && !past && !p.locked ? (
                    <button
                      type="button"
                      onClick={() => p.onToggle(allDay(d))}
                      aria-label={`${dayLabels[d]}, ${pt("common.allDay")}`}
                      className="h-7 w-full rounded-[4px] border border-dashed border-line-medium text-[12px] text-ink-2 hover:border-brand hover:text-brand-strong"
                    >
                      +
                    </button>
                  ) : (
                    <div className="h-7" />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Body */}
        <div className="relative flex" style={{ height: model.rows.length * H }}>
          <div className="sticky left-0 z-20 w-14 shrink-0 bg-white" aria-hidden="true">
            {model.rows.map((r) =>
              r.hourLabel ? (
                <span key={r.index} className="absolute right-2 -translate-y-1/2 text-[11px] whitespace-nowrap text-ink-2" style={{ top: r.index * H }}>
                  {r.index === 0 ? "" : r.hourLabel}
                </span>
              ) : null,
            )}
          </div>
          <div role="group" aria-label={p.label} aria-describedby="poll-grid-help" className="flex flex-1">
            {p.dates.map((d) => (
              <DayColumn
                key={d}
                date={d}
                model={model}
                H={H}
                now={p.now}
                isToday={d === today}
                dayLabel={dayLabels[d]!}
                hour12={p.hour12}
                zone={p.zone}
                locked={p.locked}
                allDayMode={allDayMode}
                busy={p.busy}
                working={p.working}
                options={timedOptions}
                startsAt={startsAt}
                focus={focus}
                draggingKey={draggingKey}
                preview={preview && preview.date === d ? preview : null}
                refCb={(el) => {
                  if (el) colRefs.current.set(d, el);
                  else colRefs.current.delete(d);
                }}
                onPointerDown={onColumnPointerDown(d)}
                onCellKeyDown={onCellKeyDown}
                onCellActivate={(row) => toggleAt(d, row)}
                onCellFocus={(row) => setFocus({ date: d, row })}
                startMove={startMove}
                startResize={startResize}
                onRemove={p.onRemove}
              />
            ))}
          </div>
        </div>
      </div>
      <p id="poll-grid-help" className="sr-only">
        {pt("wizard.gridHelp")}
      </p>
    </div>
  );
}

type DayColumnProps = {
  date: string;
  model: WeekModel;
  H: number;
  now: number;
  isToday: boolean;
  dayLabel: string;
  hour12: boolean;
  zone: string;
  locked: string | null;
  allDayMode: boolean;
  busy: GridBusy[];
  working: { start: number; end: number }[];
  options: { o: DraftOption & { kind: "timed" }; iv: { start: number; end: number } }[];
  startsAt: Map<number, DraftOption[]>;
  focus: { date: string; row: number };
  draggingKey: string | null;
  preview: { date: string; start: number; end: number } | null;
  refCb: (el: HTMLDivElement | null) => void;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onCellKeyDown: (date: string, row: number) => (e: React.KeyboardEvent) => void;
  onCellActivate: (row: number) => void;
  onCellFocus: (row: number) => void;
  startMove: (o: DraftOption & { kind: "timed" }, date: string) => (e: React.PointerEvent<HTMLDivElement>) => void;
  startResize: (o: DraftOption & { kind: "timed" }, date: string) => (e: React.PointerEvent<HTMLDivElement>) => void;
  onRemove: (key: string) => void;
};

function DayColumn({ refCb, ...c }: DayColumnProps) {
  const { model, date, H } = c;
  const bounds = model.bounds[date]!;
  const totalH = model.rows.length * H;
  const pastY = bounds.end <= c.now ? totalH : bounds.start >= c.now ? 0 : yOf(model, date, c.now, H);

  const workingSegs = useMemo(() => c.working.flatMap((w) => segmentsFor(model, w, H).filter((s) => s.date === date)), [c.working, model, H, date]);
  const busySegs = useMemo(
    () =>
      c.busy.flatMap((b) =>
        segmentsFor(model, b, H)
          .filter((s) => s.date === date)
          .map((s) => ({ s, b, core: b.core ? segmentsFor(model, b.core, H).find((x) => x.date === date) ?? null : null })),
      ),
    [c.busy, model, H, date],
  );
  const laid = useMemo(() => {
    const items = c.options
      .flatMap(({ o, iv }) => segmentsFor(model, iv, H).filter((s) => s.date === date).map((s) => ({ o, iv, s, start: s.top, end: s.bottom })))
      .filter((x) => x.o.key !== c.draggingKey);
    return assignLanes(items);
  }, [c.options, model, H, date, c.draggingKey]);

  const cells = useMemo(() => {
    const repeated = new Set(model.rows.filter((r) => r.variant === 1).map((r) => r.minutes));
    return model.rows.map((r) => {
      const cell = model.cells[date]![r.index]!;
      const base = hourText(r.minutes, c.hour12);
      const time = repeated.has(r.minutes) && cell.state === "ok" ? `${base} (${offsetLabelAt(cell.start, c.zone)})` : base;
      return { r, cell, time };
    });
  }, [model, date, c.hour12, c.zone]);

  return (
    <div
      ref={refCb}
      data-date={date}
      onPointerDown={c.onPointerDown}
      className={cn("relative min-w-[76px] flex-1 touch-pan-y border-l border-line bg-pebble select-none", !c.locked && "cursor-pointer")}
      style={{ height: totalH }}
    >
      {workingSegs.map((s, i) => (
        <div key={`w${i}`} aria-hidden="true" className="absolute inset-x-0 bg-white" style={{ top: s.top, height: s.bottom - s.top }} />
      ))}
      {/* Slots (hour lines, DST gaps, keyboard targets) */}
      {cells.map(({ r, cell, time }) => {
        const label = `${c.dayLabel}, ${time}`;
        if (cell.state === "absent") return <div key={r.index} aria-hidden="true" className="relative bg-pebble" style={{ height: H }} />;
        if (cell.state === "nonexistent") {
          return (
            <div
              key={r.index}
              aria-hidden="true"
              title={pt("wizard.nonexistent")}
              className="relative bg-[repeating-linear-gradient(135deg,var(--mist)_0,var(--mist)_4px,var(--pebble)_4px,var(--pebble)_8px)]"
              style={{ height: H }}
            />
          );
        }
        const selected = (c.startsAt.get(cell.start) ?? []).length > 0;
        const focused = c.focus.date === date && c.focus.row === r.index;
        return (
          <div
            key={r.index}
            role="button"
            data-cell={`${date}:${r.index}`}
            tabIndex={focused ? 0 : -1}
            aria-pressed={selected}
            aria-disabled={cell.past || Boolean(c.locked) || undefined}
            aria-label={cell.past ? pt("wizard.cellPast", { when: label }) : label}
            onKeyDown={c.onCellKeyDown(date, r.index)}
            onFocus={() => c.onCellFocus(r.index)}
            onClick={(e) => {
              // Keyboard and screen reader activation (detail 0); pointer clicks go through the column handlers.
              if (e.detail === 0) c.onCellActivate(r.index);
            }}
            className={cn(
              "relative outline-none focus-visible:z-[25] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus",
              r.minutes % 60 === 0 && r.variant === 0 ? "border-t border-line" : r.minutes % 30 === 0 ? "border-t border-dashed border-line/60" : "",
              !cell.past && !c.locked && "hover:bg-primary-soft/60",
            )}
            style={{ height: H }}
          />
        );
      })}
      {/* Past */}
      {pastY > 0 && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 z-[5] bg-[color-mix(in_srgb,var(--pebble)_70%,transparent)]" style={{ height: pastY }} />}
      {c.isToday && pastY > 0 && pastY < totalH && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-[26] h-0.5 bg-danger" style={{ top: pastY }}>
          <span className="absolute -top-1 -left-1 size-2.5 rounded-full bg-danger" />
        </div>
      )}
      {/* Busy overlays */}
      {busySegs.map(({ s, b, core }, i) => {
        const title = busyLabel(b);
        return (
          <div
            key={`b${i}`}
            aria-hidden="true"
            data-testid="grid-busy"
            className={cn(
              "pointer-events-none absolute right-1 left-0.5 z-10 overflow-hidden rounded-[4px] px-1 py-0.5 text-[11px] leading-[13px] text-ink-2",
              b.owner === "cohost"
                ? "border border-primary-soft-2 bg-info-soft"
                : b.kind === "calendar"
                  ? "border border-line-medium bg-[repeating-linear-gradient(135deg,var(--mist)_0,var(--mist)_6px,var(--white)_6px,var(--white)_12px)]"
                  : b.kind === "hold"
                    ? "border border-dashed border-line-medium bg-white/70"
                    : "border border-line-medium bg-mist/60",
            )}
            style={{ top: s.top, height: Math.max(8, s.bottom - s.top) }}
          >
            {b.kind === "meeting" && core && (
              <span className="absolute inset-x-0 bg-mist" style={{ top: core.top - s.top, height: Math.max(4, core.bottom - core.top) }} />
            )}
            {title && s.bottom - s.top >= 14 && <span className="relative line-clamp-2 font-semibold break-words">{title}</span>}
          </div>
        );
      })}
      {/* Options */}
      {laid.map(({ o, iv, s, lane, lanes }) => {
        const height = Math.max(10, s.bottom - s.top);
        const over = overlapping(iv, c.busy);
        const overTitle = over ? busyLabel(over) : null;
        const when = `${c.dayLabel}, ${formatTime(iv.start, c.zone, "en", c.hour12)} - ${formatTime(iv.end, c.zone, "en", c.hour12)}`;
        const editable = !c.locked && !o.frozen && !o.id;
        return (
          <div
            key={o.key}
            data-grid-option=""
            data-testid="grid-option"
            title={over ? (overTitle ? pt("wizard.overlaps", { title: overTitle }) : pt("wizard.overlapsBusy")) : undefined}
            onPointerDown={c.startMove(o, date)}
            className={cn(
              "group absolute z-20 overflow-hidden rounded-[4px] px-1.5 py-0.5 text-[11px] leading-[14px] font-semibold shadow-sm",
              o.frozen ? "bg-mist text-ink-2" : "bg-brand text-white",
              over && !o.frozen && "outline-2 outline-offset-0 outline-warning",
              editable ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-default",
            )}
            style={{ top: s.top + 1, height: height - 2, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)` }}
          >
            <span className={cn("block truncate", lanes === 1 && "pr-4")}>{formatTime(iv.start, c.zone, "en", c.hour12)}</span>
            {height >= 30 && <span className="block truncate font-normal opacity-90">{formatTime(iv.end, c.zone, "en", c.hour12)}</span>}
            {over && <span className="sr-only">{overTitle ? pt("wizard.overlaps", { title: overTitle }) : pt("wizard.overlapsBusy")}</span>}
            {!o.frozen && !c.locked && (
              <button
                type="button"
                aria-label={pt("wizard.removeTime", { when })}
                onClick={(e) => {
                  e.stopPropagation();
                  c.onRemove(o.key);
                }}
                className={cn(
                  "absolute top-0.5 right-0.5 inline-flex size-4 items-center justify-center rounded-full hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-white",
                  // Side by side blocks are narrow: the remove button shows on hover or focus so the start time fits.
                  lanes > 1 && "bg-brand opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                <X aria-hidden="true" className="size-3" />
              </button>
            )}
            {editable && height >= 16 && <div data-resize="" aria-hidden="true" onPointerDown={c.startResize(o, date)} className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" />}
          </div>
        );
      })}
      {c.preview && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0.5 left-0.5 z-[24] rounded-[4px] border-2 border-brand bg-brand-soft/80 px-1.5 text-[11px] font-semibold text-brand-strong"
          style={{ top: yOf(model, date, Math.max(c.preview.start, bounds.start), H), height: Math.max(10, (c.preview.end >= bounds.end ? totalH : yOf(model, date, c.preview.end, H)) - yOf(model, date, Math.max(c.preview.start, bounds.start), H)) }}
        >
          {formatTime(c.preview.start, c.zone, "en", c.hour12)} - {formatTime(c.preview.end, c.zone, "en", c.hour12)}
        </div>
      )}
    </div>
  );
}

