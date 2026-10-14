// Meeting poll input schemas and limit checks (SPEC MP-02, MP-04, MP-06, MP-09, MP-14, MP-27, MP-30; research
// meeting-polls.md B16). Pure and client safe (zod only): the services parse with these schemas and polls-ui reuses
// them for inline form errors. Messages are user-facing copy (GEN-11).
import { z } from "zod";
import type { LocationConfig, LocationKind } from "@/db/types";
import { isReservedSlug } from "@/lib/slugs";
import { zEmail, zIsoDate, zLocationConfig, zTimeZone } from "@/lib/validation";
import {
  MAX_BOOKING_MESSAGE_LENGTH,
  MAX_COMMENT_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_INVITE_MESSAGE_LENGTH,
  MAX_INVITE_SUBJECT_LENGTH,
  MAX_INVITES_PER_SEND,
  MAX_NAME_LENGTH,
  MAX_OPTION_MINUTES,
  MAX_POLL_COHOSTS,
  MAX_POLL_OPTIONS,
  MAX_TITLE_LENGTH,
  MAX_VOTES_PER_OPTION_LIMIT,
  MIN_OPTION_MINUTES,
  OPTION_HORIZON_DAYS,
  POLL_ERRORS,
  POLL_SLUG_PATTERN,
} from "./constants";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

/** Location kinds a poll may use (MP-03: one shared meeting, so nothing the invitee provides). */
export const POLL_LOCATION_KINDS: readonly LocationKind[] = [
  "google_conference",
  "microsoft_teams_conference",
  "zoom_conference",
  "jitsi_conference",
  "webex_conference",
  "gotomeeting_conference",
  "custom",
  "physical",
  "inbound_call",
];

export function isPollLocationKind(kind: LocationKind): boolean {
  return POLL_LOCATION_KINDS.includes(kind);
}

// ---------------------------------------------------------------------------------------------------------------
// Field schemas

export const zPollTitle = z
  .string()
  .trim()
  .min(1, "Enter a meeting name.")
  .max(MAX_TITLE_LENGTH, `Use ${MAX_TITLE_LENGTH} characters or fewer.`);

export const zParticipantName = z
  .string()
  .trim()
  .min(1, POLL_ERRORS.nameRequired)
  .max(MAX_NAME_LENGTH, `Use ${MAX_NAME_LENGTH} characters or fewer.`);

/** Optional email: "" becomes null. */
export const zOptionalEmail = z
  .union([z.literal(""), zEmail])
  .nullish()
  .transform((v) => (v ? v : null));

export const zChoice = z.enum(["yes", "if_need_be", "no"]);
export const zVisibility = z.enum(["host_only", "counts_only", "after_vote", "everyone"]);
export const zNotifyMode = z.enum(["instant", "daily_digest", "off"]);
export const zReminderMode = z.enum(["off", "smart", "custom"]);
export const zTimeZoneMode = z.enum(["auto", "fixed"]);

export const zReminderOffset = z.object({
  kind: z.enum(["after_invite", "before_deadline"]),
  minutes: z
    .number()
    .int()
    .min(1, "Choose a reminder time.")
    .max(365 * 24 * 60, "Choose a reminder within a year."),
});

export const zPollLocation: z.ZodType<LocationConfig | null> = zLocationConfig
  .refine((l) => isPollLocationKind(l.kind), POLL_ERRORS.locationNotAllowed)
  .nullable();

/** A timed option (ISO instants) or a date-only option. */
export const zOptionInput = z.union([
  z.object({
    start: z.iso.datetime({ offset: true, message: "Enter a valid date and time" }),
    end: z.iso.datetime({ offset: true, message: "Enter a valid date and time" }),
  }),
  z.object({ date: zIsoDate }),
]);

/** Link ending (MP-04): lowercase letters, numbers and hyphens, 3 to 64 characters, not a reserved word. */
export const zPollSlug = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => isValidPollSlug(v), POLL_ERRORS.slugInvalid);

export function isValidPollSlug(slug: string): boolean {
  return POLL_SLUG_PATTERN.test(slug) && !isReservedSlug(slug);
}

const zMaxVotes = z
  .number()
  .int()
  .min(1, "Use at least 1.")
  .max(MAX_VOTES_PER_OPTION_LIMIT, `Use ${MAX_VOTES_PER_OPTION_LIMIT} or fewer.`)
  .nullable();
const zMaxChoices = z.number().int().min(1, "Use at least 1.").max(MAX_POLL_OPTIONS).nullable();
const zDeadline = z.iso.datetime({ offset: true, message: "Enter a valid date and time" }).nullable();

