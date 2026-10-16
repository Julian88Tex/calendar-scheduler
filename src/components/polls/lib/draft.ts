// Unsent poll draft in localStorage (SPEC MP-02 "Draft persisted in localStorage until shared"; research B3): the picked
// times and the details typed so far, per signed-in user, so a refresh or a detour does not lose them. Wrapped in
// try/catch (blocked storage in private windows and sandboxed frames). Client only at call time; pure parsing helpers.
import type { LocationConfig } from "@/db/types";
import { isValidTimeZone } from "@/lib/time/zones";
import { allDay, dropPast, timed, type DraftOption } from "./options";

const KEY = "kairos:poll-draft:v1";
const MAX_AGE_MS = 30 * 86_400_000;

export type DurationChoice = { kind: "minutes"; minutes: number } | { kind: "all_day" };

export type StoredDraft = {
  userId: string;
  savedAt: number;
  timezone: string;
  duration: DurationChoice;
  options: ({ start: number; end: number } | { date: string })[];
  title: string;
  descriptionHtml: string;
  location: LocationConfig | null;
  settings: Record<string, unknown>;
};

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Parses a stored draft (null when missing, malformed, another user's, or older than 30 days). */
export function parseDraft(raw: string | null, userId: string, now: number): StoredDraft | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredDraft>;
    if (!v || v.userId !== userId || typeof v.savedAt !== "number" || now - v.savedAt > MAX_AGE_MS) return null;
    if (typeof v.timezone !== "string" || !isValidTimeZone(v.timezone)) return null;
    const duration: DurationChoice =
      v.duration && v.duration.kind === "all_day"
        ? { kind: "all_day" }
        : v.duration && v.duration.kind === "minutes" && Number.isInteger(v.duration.minutes) && v.duration.minutes >= 5 && v.duration.minutes <= 1440
          ? { kind: "minutes", minutes: v.duration.minutes }
          : { kind: "minutes", minutes: 30 };
    const options = Array.isArray(v.options)
      ? v.options.filter(
          (o): o is { start: number; end: number } | { date: string } =>
            Boolean(o) &&
            typeof o === "object" &&
            (("date" in o && typeof o.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) ||
              ("start" in o && typeof o.start === "number" && typeof (o as { end?: unknown }).end === "number" && (o as { end: number }).end > o.start)),
        )
      : [];
    return {
      userId,
      savedAt: v.savedAt,
      timezone: v.timezone,
      duration,
      options: options.slice(0, 100),
      title: typeof v.title === "string" ? v.title.slice(0, 100) : "",
      descriptionHtml: typeof v.descriptionHtml === "string" ? v.descriptionHtml.slice(0, 16_000) : "",
      location: v.location && typeof v.location === "object" ? (v.location as LocationConfig) : null,
      settings: v.settings && typeof v.settings === "object" ? (v.settings as Record<string, unknown>) : {},
    };
  } catch {
    return null;
  }
}

/** The draft's options as wizard options, without the ones that started meanwhile. */
export function draftOptions(d: StoredDraft, now: number): DraftOption[] {
  const list = d.options.map((o) => ("date" in o ? allDay(o.date) : timed(o.start, o.end)));
  return dropPast(list, d.timezone, now);
}

export function readDraft(userId: string, now: number): StoredDraft | null {
  try {
    return parseDraft(storage()?.getItem(KEY) ?? null, userId, now);
  } catch {
    return null;
  }
}

export function writeDraft(d: StoredDraft): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(d));
  } catch {
    // quota or blocked storage: the draft lasts for this page only
  }
}

export function clearDraft(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** The stored shape of wizard options. */
export function storedOptions(list: readonly DraftOption[]): StoredDraft["options"] {
  return list.filter((o) => !o.id).map((o) => (o.kind === "date" ? { date: o.date } : { start: o.start, end: o.end }));
}
