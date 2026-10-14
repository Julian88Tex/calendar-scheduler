// The proposed times of the create and edit wizard (SPEC MP-02, MP-27). Pure and client safe.
//
// Timed options are absolute instants (epoch ms); all-day options are a local date shown the same for everyone.
// Existing options of a published poll carry their id; started ones are frozen (MP-27: past options can't change).
// Exact duplicates toggle instead of adding (MP-02).
import { MAX_OPTION_MINUTES, MAX_POLL_OPTIONS, MIN_OPTION_MINUTES } from "@/lib/polls/constants";
import { dayStart } from "@/lib/polls/grid";
import type { PollOptionInput, PollOptionView } from "@/lib/polls/types";

export type DraftOption =
  | { kind: "timed"; key: string; start: number; end: number; id?: string; frozen?: boolean }
  | { kind: "date"; key: string; date: string; id?: string; frozen?: boolean };

export function timedKey(start: number, end: number): string {
  return `t:${start}:${end}`;
}

export function dateKey(date: string): string {
  return `d:${date}`;
}

export function timed(start: number, end: number): DraftOption {
  return { kind: "timed", key: timedKey(start, end), start, end };
}

export function allDay(date: string): DraftOption {
  return { kind: "date", key: dateKey(date), date };
}

/** A timed option lasts 5 minutes to 24 hours (MP-02); date-only options always qualify. */
export function durationInRange(o: DraftOption): boolean {
  if (o.kind === "date") return true;
  const minutes = (o.end - o.start) / 60_000;
  return Number.isInteger(minutes) && minutes >= MIN_OPTION_MINUTES && minutes <= MAX_OPTION_MINUTES;
}

/** Epoch ms when an option starts (all-day: local midnight in `zone`). */
export function startMs(o: DraftOption, zone: string): number {
  return o.kind === "timed" ? o.start : dayStart(o.date, zone);
}

/** Chronological order (all-day options at local midnight of their date). */
export function sortOptions(list: readonly DraftOption[], zone: string): DraftOption[] {
  return [...list].sort((a, b) => startMs(a, zone) - startMs(b, zone) || (a.kind === "date" ? -1 : 1) - (b.kind === "date" ? -1 : 1));
}

export type ToggleResult = { list: DraftOption[]; change: "added" | "removed" | "full" | "frozen" | "none" };

/** Adds the option, or removes it when the exact same time is already selected (MP-02 toggle). */
export function toggleOption(list: readonly DraftOption[], option: DraftOption): ToggleResult {
  const existing = list.find((o) => o.key === option.key);
  if (existing) {
    if (existing.frozen) return { list: [...list], change: "frozen" };
    return { list: list.filter((o) => o.key !== option.key), change: "removed" };
  }
  if (list.length >= MAX_POLL_OPTIONS) return { list: [...list], change: "full" };
  return { list: [...list, option], change: "added" };
}

/** Adds every option that is not selected yet (up to the 100 cap); returns how many were added. */
export function addOptions(list: readonly DraftOption[], options: readonly DraftOption[]): { list: DraftOption[]; added: number; full: boolean } {
  const out = [...list];
  const keys = new Set(out.map((o) => o.key));
  let added = 0;
  let full = false;
  for (const o of options) {
    if (keys.has(o.key)) continue;
    if (out.length >= MAX_POLL_OPTIONS) {
      full = true;
      break;
    }
    out.push(o);
    keys.add(o.key);
    added++;
  }
  return { list: out, added, full };
}

/** Replaces an option (move or resize of a new option); an exact duplicate of another option is merged into it. */
export function replaceOption(list: readonly DraftOption[], key: string, next: DraftOption): DraftOption[] {
  const without = list.filter((o) => o.key !== key);
  if (without.some((o) => o.key === next.key)) return without;
  const at = list.findIndex((o) => o.key === key);
  const out = [...without];
  out.splice(at < 0 ? out.length : at, 0, next);
  return out;
}

/** The service input of new options. */
export function toInput(o: DraftOption): PollOptionInput {
  return o.kind === "timed" ? { start: new Date(o.start).toISOString(), end: new Date(o.end).toISOString() } : { date: o.date };
}

