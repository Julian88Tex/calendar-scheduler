// The wizard's details and settings (SPEC MP-03, MP-04, MP-27; research B3.2, B3.3, B14). Pure and client safe.
//
// Defaults follow MP-04 (Calendly parity): votes hidden from voters, no reserved times, Yes or No only (If need be
// off), invitees see each other in the invite (Hide invitees off), email required, no verification, no comments, no
// deadline, no limits, each voter's own time zone, instant vote notifications, smart reminders, no auto booking.
import type { LocationConfig } from "@/db/types";
import type { NotifyMode, PollSettingsView, PollVisibility, ReminderMode, ReminderOffset, TimeZoneMode } from "@/lib/polls/types";
import type { CreatePollInput, UpdatePollInput } from "@/lib/polls/validation";
import { localDateOf, localMinutesOf, wallClockToUtc } from "@/lib/time/luxon";

export type ReminderRow = { kind: ReminderOffset["kind"]; amount: number; unit: "hours" | "days" };

export type SettingsState = {
  resultsVisibility: PollVisibility;
  reserveTimes: boolean;
  allowIfNeedBe: boolean;
  hideInvitees: boolean;
  requireEmail: boolean;
  verifyEmail: boolean;
  allowComments: boolean;
  deadline: { enabled: boolean; date: string | null; minutes: number | null };
  maxVotes: { enabled: boolean; value: number };
  maxChoices: { enabled: boolean; value: number };
  timeZoneMode: TimeZoneMode;
  notifyMode: NotifyMode;
  reminderMode: ReminderMode;
  reminders: ReminderRow[];
  autoBook: boolean;
};

export type DetailsState = {
  title: string;
  descriptionHtml: string;
  location: LocationConfig | null;
  settings: SettingsState;
};

export const DEFAULT_SETTINGS: SettingsState = {
  resultsVisibility: "host_only",
  reserveTimes: false,
  allowIfNeedBe: false,
  hideInvitees: false,
  requireEmail: true,
  verifyEmail: false,
  allowComments: false,
  deadline: { enabled: false, date: null, minutes: 17 * 60 },
  maxVotes: { enabled: false, value: 1 },
  maxChoices: { enabled: false, value: 1 },
  timeZoneMode: "auto",
  notifyMode: "instant",
  reminderMode: "smart",
  reminders: [{ kind: "before_deadline", amount: 1, unit: "days" }],
  autoBook: false,
};

export function emptyDetails(): DetailsState {
  return { title: "", descriptionHtml: "", location: null, settings: { ...DEFAULT_SETTINGS, deadline: { ...DEFAULT_SETTINGS.deadline }, maxVotes: { ...DEFAULT_SETTINGS.maxVotes }, maxChoices: { ...DEFAULT_SETTINGS.maxChoices }, reminders: [...DEFAULT_SETTINGS.reminders] } };
}

const UNIT_MINUTES = { hours: 60, days: 24 * 60 } as const;

export function reminderRows(offsets: readonly ReminderOffset[]): ReminderRow[] {
  return offsets.map((o) =>
    o.minutes % UNIT_MINUTES.days === 0 ? { kind: o.kind, amount: o.minutes / UNIT_MINUTES.days, unit: "days" } : { kind: o.kind, amount: Math.max(1, Math.round(o.minutes / 60)), unit: "hours" },
  );
}

export function reminderOffsets(rows: readonly ReminderRow[]): ReminderOffset[] {
  return rows.filter((r) => Number.isFinite(r.amount) && r.amount > 0).map((r) => ({ kind: r.kind, minutes: Math.round(r.amount * UNIT_MINUTES[r.unit]) }));
}

/** The settings of a published poll as wizard state (deadline shown in the poll zone). */
export function settingsFromView(s: PollSettingsView): SettingsState {
  return {
    resultsVisibility: s.resultsVisibility,
    reserveTimes: s.reserveTimes,
    allowIfNeedBe: s.allowIfNeedBe,
    hideInvitees: s.hideInvitees,
    requireEmail: s.requireEmail,
    verifyEmail: s.verifyEmail,
    allowComments: s.allowComments,
    deadline: s.deadline
      ? { enabled: true, date: localDateOf(s.deadline, s.timezone), minutes: localMinutesOf(s.deadline, s.timezone) }
      : { enabled: false, date: null, minutes: 17 * 60 },
    maxVotes: { enabled: s.maxVotesPerOption !== null, value: s.maxVotesPerOption ?? 1 },
    maxChoices: { enabled: s.maxChoicesPerParticipant !== null, value: s.maxChoicesPerParticipant ?? 1 },
    timeZoneMode: s.timeZoneMode,
    notifyMode: s.notifyMode,
    reminderMode: s.reminderMode,
    reminders: s.reminderOffsets.length ? reminderRows(s.reminderOffsets) : [...DEFAULT_SETTINGS.reminders],
    autoBook: s.autoBook,
  };
}