/** Settings shared by create and update (MP-04). */
const settingsShape = {
  descriptionHtml: z.string().max(MAX_DESCRIPTION_LENGTH * 2, `Use ${MAX_DESCRIPTION_LENGTH} characters or fewer.`).nullish(),
  location: zPollLocation.optional(),
  locale: z.string().trim().max(16).optional(),
  timezone: zTimeZone.optional(),
  timeZoneMode: zTimeZoneMode.optional(),
  defaultDurationMinutes: z.number().int().min(MIN_OPTION_MINUTES).max(MAX_OPTION_MINUTES).optional(),
  resultsVisibility: zVisibility.optional(),
  allowIfNeedBe: z.boolean().optional(),
  hideInvitees: z.boolean().optional(),
  requireEmail: z.boolean().optional(),
  verifyEmail: z.boolean().optional(),
  allowComments: z.boolean().optional(),
  maxVotesPerOption: zMaxVotes.optional(),
  maxChoicesPerParticipant: zMaxChoices.optional(),
  deadline: zDeadline.optional(),
  reserveTimes: z.boolean().optional(),
  notifyMode: zNotifyMode.optional(),
  reminderMode: zReminderMode.optional(),
  reminderOffsets: z.array(zReminderOffset).max(3, "Add up to 3 reminders.").optional(),
  autoBook: z.boolean().optional(),
  countHostPreference: z.boolean().optional(),
  sendMeetingReminders: z.boolean().optional(),
  coHostIds: z.array(z.uuid()).max(MAX_POLL_COHOSTS, POLL_ERRORS.tooManyCohosts).optional(),
};

export const CreatePollSchema = z.object({
  ...settingsShape,
  title: zPollTitle,
  timezone: zTimeZone,
  defaultDurationMinutes: z.number().int().min(MIN_OPTION_MINUTES).max(MAX_OPTION_MINUTES),
  options: z.array(zOptionInput).min(1, POLL_ERRORS.noOptions).max(MAX_POLL_OPTIONS, POLL_ERRORS.tooManyOptions),
  slug: zPollSlug.optional(),
});
export type CreatePollInput = z.input<typeof CreatePollSchema>;

export const UpdatePollSchema = z.object({
  pollId: z.uuid(),
  title: zPollTitle.optional(),
  slug: zPollSlug.optional(),
  hostPreferences: z.record(z.string(), zChoice).nullable().optional(),
  /** Confirms a switch to a more public visibility (B14 warning). */
  confirmPublic: z.boolean().optional(),
  ...settingsShape,
});
export type UpdatePollInput = z.input<typeof UpdatePollSchema>;

export const AddOptionsSchema = z.object({
  pollId: z.uuid(),
  options: z.array(zOptionInput).min(1, POLL_ERRORS.noOptions).max(MAX_POLL_OPTIONS, POLL_ERRORS.tooManyOptions),
  /** "Email the {n} people who already voted about the new times" (default on). */
  notifyParticipants: z.boolean().default(true),
});
export type AddOptionsInput = z.input<typeof AddOptionsSchema>;

export const RemoveOptionsSchema = z.object({
  pollId: z.uuid(),
  optionIds: z.array(z.uuid()).min(1).max(MAX_POLL_OPTIONS),
  /** Required when the options have Yes or If need be votes. */
  confirm: z.boolean().default(false),
});
export type RemoveOptionsInput = z.input<typeof RemoveOptionsSchema>;

const zVotes = z.array(z.object({ optionId: z.uuid(), choice: zChoice })).max(MAX_POLL_OPTIONS);

/** Public vote submit (MP-08 to MP-10). */
export const SubmitVoteSchema = z.object({
  name: zParticipantName,
  email: zOptionalEmail,
  timezone: zTimeZone,
  locale: z.string().trim().max(16).optional(),
  votes: zVotes,
  declined: z.boolean().default(false),
  comment: z.string().trim().max(MAX_COMMENT_LENGTH, `Use ${MAX_COMMENT_LENGTH} characters or fewer.`).nullish(),
  subscribe: z.boolean().default(false),
  inviteToken: z.string().trim().max(200).nullish(),
  verificationCode: z.string().trim().max(12).nullish(),
  /** Honeypot (BK-18 pattern): must stay empty. */
  website: z.string().max(500).nullish(),
  formToken: z.string().max(200).nullish(),
  turnstileToken: z.string().max(4096).nullish(),
  /**
   * Client generated id of one submit (use crypto.randomUUID(); ids under 16 characters are ignored): a double click
   * from the same client within 10 minutes answers the first result again instead of saving twice.
   */
  requestId: z.string().trim().max(100).nullish(),
  embed: z.boolean().default(false),
});
export type SubmitVoteInput = z.input<typeof SubmitVoteSchema>;

export const VerifyEmailSchema = z.object({ email: zEmail, name: z.string().trim().max(MAX_NAME_LENGTH).nullish() });

