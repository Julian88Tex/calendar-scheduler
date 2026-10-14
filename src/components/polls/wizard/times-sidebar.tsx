// Left column of step 1, "Choose times to offer" (SPEC MP-02; research B3.1): Time zone, Duration (15 to 120 minutes,
// Custom 5 minutes to 24 hours, All day; it applies to the times added next, so durations can mix), Hosts (the owner
// locked plus co-hosts from the same organization, whose busy times overlay the grid without titles), the overlay
// legend, the "{x}/100 times selected" counter with its list (remove one, "Clear all") and the step buttons. Client
// component.
"use client";

import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Combobox } from "@/components/ui/combobox";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Popover } from "@/components/ui/popover";
import { Select } from "@/components/ui/select";
import { TimeZoneSelect } from "@/components/ui/time-zone-select";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/cn";
import { DURATION_CHOICES, MAX_OPTION_MINUTES, MAX_POLL_COHOSTS, MAX_POLL_OPTIONS, MIN_OPTION_MINUTES } from "@/lib/polls/constants";
import { groupOptionsByLocalDate, optionTimeLabel } from "@/lib/polls/display";
import { formatDuration } from "@/lib/time/format";
import type { DurationChoice } from "../lib/draft";
import { sortOptions, type DraftOption } from "../lib/options";
import { pt } from "../lib/t";
import type { HostOption, ViewerPrefs } from "../types";

export type TimesSidebarProps = {
  zone: string;
  onZoneChange: (zone: string) => void;
  duration: DurationChoice;
  onDurationChange: (d: DurationChoice) => void;
  viewer: ViewerPrefs;
  members: HostOption[];
  cohostIds: string[];
  onCohostsChange: (ids: string[]) => void;
  /** Removing co-hosts is allowed (creator or admin). */
  canRemoveCohosts: boolean;
  options: DraftOption[];
  onRemove: (key: string) => void;
  onClear: () => void;
  locked: string | null;
  overlay: { loading: boolean; error: boolean; hasCohostBusy: boolean };
};

/** A DraftOption as the display helpers expect it. */
export function asView(o: DraftOption): { start: string | null; end: string | null; allDayDate: string | null; durationMinutes: number } {
  return o.kind === "date"
    ? { start: null, end: null, allDayDate: o.date, durationMinutes: 1440 }
    : { start: new Date(o.start).toISOString(), end: new Date(o.end).toISOString(), allDayDate: null, durationMinutes: Math.round((o.end - o.start) / 60_000) };
}

function DurationField({ value, onChange, disabled }: { value: DurationChoice; onChange: (d: DurationChoice) => void; disabled?: boolean }) {
  const preset = value.kind === "minutes" && (DURATION_CHOICES as readonly number[]).includes(value.minutes);
  const [custom, setCustom] = useState(!preset && value.kind === "minutes");
  const selectValue = value.kind === "all_day" ? "all_day" : custom ? "custom" : String(value.kind === "minutes" ? value.minutes : 30);
  const minutes = value.kind === "minutes" ? value.minutes : 30;
  const hoursUnit = minutes >= 60 && minutes % 60 === 0;
  const [unit, setUnit] = useState<"min" | "hrs">(hoursUnit ? "hrs" : "min");
  const amount = unit === "hrs" ? minutes / 60 : minutes;
  const invalid = minutes < MIN_OPTION_MINUTES || minutes > MAX_OPTION_MINUTES;
  return (
    <div className="flex flex-col gap-2">
      <Select
        aria-label={pt("wizard.duration")}
        value={selectValue}
        disabled={disabled}
        onValueChange={(v) => {
          if (v === "all_day") {
            setCustom(false);
            onChange({ kind: "all_day" });
          } else if (v === "custom") {
            setCustom(true);
            onChange({ kind: "minutes", minutes: value.kind === "minutes" ? value.minutes : 30 });
          } else {
            setCustom(false);
            onChange({ kind: "minutes", minutes: Number(v) });
          }
        }}
        options={[
          ...DURATION_CHOICES.map((m) => ({ value: String(m), label: formatDuration(m) })),
          { value: "custom", label: pt("wizard.durationCustom") },
          { value: "all_day", label: pt("wizard.durationAllDay") },
        ]}
      />
      {custom && value.kind === "minutes" && (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            aria-label={pt("wizard.customDuration")}
            min={unit === "hrs" ? 1 : MIN_OPTION_MINUTES}
            max={unit === "hrs" ? 24 : MAX_OPTION_MINUTES}
            step={unit === "hrs" ? 0.5 : 5}
            value={String(amount)}
            invalid={invalid}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isFinite(n) || n <= 0) return;
              onChange({ kind: "minutes", minutes: Math.round(unit === "hrs" ? n * 60 : n) });
            }}
            className="w-24"
          />
          <NativeSelect
            aria-label={pt("wizard.customDuration")}
            value={unit}
            onChange={(e) => setUnit(e.target.value as "min" | "hrs")}
            options={[
              { value: "min", label: pt("wizard.customMinutes") },
              { value: "hrs", label: pt("wizard.customHours") },
            ]}
            className="w-24"
          />
        </div>
      )}
      {invalid && <p className="text-body-sm text-danger-text">{pt("wizard.durationRange")}</p>}
      <p className="text-body-sm text-ink-2">{pt("wizard.durationHint")}</p>
    </div>
  );
}

