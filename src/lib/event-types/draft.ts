// Pure helpers of the event type editor (SPEC ET-14 to ET-33, ARCHITECTURE 17.1): ET-33 defaults, row to draft
// conversion, draft comparisons (dirty state, availability changes), section summaries and the live preview draft.
// Client and server safe: no I/O, no clock.
import type { EventTypePreviewDraft, LocationConfig } from "@/db/types";
import type { eventTypeQuestions, eventTypes } from "@/db/schema";
import { LOCATION_KIND_LABELS } from "@/components/event-types/location-labels";
import { weeklySummary, type ScheduleContent } from "@/lib/availability/intervals";
import { formatDuration } from "@/lib/time/format";
import { DEFAULT_QUESTION_LABEL, LOCATION_TEXT_MAX, NOTICE_MAX_MINUTES } from "./constants";
import type { EditorScheduleOption, EventTypeDraft, QuestionDraft, ScheduleChoiceDraft } from "./types";

type EventTypeRow = typeof eventTypes.$inferSelect;
type QuestionRow = typeof eventTypeQuestions.$inferSelect;

/** ET-33 default question ("Multiple lines", optional, on). */
export function defaultQuestion(id: string): QuestionDraft {
  return {
    id,
    label: DEFAULT_QUESTION_LABEL,
    type: "text",
    required: false,
    enabled: true,
    answerChoices: [],
    includeOther: false,
  };
}

/** The ET-33 defaults of a new one-on-one event type as an editor draft. */
export function defaultDraft(p: {
  name: string;
  color: string;
  scheduleId: string | null;
  questionId: string;
  /** VID-15: the profile's default location (copied with a fresh id). */
  defaultLocation?: LocationConfig | null;
  locationId?: string;
}): EventTypeDraft {
  const locations: LocationConfig[] = p.defaultLocation && p.locationId ? [{ ...p.defaultLocation, id: p.locationId, position: 0 }] : [];
  return {
    name: p.name,
    color: p.color,
    slug: "",
    descriptionHtml: "",
    durations: [30],
    locations,
    schedule: { kind: "schedule", scheduleId: p.scheduleId },
    dateRange: { type: "rolling", days: 60, mode: "calendar_days", start: null, end: null },
    minimumNoticeMinutes: 240,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    slotIncrementMinutes: 30,
    limitPerDay: null,
    limitPerWeek: null,
    limitPerMonth: null,
    timeZoneDisplay: "auto",
    lockedTimeZone: null,
    destinationCalendarId: null,
    nameFormat: "full",
    allowGuests: true,
    questions: [defaultQuestion(p.questionId)],
    notificationType: "auto",
    notificationTemplates: {},
    includeCancelRescheduleLinks: true,
    includeAnswersInNotifications: true,
    cancellationPolicy: "",
    afterBooking: "confirmation_page",
    redirectUrl: "",
    redirectPassDetails: false,
    scheduleAnotherEnabled: true,
    scheduleAnotherLabel: "Schedule another event",
    confirmationLinks: [],
    secret: false,
    internalNote: "",
  };
}

/** Durations of a row, default first then the other options ascending (ET-16). */
export function durationsOf(row: Pick<EventTypeRow, "durationMinutes" | "durationOptions">): number[] {
  const options = (row.durationOptions ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 720);
  const rest = [...new Set(options)].filter((d) => d !== row.durationMinutes).sort((a, b) => a - b);
  return [row.durationMinutes, ...rest];
}

/** durations[0] is the default; the stored options include it, ascending, or null for a single duration. */
export function durationColumns(durations: readonly number[]): { durationMinutes: number; durationOptions: number[] | null } {
  const durationMinutes = durations[0] ?? 30;
  const unique = [...new Set(durations)];
  return { durationMinutes, durationOptions: unique.length > 1 ? [...unique].sort((a, b) => a - b) : null };
}

/** A question row as a draft question. */
export function questionDraftOf(q: Pick<QuestionRow, "id" | "label" | "type" | "required" | "enabled" | "answerChoices" | "includeOther">): QuestionDraft {
  return {
    id: q.id,
    label: q.label,
    type: q.type,
    required: q.required,
    enabled: q.enabled,
    answerChoices: [...(q.answerChoices ?? [])],
    includeOther: q.includeOther,
  };
}