/** Host edits on behalf / adds a participant (MP-17). */
export const SetVotesSchema = z.object({
  pollId: z.uuid(),
  participantId: z.uuid(),
  votes: zVotes,
  notify: z.boolean().default(true),
});
export type SetVotesInput = z.input<typeof SetVotesSchema>;

export const AddParticipantSchema = z.object({
  pollId: z.uuid(),
  name: zParticipantName,
  email: zOptionalEmail,
  votes: zVotes,
  isRequired: z.boolean().default(false),
  notify: z.boolean().default(true),
});
export type AddParticipantInput = z.input<typeof AddParticipantSchema>;

export const UpdateParticipantSchema = z.object({
  pollId: z.uuid(),
  participantId: z.uuid(),
  isRequired: z.boolean().optional(),
  name: zParticipantName.optional(),
});

export const RemoveParticipantSchema = z.object({
  pollId: z.uuid(),
  participantId: z.uuid(),
  notify: z.boolean().default(true),
});

/** Recipients pasted as a list (comma, semicolon or new line separated; "Name <email>" accepted) or structured. */
export const InviteSchema = z.object({
  pollId: z.uuid(),
  recipients: z
    .array(
      z.object({
        email: zEmail,
        name: z.string().trim().max(MAX_NAME_LENGTH).nullish(),
        required: z.boolean().default(false),
      }),
    )
    .min(1, POLL_ERRORS.noRecipients)
    .max(MAX_INVITES_PER_SEND, POLL_ERRORS.tooManyRecipients),
  subject: z.string().trim().max(MAX_INVITE_SUBJECT_LENGTH).nullish(),
  message: z.string().trim().max(MAX_INVITE_MESSAGE_LENGTH).nullish(),
});
export type InviteInput = z.input<typeof InviteSchema>;

export const RemindSchema = z.object({
  pollId: z.uuid(),
  /** Omitted: every invited participant who has not responded. */
  participantIds: z.array(z.uuid()).max(1_000).optional(),
});

export const CommentSchema = z.object({
  body: z.string().trim().min(1, POLL_ERRORS.commentEmpty).max(MAX_COMMENT_LENGTH, `Use ${MAX_COMMENT_LENGTH} characters or fewer.`),
  name: z.string().trim().max(MAX_NAME_LENGTH).nullish(),
});

export const BookPollSchema = z.object({
  pollId: z.uuid(),
  optionId: z.uuid(),
  invitees: z
    .array(
      z.object({
        participantId: z.uuid().nullish(),
        name: z.string().trim().max(MAX_NAME_LENGTH).nullish(),
        email: zEmail,
      }),
    )
    .min(1, POLL_ERRORS.noInvitees)
    .max(1_000),
  message: z.string().trim().max(MAX_BOOKING_MESSAGE_LENGTH).nullish(),
  sendMeetingReminders: z.boolean().default(false),
  /** "The time has been chosen" email to respondents not included (default off). */
  notifyExcluded: z.boolean().default(false),
});
export type BookPollInput = z.input<typeof BookPollSchema>;

export const ReopenPollSchema = z.object({
  pollId: z.uuid(),
  /** A new deadline (or null to clear it); required when the old one has passed. */
  deadline: zDeadline.optional(),
  /** Email respondents "{Host} reopened the poll" (default on). */
  notify: z.boolean().default(true),
});

export const DeletePollSchema = z.object({
  pollId: z.uuid(),
  /** "Notify the {n} people who voted" (default on). */
  notify: z.boolean().default(true),
  /** Booked polls: "Keep the scheduled meeting" (false) or "Cancel it too" (true). */
  cancelMeeting: z.boolean().default(false),
  reason: z.string().trim().max(2_000).nullish(),
});

export const ListPollsSchema = z.object({
  filter: z.enum(["open", "booked", "ended", "all", "deleted"]).default("open"),
  q: z.string().trim().max(100).optional(),
  hostedBy: z.enum(["me", "cohosted", "all"]).default("all"),
  cursor: z.string().max(200).nullish(),
  limit: z.number().int().min(1).max(100).default(25),
});

export const ExportSchema = z.object({ pollId: z.uuid(), timezone: zTimeZone.optional() });

export const IcsCheckSchema = z.object({ icsUrl: z.string().trim().min(8).max(2048) });

// ---------------------------------------------------------------------------------------------------------------
// Pure checks

export type NormalizedOption = {
  startsAt: Date | null;
  endsAt: Date | null;
  allDayDate: string | null;
  durationMinutes: number;
  /** Key for duplicate detection ("t:{start}:{end}" or "d:{date}"). */
  key: string;
};

export type OptionCheck = { ok: true; options: NormalizedOption[] } | { ok: false; error: string; index: number };

/**
 * Validates proposed options (MP-02): starts in the future (date-only options: the day starts after now in the poll
 * zone, computed by `dayStart`), duration 5 minutes to 24 hours, starts within 365 days. Exact duplicates are dropped
 * silently (the grid toggles instead of adding).
 */