/** The deadline instant (ISO) of the settings in `zone`, or null; "invalid" when enabled but incomplete. */
export function deadlineIso(s: SettingsState, zone: string): string | null | "invalid" {
  if (!s.deadline.enabled) return null;
  if (!s.deadline.date || s.deadline.minutes === null) return "invalid";
  return wallClockToUtc(s.deadline.date, s.deadline.minutes, zone).toISOString();
}

type SettingsPayload = Pick<
  CreatePollInput,
  | "resultsVisibility"
  | "reserveTimes"
  | "allowIfNeedBe"
  | "hideInvitees"
  | "requireEmail"
  | "verifyEmail"
  | "allowComments"
  | "deadline"
  | "maxVotesPerOption"
  | "maxChoicesPerParticipant"
  | "timeZoneMode"
  | "notifyMode"
  | "reminderMode"
  | "reminderOffsets"
  | "autoBook"
>;

/** The service fields of the settings (verify email implies require email). */
export function settingsPayload(s: SettingsState, zone: string): SettingsPayload {
  const deadline = deadlineIso(s, zone);
  return {
    resultsVisibility: s.resultsVisibility,
    reserveTimes: s.reserveTimes,
    allowIfNeedBe: s.allowIfNeedBe,
    hideInvitees: s.hideInvitees,
    requireEmail: s.verifyEmail ? true : s.requireEmail,
    verifyEmail: s.verifyEmail,
    allowComments: s.allowComments,
    deadline: deadline === "invalid" ? null : deadline,
    maxVotesPerOption: s.maxVotes.enabled ? Math.max(1, Math.floor(s.maxVotes.value)) : null,
    maxChoicesPerParticipant: s.maxChoices.enabled ? Math.max(1, Math.floor(s.maxChoices.value)) : null,
    timeZoneMode: s.timeZoneMode,
    notifyMode: s.notifyMode,
    reminderMode: s.reminderMode,
    reminderOffsets: s.reminderMode === "custom" ? reminderOffsets(s.reminders) : [],
    autoBook: s.autoBook,
  };
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * The fields of an edit that changed (MP-27): only those are sent, so a booked poll's unchanged settings never trip
 * "Reopen the poll to change this setting.".
 */
export function updatePatch(
  initial: { title: string; descriptionHtml: string | null; location: LocationConfig | null; timezone: string; defaultDurationMinutes: number; settings: PollSettingsView; cohostIds: string[] },
  next: { details: DetailsState; timezone: string; defaultDurationMinutes: number; cohostIds: string[] },
): Omit<UpdatePollInput, "pollId"> {
  const patch: Omit<UpdatePollInput, "pollId"> = {};
  const d = next.details;
  if (d.title.trim() !== initial.title) patch.title = d.title.trim();
  const desc = d.descriptionHtml.trim() ? d.descriptionHtml : null;
  if (!same(desc, initial.descriptionHtml)) patch.descriptionHtml = desc;
  if (!same(d.location, initial.location)) patch.location = d.location;
  if (next.timezone !== initial.timezone) patch.timezone = next.timezone;
  if (next.defaultDurationMinutes !== initial.defaultDurationMinutes) patch.defaultDurationMinutes = next.defaultDurationMinutes;
  const before = settingsPayload(settingsFromView(initial.settings), initial.timezone);
  const after = settingsPayload(d.settings, next.timezone);
  // The deadline fields are wall time in the poll zone the form names ("Deadline in {zone}"): unchanged fields in the same
  // zone send nothing; after a zone change they mean that wall time in the new zone, exactly as shown.
  const initialDeadline = initial.settings.deadline;
  const keys = Object.keys(after) as (keyof SettingsPayload)[];
  for (const k of keys) {
    if (k === "deadline") {
      const unchanged =
        d.settings.deadline.enabled === Boolean(initialDeadline) &&
        (after.deadline === before.deadline || Boolean(after.deadline && initialDeadline && new Date(after.deadline).getTime() === new Date(initialDeadline).getTime()));
      if (!unchanged) patch.deadline = after.deadline ?? null;
      continue;
    }
    if (k === "reminderOffsets" && after.reminderMode !== "custom" && before.reminderMode !== "custom") continue;
    if (!same(after[k], before[k])) (patch as Record<string, unknown>)[k] = after[k];
  }
  const a = [...next.cohostIds].sort();
  const b = [...initial.cohostIds].sort();
  if (!same(a, b)) patch.coHostIds = next.cohostIds;
  return patch;
}

/** Fields inside "More settings": an error on one of them opens the section so the message is visible. */
const MORE_FIELDS = new Set([
  "resultsVisibility",
  "allowIfNeedBe",
  "hideInvitees",
  "requireEmail",
  "verifyEmail",
  "allowComments",
  "deadline",
  "maxVotesPerOption",
  "maxChoicesPerParticipant",
  "timeZoneMode",
  "notifyMode",
  "reminderMode",
  "reminderOffsets",
  "autoBook",
]);

export function errorInMoreSettings(errors: Record<string, string[]>): boolean {
  return Object.entries(errors).some(([k, v]) => MORE_FIELDS.has(k.split(".")[0]!) && Boolean(v?.length));
}