/** The wizard options of a published poll (edit page): ids kept, started options frozen. */
export function fromViews(options: readonly Pick<PollOptionView, "id" | "start" | "end" | "allDayDate" | "isPast">[]): DraftOption[] {
  return options.map((o) => {
    if (o.allDayDate) return { kind: "date", key: dateKey(o.allDayDate), date: o.allDayDate, id: o.id, frozen: o.isPast };
    const s = new Date(o.start!).getTime();
    const e = new Date(o.end!).getTime();
    return { kind: "timed", key: timedKey(s, e), start: s, end: e, id: o.id, frozen: o.isPast };
  });
}

/**
 * Edit page changes: removed existing option ids and the new options. A published time that was removed and then put
 * back (same start and end, or the same date) is neither removed nor added, so it keeps its id and its votes.
 */
export function diffOptions(initial: readonly DraftOption[], current: readonly DraftOption[]): { removedIds: string[]; added: DraftOption[] } {
  const currentIds = new Set(current.map((o) => o.id).filter(Boolean));
  const removed = initial.filter((o) => o.id && !currentIds.has(o.id));
  const fresh = current.filter((o) => !o.id);
  const restored = new Set(fresh.filter((o) => removed.some((r) => r.key === o.key)).map((o) => o.key));
  return { removedIds: removed.filter((o) => !restored.has(o.key)).map((o) => o.id!), added: fresh.filter((o) => !restored.has(o.key)) };
}

export type SaveStep = { kind: "remove"; ids: string[] } | { kind: "add"; options: DraftOption[] };

/**
 * The order of the option writes of an edit (MP-27): a poll always keeps at least one time and never holds more than
 * `max`. Removals go first (they free room under the cap); when every published time is replaced, one removal waits
 * until the first new times exist, and new times beyond the cap wait for that removal.
 */
export function planOptionSave(p: { initialCount: number; removedIds: readonly string[]; added: readonly DraftOption[]; max?: number }): SaveStep[] {
  const max = p.max ?? MAX_POLL_OPTIONS;
  const steps: SaveStep[] = [];
  const removed = [...p.removedIds];
  const added = [...p.added];
  const remaining = p.initialCount - removed.length;
  if (remaining >= 1 || !added.length) {
    if (removed.length) steps.push({ kind: "remove", ids: removed });
    if (added.length) steps.push({ kind: "add", options: added });
    return steps;
  }
  const held = removed.pop()!;
  if (removed.length) steps.push({ kind: "remove", ids: removed });
  const room = Math.max(1, max - 1);
  steps.push({ kind: "add", options: added.slice(0, room) });
  steps.push({ kind: "remove", ids: [held] });
  if (added.length > room) steps.push({ kind: "add", options: added.slice(room) });
  return steps;
}

/**
 * The ids the server gave the times of an "add" step, by option key: it inserts the sent times in order, skipping
 * exact duplicates and times the poll already has (`existingKeys`).
 */
export function savedIdsByKey(sent: readonly DraftOption[], ids: readonly string[], existingKeys: ReadonlySet<string>): Map<string, string> {
  const seen = new Set<string>();
  const fresh: string[] = [];
  for (const o of sent) {
    if (existingKeys.has(o.key) || seen.has(o.key)) continue;
    seen.add(o.key);
    fresh.push(o.key);
  }
  const out = new Map<string, string>();
  fresh.forEach((key, i) => {
    const id = ids[i];
    if (id) out.set(key, id);
  });
  return out;
}

/** Options that are not in the past (new options must start in the future). */
export function dropPast(list: readonly DraftOption[], zone: string, now: number): DraftOption[] {
  return list.filter((o) => o.id || startMs(o, zone) > now);
}

/** Overlap test against busy intervals (amber outline "Overlaps '{title}'"). */
export function overlapping<T extends { start: number; end: number }>(o: { start: number; end: number }, busy: readonly T[]): T | null {
  return busy.find((b) => b.start < o.end && o.start < b.end) ?? null;
}