/** Locations sorted by position with positions renumbered. */
export function sortedLocations(list: readonly LocationConfig[] | null | undefined): LocationConfig[] {
  return [...(list ?? [])]
    .filter((l): l is LocationConfig => Boolean(l && typeof l === "object" && typeof l.id === "string" && typeof l.kind === "string"))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((l, i) => ({ ...l, position: i }));
}

/** An event type row (plus questions and its schedule choice) as the editor draft. */
export function draftOfRow(row: EventTypeRow, questions: readonly QuestionRow[], schedule: ScheduleChoiceDraft): EventTypeDraft {
  return {
    name: row.name,
    color: row.color,
    slug: row.slug,
    descriptionHtml: row.descriptionHtml ?? "",
    durations: durationsOf(row),
    locations: sortedLocations(row.locations),
    schedule,
    dateRange: {
      type: row.dateRangeType,
      days: row.dateRangeDays,
      mode: row.dateRangeMode,
      start: row.dateRangeStart,
      end: row.dateRangeEnd,
    },
    minimumNoticeMinutes: row.minimumNoticeMinutes,
    bufferBeforeMinutes: row.bufferBeforeMinutes,
    bufferAfterMinutes: row.bufferAfterMinutes,
    slotIncrementMinutes: row.slotIncrementMinutes,
    limitPerDay: row.limitPerDay,
    limitPerWeek: row.limitPerWeek,
    limitPerMonth: row.limitPerMonth,
    timeZoneDisplay: row.timeZoneDisplay,
    lockedTimeZone: row.lockedTimeZone,
    destinationCalendarId: row.destinationCalendarId,
    nameFormat: row.nameFormat,
    allowGuests: row.allowGuests,
    questions: [...questions].sort((a, b) => a.position - b.position).map(questionDraftOf),
    notificationType: row.notificationType,
    notificationTemplates: { ...(row.notificationTemplates ?? {}) },
    includeCancelRescheduleLinks: row.includeCancelRescheduleLinks,
    includeAnswersInNotifications: row.includeAnswersInNotifications,
    cancellationPolicy: row.cancellationPolicy ?? "",
    afterBooking: row.afterBooking,
    redirectUrl: row.redirectUrl ?? "",
    redirectPassDetails: row.redirectPassDetails,
    scheduleAnotherEnabled: row.scheduleAnotherEnabled,
    scheduleAnotherLabel: row.scheduleAnotherLabel,
    confirmationLinks: (row.confirmationLinks ?? []).map((l) => ({ label: l.label, url: l.url })),
    secret: row.secret,
    internalNote: row.internalNote ?? "",
  };
}

function stable(value: unknown): unknown {
  // JSON turns NaN into null: keep invalid number input (NaN in the draft) distinct from "no value" so the editor sees
  // the change, enables "Save changes" and reports the field error instead of looking clean.
  if (typeof value === "number" && !Number.isFinite(value)) return `__${String(value)}__`;
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = stable(v);
    }
    return out;
  }
  return value;
}

/** Canonical JSON (sorted keys, undefined dropped) for comparisons. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(stable(value));
}

/** True when two drafts hold the same values (the editor's dirty state, ET-14). */
export function draftsEqual(a: EventTypeDraft, b: EventTypeDraft): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** cyrb53: a fast, well distributed 53-bit string hash (not cryptographic; collisions only cause a missed conflict). */
function hash53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * The editor's optimistic concurrency token (ET-14): a hash of the saved draft, so only changes to what the editor
 * shows and saves make a stale save fail. Toggling On/Off, reordering the list or other row updates that bump
 * updated_at no longer reject the owner's unsaved edits as "changed in another window". Custom schedule content is
 * normalized (overrides by date, intervals by start) so equal content always hashes the same.
 */
export function draftVersion(draft: EventTypeDraft): string {
  const schedule =
    draft.schedule.kind === "custom"
      ? {
          kind: "custom",
          content: {
            timezone: draft.schedule.content.timezone,
            weeklyHours: draft.schedule.content.weeklyHours.map((d) => [...d].sort((a, b) => a.start - b.start || a.end - b.end)),
            overrides: [...draft.schedule.content.overrides]
              .map((o) => ({ date: o.date, intervals: [...o.intervals].sort((a, b) => a.start - b.start || a.end - b.end) }))
              .sort((a, b) => a.date.localeCompare(b.date)),
          },
        }
      : draft.schedule;
  const text = canonicalJson({ ...draft, schedule });
  return `d1-${hash53(text).toString(36)}-${hash53(text, 7).toString(36)}`;
}