export function SelectedTimes({ options, zone, hour12, onRemove, onClear, locked }: { options: DraftOption[]; zone: string; hour12: boolean; onRemove: (key: string) => void; onClear: () => void; locked: string | null }) {
  const [confirm, setConfirm] = useState(false);
  const sorted = sortOptions(options, zone);
  const byKey = new Map(sorted.map((o) => [o.key, o]));
  const groups = groupOptionsByLocalDate(
    sorted.map((o) => ({ ...asView(o), key: o.key })),
    zone,
    zone,
  );
  const removable = options.some((o) => !o.frozen);
  return (
    <>
      <Popover
        align="start"
        aria-label={pt("wizard.selectedListTitle")}
        className="w-[min(340px,calc(100vw-32px))] p-0"
        trigger={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-[4px] text-label text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-focus"
            data-testid="selected-count"
          >
            {pt("wizard.selectedCount", { count: options.length })}
          </button>
        }
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-label text-ink">{pt("wizard.selectedListTitle")}</p>
          {removable && !locked && (
            <Button variant="tertiary" size="sm" onClick={() => setConfirm(true)}>
              {pt("wizard.clearAll")}
            </Button>
          )}
        </div>
        {options.length === 0 ? (
          <p className="px-4 py-4 text-body-md text-ink-2">{pt("wizard.noTimes")}</p>
        ) : (
          <div className="max-h-[360px] overflow-y-auto px-4 py-2 scrollbar-thin">
            {groups.map((g) => (
              <div key={g.date} className="py-1.5">
                <p className="text-label-sm text-ink-2">{g.label}</p>
                <ul>
                  {g.options.map((v) => {
                    const o = byKey.get(v.key)!;
                    const when = optionTimeLabel(v, zone, { hour12 });
                    return (
                      <li key={v.key} className="flex items-center justify-between gap-2 py-1">
                        <span className={cn("text-body-md", o.frozen ? "text-ink-2" : "text-ink")}>
                          {when}
                          {!v.allDayDate && <span className="text-ink-2"> ({formatDuration(v.durationMinutes)})</span>}
                        </span>
                        {!o.frozen && !locked && (
                          <IconButton aria-label={pt("wizard.removeTime", { when: `${g.label}, ${when}` })} size="sm" onClick={() => onRemove(o.key)}>
                            <X aria-hidden="true" />
                          </IconButton>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Popover>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={pt("wizard.clearAllConfirm", { count: options.filter((o) => !o.frozen).length })}
        confirmLabel={pt("wizard.clearAll")}
        variant="destructive"
        onConfirm={() => onClear()}
      />
    </>
  );
}

export function TimesSidebar(p: TimesSidebarProps) {
  const [adding, setAdding] = useState<string | null>(null);
  const hosts = useMemo(() => p.members.filter((m) => p.cohostIds.includes(m.userId)), [p.members, p.cohostIds]);
  const candidates = p.members.filter((m) => !p.cohostIds.includes(m.userId));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <label className="text-label text-ink" htmlFor="poll-zone">
          {pt("wizard.timeZone")}
        </label>
        <TimeZoneSelect id="poll-zone" value={p.zone} onChange={p.onZoneChange} hour12={p.viewer.hour12} />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-label text-ink">{pt("wizard.duration")}</span>
        <DurationField value={p.duration} onChange={p.onDurationChange} disabled={Boolean(p.locked)} />
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-label text-ink">{pt("wizard.hosts")}</span>
        <ul className="flex flex-col gap-2">
          <li className="flex items-center gap-2">
            <Avatar src={p.viewer.avatarUrl} name={p.viewer.name} alt="" size="sm" />
            <span className="min-w-0 truncate text-body-md text-ink">
              {p.viewer.name} <span className="text-ink-2">{pt("common.you")}</span>
            </span>
          </li>
          {hosts.map((h) => (
            <li key={h.userId} className="flex items-center gap-2">
              <Avatar src={h.avatarUrl} name={h.name} alt="" size="sm" />
              <span className="min-w-0 flex-1 truncate text-body-md text-ink">{h.name}</span>
              {p.canRemoveCohosts && (
                <IconButton aria-label={pt("wizard.removeHost", { name: h.name })} size="sm" onClick={() => p.onCohostsChange(p.cohostIds.filter((id) => id !== h.userId))}>
                  <X aria-hidden="true" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
        {candidates.length > 0 && p.cohostIds.length < MAX_POLL_COHOSTS && (
          <Combobox
            value={adding}
            onChange={(v) => {
              setAdding(null);
              if (v && !p.cohostIds.includes(v)) p.onCohostsChange([...p.cohostIds, v]);
            }}
            options={candidates.map((m) => ({ value: m.userId, label: m.name, keywords: [m.email] }))}
            placeholder={pt("wizard.addHost")}
            searchPlaceholder={pt("wizard.addHostPlaceholder")}
            aria-label={pt("wizard.addHost")}
          />
        )}
        {p.cohostIds.length >= MAX_POLL_COHOSTS && <p className="text-body-sm text-ink-2">{pt("wizard.hostsLimit")}</p>}
      </div>
      <ul className="flex flex-col gap-1.5 text-body-sm text-ink-2" aria-label={pt("wizard.legendLabel")}>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="h-3 w-5 rounded-[3px] border border-line-medium bg-[repeating-linear-gradient(135deg,var(--mist)_0,var(--mist)_3px,var(--white)_3px,var(--white)_6px)]" />
          {pt("wizard.legendYours")}
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="h-3 w-5 rounded-[3px] border border-line-medium bg-mist" />
          {pt("wizard.legendMeetings")}
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="h-3 w-5 rounded-[3px] border border-dashed border-line-medium bg-white" />
          {pt("wizard.legendReserved")}
        </li>
        {p.overlay.hasCohostBusy && (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-5 rounded-[3px] border border-primary-soft-2 bg-info-soft" />
            {pt("wizard.legendCohosts")}
          </li>
        )}
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="h-3 w-5 rounded-[3px] border border-line bg-pebble" />
          {pt("wizard.legendOffHours")}
        </li>
      </ul>
      {p.overlay.error && <p className="text-body-sm text-warning-text">{pt("wizard.overlayError")}</p>}
      <div className="flex flex-col gap-1">
        <SelectedTimes options={p.options} zone={p.zone} hour12={p.viewer.hour12} onRemove={p.onRemove} onClear={p.onClear} locked={p.locked} />
        {p.options.length >= MAX_POLL_OPTIONS && <p className="text-body-sm text-warning-text">{pt("wizard.tooMany")}</p>}
        {p.options.length === 1 && <p className="text-body-sm text-ink-2">{pt("wizard.nextHint")}</p>}
      </div>
    </div>
  );
}