export function normalizeOptions(
  input: readonly ({ start: string; end: string } | { date: string })[],
  ctx: { now: Date; dayStart: (date: string) => Date },
): OptionCheck {
  const out: NormalizedOption[] = [];
  const seen = new Set<string>();
  const nowMs = ctx.now.getTime();
  const horizon = nowMs + OPTION_HORIZON_DAYS * DAY;
  for (const [index, o] of input.entries()) {
    if ("date" in o) {
      const start = ctx.dayStart(o.date);
      if (Number.isNaN(start.getTime())) return { ok: false, error: "Enter a valid date.", index };
      if (start.getTime() <= nowMs) return { ok: false, error: POLL_ERRORS.optionInPast, index };
      if (start.getTime() > horizon) return { ok: false, error: POLL_ERRORS.optionTooFar, index };
      const key = `d:${o.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ startsAt: null, endsAt: null, allDayDate: o.date, durationMinutes: 24 * 60, key });
      continue;
    }
    const s = new Date(o.start);
    const e = new Date(o.end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return { ok: false, error: "Enter a valid date and time.", index };
    const minutes = (e.getTime() - s.getTime()) / MIN;
    if (!Number.isInteger(minutes) || minutes < MIN_OPTION_MINUTES || minutes > MAX_OPTION_MINUTES) {
      return { ok: false, error: POLL_ERRORS.optionDuration, index };
    }
    if (s.getTime() <= nowMs) return { ok: false, error: POLL_ERRORS.optionInPast, index };
    if (s.getTime() > horizon) return { ok: false, error: POLL_ERRORS.optionTooFar, index };
    const key = `t:${s.getTime()}:${e.getTime()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ startsAt: s, endsAt: e, allDayDate: null, durationMinutes: minutes, key });
  }
  if (!out.length) return { ok: false, error: POLL_ERRORS.noOptions, index: 0 };
  if (out.length > MAX_POLL_OPTIONS) return { ok: false, error: POLL_ERRORS.tooManyOptions, index: MAX_POLL_OPTIONS };
  return { ok: true, options: out };
}

/** Deadline rule (MP-04): after now (unless closing voting on purpose) and not after the last option start. */
export function deadlineProblem(
  deadline: Date | null,
  ctx: { now: Date; lastOptionStart: Date | null; allowPast?: boolean },
): string | null {
  if (!deadline) return null;
  if (Number.isNaN(deadline.getTime())) return "Enter a valid date and time.";
  if (!ctx.allowPast && deadline.getTime() <= ctx.now.getTime()) return POLL_ERRORS.deadlinePast;
  if (ctx.lastOptionStart && deadline.getTime() > ctx.lastOptionStart.getTime()) return POLL_ERRORS.deadlineAfterLast;
  return null;
}

/**
 * "Max votes per option" changes (MP-27): raise freely; lower only down to the highest current count; turning it on
 * later only when no option already exceeds the value. Returns an error message or null.
 */
export function maxVotesProblem(next: number | null, currentHighest: number): string | null {
  if (next === null) return null;
  if (next < currentHighest) return POLL_ERRORS.maxVotesTooLow.replace("{n}", String(currentHighest));
  return null;
}

/** Visibility ordering (most private first) for the B14 "more public" warning. */
const VISIBILITY_RANK = { host_only: 0, counts_only: 1, after_vote: 2, everyone: 3 } as const;

/** True when switching from `from` to `to` reveals more to voters (warn: "Voters chose their answers expecting..."). */
export function isMorePublic(from: keyof typeof VISIBILITY_RANK, to: keyof typeof VISIBILITY_RANK): boolean {
  return VISIBILITY_RANK[to] > VISIBILITY_RANK[from];
}

export const MORE_PUBLIC_WARNING = "Voters chose their answers expecting their names to be hidden.";

/**
 * Splits a pasted recipients list (MP-06): commas, semicolons and new lines separate entries; "Name <email>" and bare
 * emails are accepted. Returns the parsed recipients and the entries that are not emails.
 */
export function parseRecipientList(text: string): { recipients: { name: string | null; email: string }[]; invalid: string[] } {
  const out: { name: string | null; email: string }[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[\n,;]+/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const m = /^(?:"?([^"<]*?)"?\s*)?<([^<>\s]+@[^<>\s]+)>$/.exec(entry);
    const email = (m ? m[2]! : entry).trim();
    const name = m?.[1]?.trim() || null;
    if (!looksLikeEmail(email) || email.length > MAX_EMAIL_LENGTH) {
      invalid.push(entry);
      continue;
    }
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, email });
  }
  return { recipients: out, invalid };
}

/** A basic RFC 5322 shape check (B16). */
export function looksLikeEmail(v: string): boolean {
  return /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/.test(v);
}