/** True when settings that drive the preview's real availability changed (ET-29 "Save to update availability"). */
export function availabilityChanged(a: EventTypeDraft, b: EventTypeDraft): boolean {
  const pick = (d: EventTypeDraft) => ({
    schedule: d.schedule,
    dateRange: d.dateRange,
    minimumNoticeMinutes: d.minimumNoticeMinutes,
    bufferBeforeMinutes: d.bufferBeforeMinutes,
    bufferAfterMinutes: d.bufferAfterMinutes,
    slotIncrementMinutes: d.slotIncrementMinutes,
    limitPerDay: d.limitPerDay,
    limitPerWeek: d.limitPerWeek,
    limitPerMonth: d.limitPerMonth,
  });
  return canonicalJson(pick(a)) !== canonicalJson(pick(b));
}

/** The draft fields the booking page preview renders (ARCHITECTURE 17.1). */
export function previewDraftOf(draft: EventTypeDraft, kind: "solo" | "group" = "solo", maxInvitees = 1): EventTypePreviewDraft {
  const { durationMinutes, durationOptions } = durationColumns(draft.durations);
  return {
    name: draft.name,
    color: draft.color,
    durationMinutes,
    durationOptions,
    locations: draft.locations.map((l, i) => ({ ...l, position: i })),
    descriptionHtml: draft.descriptionHtml || null,
    priceMinor: null,
    currency: null,
    kind,
    maxInvitees,
    showRemainingSpots: false,
    timeZoneDisplay: draft.timeZoneDisplay,
    lockedTimeZone: draft.timeZoneDisplay === "locked" ? draft.lockedTimeZone : null,
  };
}

// Summaries (collapsed section rows, ET-14) ---------------------------------------------------------------------

/** "30 min" or "30 min, 60 min" (default first). */
export function durationSummary(durations: readonly number[]): string {
  return durations.map(formatDuration).join(", ");
}

/** ET-17: "No location given" or the kind names joined with commas ("In-person meeting (8), Ask invitee"). */
export function locationSummary(locations: readonly LocationConfig[]): string {
  if (!locations.length) return "No location given";
  const counts = new Map<string, number>();
  for (const l of locations) {
    const label = LOCATION_KIND_LABELS[l.kind] ?? l.kind;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, n]) => (n > 1 ? `${label} (${n})` : label)).join(", ");
}

/** The schedule content a draft choice resolves to (the named schedule's, or the custom content). */
export function scheduleContentOf(choice: ScheduleChoiceDraft, schedules: readonly EditorScheduleOption[]): ScheduleContent | null {
  if (choice.kind === "custom") return choice.content;
  const s = schedules.find((x) => x.id === choice.scheduleId) ?? schedules.find((x) => x.isDefault) ?? null;
  return s?.content ?? null;
}

/** ET-19: "Weekdays, 9 am - 5 pm" or "Hours vary". */
export function availabilitySummary(
  choice: ScheduleChoiceDraft,
  schedules: readonly EditorScheduleOption[],
  hour12 = true,
  weekStart: 0 | 1 = 0,
): string {
  const content = scheduleContentOf(choice, schedules);
  return content ? weeklySummary(content.weeklyHours, hour12, weekStart) : "No schedule";
}

/** The whole number typed in `text` when it lies in [min, max], else null (the editor's number inputs). */
export function wholeNumberIn(text: string, min: number, max: number): number | null {
  if (!text.trim()) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/** Minutes of a typed notice amount in a unit of `factor` minutes, or null when invalid (SCH-06: 0 to 365 days). */
export function noticeMinutesOf(text: string, factor: number): number | null {
  if (!text.trim()) return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  const minutes = Math.round(n * factor * 1e6) / 1e6;
  return Number.isInteger(minutes) && minutes <= NOTICE_MAX_MINUTES ? minutes : null;
}

/** "4 hours", "1 day", "30 minutes" (the notice dropdown text). */
export function noticeText(minutes: number): string {
  const unit = noticeUnitOf(minutes);
  const n = unit === "days" ? minutes / 1440 : unit === "hours" ? minutes / 60 : minutes;
  const word = unit === "days" ? "day" : unit === "hours" ? "hour" : "minute";
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The largest unit that divides the notice exactly. */
export function noticeUnitOf(minutes: number): "minutes" | "hours" | "days" {
  if (minutes > 0 && minutes % 1440 === 0) return "days";
  if (minutes > 0 && minutes % 60 === 0) return "hours";
  return "minutes";
}

/** "60 days", "10 week days", "5 days with availability" (the date range dropdown text for rolling ranges). */
export function rollingRangeText(days: number, mode: EventTypeDraft["dateRange"]["mode"]): string {
  const n = days.toLocaleString("en-US");
  if (mode === "weekdays") return `${n} week ${days === 1 ? "day" : "days"}`;
  if (mode === "available_days") return `${n} ${days === 1 ? "day" : "days"} with availability`;
  return `${n} ${days === 1 ? "day" : "days"}`;
}

/** ET-21 summary: "15 min before, 15 min after, max 3 per day" or "No buffers or limits". */
export function limitsSummary(d: Pick<EventTypeDraft, "bufferBeforeMinutes" | "bufferAfterMinutes" | "limitPerDay" | "limitPerWeek" | "limitPerMonth">): string {
  const parts: string[] = [];
  if (d.bufferBeforeMinutes) parts.push(`${formatDuration(d.bufferBeforeMinutes)} before`);
  if (d.bufferAfterMinutes) parts.push(`${formatDuration(d.bufferAfterMinutes)} after`);
  const limits: string[] = [];
  if (d.limitPerDay) limits.push(`${d.limitPerDay} per day`);
  if (d.limitPerWeek) limits.push(`${d.limitPerWeek} per week`);
  if (d.limitPerMonth) limits.push(`${d.limitPerMonth} per month`);
  if (limits.length) parts.push(`max ${limits.join(", ")}`);
  return parts.length ? parts.join(", ") : "No buffers or limits";
}

/** ET-25 summary: the confirmation kind plus the reminders that are on ("Email confirmation, email reminders"). */
export function notificationsSummary(
  mode: "calendar_invitation" | "email_confirmation",
  reminders: { invitee: { enabled: boolean }; host: { enabled: boolean } } | null | undefined,
): string {
  const parts = [mode === "calendar_invitation" ? "Calendar invitation" : "Email confirmation"];
  if (reminders?.invitee.enabled) parts.push("email reminders");
  if (reminders?.host.enabled) parts.push("host reminders");
  return parts.join(", ");
}

/** ET-24 summary: "Name, Email, Guests, 1 question". */
export function inviteeFormSummary(d: Pick<EventTypeDraft, "nameFormat" | "allowGuests" | "questions">, kind: "solo" | "group" = "solo"): string {
  const parts = [d.nameFormat === "first_last" ? "First and last name" : "Name", "Email"];
  if (d.allowGuests && kind !== "group") parts.push("Guests");
  const n = d.questions.length;
  if (n) parts.push(`${n} ${n === 1 ? "question" : "questions"}`);
  return parts.join(", ");
}

/** The first line of a location text (venue name), shortened for rows. */
export function locationTitle(l: LocationConfig): string {
  const first = (l.location ?? "").split("\n")[0]?.trim();
  if (l.kind === "physical" && first) return first.slice(0, LOCATION_TEXT_MAX);
  return LOCATION_KIND_LABELS[l.kind] ?? l.kind;
}

/** Plain text of description HTML for summaries (no markup, entities decoded, whitespace collapsed). */
export function htmlSummary(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/h[1-6])[^>]*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Copy of" naming for duplicates (ET-11): "{Name} (copy)", fitted to the 100 character limit. */
export function copyName(name: string, max = 100): string {
  const suffix = " (copy)";
  return `${name.trim().slice(0, max - suffix.length).trimEnd()}${suffix}`;
}

/** ET-11 duplicate slugs: "{slug}-copy", then "{slug}-copy-2", "-copy-3", ... (fitted to 100 characters). */
export function copySlugCandidates(slug: string, count = 50): string[] {
  const out: string[] = [];
  for (let n = 1; n <= count; n++) {
    const suffix = n === 1 ? "-copy" : `-copy-${n}`;
    out.push(`${slug.slice(0, 100 - suffix.length).replace(/-+$/, "")}${suffix}`);
  }
  return out;
}

/** ET-15 slug de-duplication: "{base}", "{base}-2", "{base}-3", ... the first not in `taken`. */
export function dedupeSlug(base: string, taken: ReadonlySet<string>): string {
  const root = base || "meeting";
  if (!taken.has(root)) return root;
  for (let n = 2; n < 10_000; n++) {
    const suffix = `-${n}`;
    const candidate = `${root.slice(0, 100 - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root.slice(0, 80)}-${Date.now().toString(36)}`;
}
