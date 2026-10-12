// Zod schemas of the event type editor and services (ARCHITECTURE section 26 rule 4; SPEC ET-14 to ET-26, VID-02 to
// VID-07, SCH-02 to SCH-10, CR-05, NT-08). Client and server safe: the editor validates the draft with the same rules
// before calling the save action, and the services parse every input again.
//
// Field error keys are dotted draft paths ("name", "durations.1", "locations.0.location", "questions.2.answerChoices",
// "dateRange.end", "confirmationLinks.1.url"); sectionOfField() maps them to the editor section that shows them.
import { z } from "zod";
import type { ConfirmationLink, LocationConfig, NotificationTemplates } from "@/db/types";
import { dayProblem, isIsoDate, weeklyProblem } from "@/lib/availability/intervals";
import { isValidTimeZone, zLocationKind } from "@/lib/validation";
import {
  ANSWER_CHOICE_MAX,
  BUFFER_MAX,
  CANCELLATION_POLICY_MAX,
  DATE_RANGE_DAYS_MAX,
  DATE_RANGE_DAYS_MIN,
  DESCRIPTION_MAX,
  DURATION_MAX,
  DURATION_MIN,
  INCREMENT_MAX,
  INCREMENT_MIN,
  INTERNAL_NOTE_MAX,
  LIMIT_MAX,
  LIMIT_MIN,
  LINK_NAME_MAX,
  LOCATION_TEXT_MAX,
  MAX_ANSWER_CHOICES,
  MAX_CONFIRMATION_LINKS,
  MAX_DURATIONS,
  MAX_LOCATIONS,
  MAX_QUESTIONS,
  MESSAGES,
  NAME_MAX,
  NOTICE_MAX_MINUTES,
  QUESTION_LABEL_MAX,
  SINGLETON_LOCATION_KINDS,
  SUPPORTED_LOCALES,
  TEMPLATE_BODY_MAX,
  TEMPLATE_TITLE_MAX,
  URL_MAX,
} from "./constants";
import type { EventTypeDraft, QuestionDraft, ScheduleChoiceDraft } from "./types";

const zUuid = z.uuid("Invalid id");
const int = (min: number, max: number, message: string) =>
  z.number({ error: message }).int(message).min(min, message).max(max, message);

export const zEventName = z
  .string({ error: MESSAGES.nameRequired })
  .trim()
  .min(1, MESSAGES.nameRequired)
  .max(NAME_MAX, MESSAGES.nameTooLong);

export const zEventColor = z
  .string({ error: MESSAGES.invalidColor })
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, MESSAGES.invalidColor)
  .transform((v) => v.toLowerCase());

/** Event link slug (GEN-02); "" for a new type whose slug follows its name. */
export const zEventSlugOrEmpty = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === "" || /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(v), MESSAGES.slugInvalid);

export const zEventSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/, MESSAGES.slugInvalid);

const zText = (max: number, message: string) =>
  z
    .string()
    .max(max, message)
    .nullish()
    .transform((v) => (v ?? "").replace(/\r\n?/g, "\n"));

/** One location option (VID-01 to VID-07) with the ET-17 length limits. */
export const zEventLocation: z.ZodType<LocationConfig> = z
  .object({
    id: zUuid,
    kind: zLocationKind,
    position: z.number().int().min(0).max(1000),
    location: z
      .string()
      .max(LOCATION_TEXT_MAX + 50)
      .nullish()
      .transform((v) => (v == null ? v : v.replace(/\r\n?/g, "\n").trim())),
    additionalInfo: z
      .string()
      .max(LOCATION_TEXT_MAX + 50)
      .nullish()
      .transform((v) => (v == null ? v : v.replace(/\r\n?/g, "\n").trim())),
    phoneNumber: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{6,14}$/, "Enter a phone number with country code, like +14155550123")
      .nullish(),
    displayBeforeBooking: z.boolean().optional(),
    connectionId: zUuid.nullish(),
  })
  .superRefine((v, ctx) => {
    if ((v.location ?? "").length > LOCATION_TEXT_MAX) ctx.addIssue({ code: "custom", path: ["location"], message: MESSAGES.locationTooLong });
    if ((v.additionalInfo ?? "").length > LOCATION_TEXT_MAX) {
      ctx.addIssue({ code: "custom", path: ["additionalInfo"], message: MESSAGES.locationTooLong });
    }
    if ((v.kind === "physical" || v.kind === "custom") && !v.location) {
      ctx.addIssue({ code: "custom", path: ["location"], message: MESSAGES.locationRequired });
    }
    if (v.kind === "inbound_call" && !v.phoneNumber) {
      ctx.addIssue({ code: "custom", path: ["phoneNumber"], message: "Enter the phone number invitees should call" });
    }
  });

/** Normalizes a location list: positions follow the array order, empty optional texts become null. */
export function normalizeLocations(list: readonly LocationConfig[]): LocationConfig[] {
  return list.map((l, i) => {
    const out: LocationConfig = { id: l.id, kind: l.kind, position: i };
    const location = l.location?.trim();
    const additionalInfo = l.additionalInfo?.trim();
    if (location) out.location = location;
    if (additionalInfo) out.additionalInfo = additionalInfo;
    if (l.phoneNumber) out.phoneNumber = l.phoneNumber;
    if (l.connectionId) out.connectionId = l.connectionId;
    if (l.kind === "physical") out.displayBeforeBooking = l.displayBeforeBooking !== false;
    else if (l.kind === "custom") out.displayBeforeBooking = l.displayBeforeBooking === true;
    return out;
  });
}

/** A stable identity of a location option for duplicate detection. */
export function locationIdentity(l: LocationConfig): string {
  if ((SINGLETON_LOCATION_KINDS as readonly string[]).includes(l.kind)) return l.kind;
  return `${l.kind}:${(l.location ?? "").trim().toLowerCase()}:${(l.additionalInfo ?? "").trim().toLowerCase()}:${l.phoneNumber ?? ""}`;
}

const CHOICE_TYPES: QuestionDraft["type"][] = ["single_select", "multi_select", "dropdown"];

/** True for question types with answer choices (Radio buttons, Checkboxes, Dropdown). */
export function hasChoices(type: QuestionDraft["type"]): boolean {
  return CHOICE_TYPES.includes(type);
}

export const zQuestionType = z.enum(["string", "text", "single_select", "multi_select", "dropdown", "phone_number"]);

/** One custom question (ET-24). */
export const zQuestion: z.ZodType<QuestionDraft> = z
  .object({
    id: zUuid,
    label: z.string({ error: MESSAGES.questionRequired }),
    type: zQuestionType,
    required: z.boolean(),
    enabled: z.boolean(),
    answerChoices: z.array(z.string()).max(MAX_ANSWER_CHOICES + 50),
    includeOther: z.boolean(),
  })
  .transform((q) => {
    const choices = hasChoices(q.type) ? q.answerChoices.map((c) => c.replace(/\s+/g, " ").trim()) : [];
    return {
      ...q,
      label: q.label.replace(/\r\n?/g, "\n").trim(),
      answerChoices: choices,
      includeOther: hasChoices(q.type) ? q.includeOther : false,
    };
  })
  .superRefine((q, ctx) => {
    if (!q.label) ctx.addIssue({ code: "custom", path: ["label"], message: MESSAGES.questionRequired });
    else if (q.label.length > QUESTION_LABEL_MAX) ctx.addIssue({ code: "custom", path: ["label"], message: MESSAGES.questionTooLong });
    if (!hasChoices(q.type)) return;
    if (q.answerChoices.length === 0) ctx.addIssue({ code: "custom", path: ["answerChoices"], message: MESSAGES.choicesRequired });
    if (q.answerChoices.length > MAX_ANSWER_CHOICES) ctx.addIssue({ code: "custom", path: ["answerChoices"], message: MESSAGES.choicesTooMany });
    const seen = new Set<string>();
    q.answerChoices.forEach((c, i) => {
      if (!c) ctx.addIssue({ code: "custom", path: ["answerChoices", i], message: MESSAGES.choiceRequired });
      else if (c.length > ANSWER_CHOICE_MAX) ctx.addIssue({ code: "custom", path: ["answerChoices", i], message: MESSAGES.choiceTooLong });
      else if (seen.has(c.toLowerCase())) ctx.addIssue({ code: "custom", path: ["answerChoices", i], message: MESSAGES.choiceDuplicate });
      seen.add(c.toLowerCase());
    });
  });

const zMinuteRange = z.object({ start: z.number().int(), end: z.number().int() });

/** Schedule content of "Custom schedule" (AV-11); the AV-04 rules are checked in superRefine. */
export const zScheduleContent = z
  .object({
    timezone: z.string(),
    weeklyHours: z.array(z.array(zMinuteRange).max(100)).length(7),
    overrides: z.array(z.object({ date: z.string(), intervals: z.array(zMinuteRange).max(100) })).max(1000),
  })
  .superRefine((c, ctx) => {
    if (!isValidTimeZone(c.timezone)) ctx.addIssue({ code: "custom", path: ["timezone"], message: MESSAGES.timeZone });
    const weekly = weeklyProblem(c.weeklyHours as never);
    if (weekly) ctx.addIssue({ code: "custom", path: ["weeklyHours"], message: weekly });
    const dates = new Set<string>();
    for (const o of c.overrides) {
      if (!isIsoDate(o.date) || dates.has(o.date)) {
        ctx.addIssue({ code: "custom", path: ["overrides"], message: "Choose a valid date." });
        break;
      }
      dates.add(o.date);
      const day = dayProblem(o.intervals);
      if (day) {
        ctx.addIssue({ code: "custom", path: ["overrides"], message: day });
        break;
      }
    }
  });

export const zScheduleChoice: z.ZodType<ScheduleChoiceDraft> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("schedule"), scheduleId: zUuid.nullable() }),
  z.object({ kind: z.literal("custom"), content: zScheduleContent }),
]) as unknown as z.ZodType<ScheduleChoiceDraft>;

const zUrlHttp = z
  .string()
  .trim()
  .max(URL_MAX, MESSAGES.url)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname);
    } catch {
      return false;
    }
  }, MESSAGES.url);

/** True for an absolute http(s) URL with a host (redirects and confirmation links, ET-26). */
export function isHttpUrl(value: string): boolean {
  return zUrlHttp.safeParse(value).success;
}

const zConfirmationLink: z.ZodType<ConfirmationLink> = z.object({
  label: z.string().trim().min(1, MESSAGES.linkName).max(LINK_NAME_MAX, MESSAGES.linkName),
  url: zUrlHttp,
});

const zTemplateTitle = z.string().max(TEMPLATE_TITLE_MAX, MESSAGES.templateTooLong).optional();
const zTemplateBody = z.string().max(TEMPLATE_BODY_MAX, MESSAGES.templateTooLong).optional();

export const zNotificationTemplates: z.ZodType<NotificationTemplates> = z
  .object({
    hostEventTitle: zTemplateTitle,
    inviteeEventTitle: zTemplateTitle,
    invitationDescription: zTemplateBody,
    confirmationSubject: zTemplateTitle,
    confirmationBody: zTemplateBody,
    cancellationSubject: zTemplateTitle,
    cancellationBody: zTemplateBody,
  })
  .transform((t) => {
    const out: NotificationTemplates = {};
    for (const [k, v] of Object.entries(t) as [keyof NotificationTemplates, string | undefined][]) {
      const clean = v?.replace(/\r\n?/g, "\n").trim();
      if (clean) out[k] = clean;
    }
    return out;
  });

const zLimit = int(LIMIT_MIN, LIMIT_MAX, MESSAGES.limit).nullable();

/** The whole draft (ET-14 save model). Kind-specific rules live in kindProblems(). */
export const zEventTypeDraft: z.ZodType<EventTypeDraft> = z
  .object({
    name: zEventName,
    color: zEventColor,
    slug: zEventSlugOrEmpty,
    descriptionHtml: z.string().max(DESCRIPTION_MAX * 3, MESSAGES.descriptionTooLong),
    durations: z
      .array(int(DURATION_MIN, DURATION_MAX, MESSAGES.durationRange), { error: MESSAGES.durationRange })
      .min(1, MESSAGES.durationRange)
      .max(MAX_DURATIONS, MESSAGES.durationTooMany),
    locations: z.array(zEventLocation).max(MAX_LOCATIONS, MESSAGES.locationsTooMany),
    schedule: zScheduleChoice,
    dateRange: z.object({
      type: z.enum(["rolling", "fixed", "unlimited"]),
      days: int(DATE_RANGE_DAYS_MIN, DATE_RANGE_DAYS_MAX, MESSAGES.dateRangeDays),
      mode: z.enum(["calendar_days", "weekdays", "available_days"]),
      start: z.string().nullable(),
      end: z.string().nullable(),
    }),
    minimumNoticeMinutes: int(0, NOTICE_MAX_MINUTES, MESSAGES.notice),
    bufferBeforeMinutes: int(0, BUFFER_MAX, MESSAGES.buffer),
    bufferAfterMinutes: int(0, BUFFER_MAX, MESSAGES.buffer),
    slotIncrementMinutes: int(INCREMENT_MIN, INCREMENT_MAX, MESSAGES.increment),
    limitPerDay: zLimit,
    limitPerWeek: zLimit,
    limitPerMonth: zLimit,
    timeZoneDisplay: z.enum(["auto", "locked"]),
    lockedTimeZone: z.string().nullable(),
    destinationCalendarId: zUuid.nullable(),
    nameFormat: z.enum(["full", "first_last"]),
    allowGuests: z.boolean(),
    questions: z.array(zQuestion).max(MAX_QUESTIONS, MESSAGES.questionsTooMany),
    notificationType: z.enum(["auto", "calendar_invitation", "email_confirmation"]),
    notificationTemplates: zNotificationTemplates,
    includeCancelRescheduleLinks: z.boolean(),
    includeAnswersInNotifications: z.boolean(),
    cancellationPolicy: zText(CANCELLATION_POLICY_MAX, MESSAGES.policyTooLong),
    afterBooking: z.enum(["confirmation_page", "redirect"]),
    redirectUrl: z.string().max(URL_MAX, MESSAGES.url).transform((v) => v.trim()),
    redirectPassDetails: z.boolean(),
    scheduleAnotherEnabled: z.boolean(),
    scheduleAnotherLabel: z.string().transform((v) => v.trim()),
    confirmationLinks: z.array(zConfirmationLink).max(MAX_CONFIRMATION_LINKS, MESSAGES.linksTooMany),
    secret: z.boolean(),
    internalNote: zText(INTERNAL_NOTE_MAX, MESSAGES.internalNoteTooLong),
  })
  .superRefine((d, ctx) => {
    const seen = new Set<number>();
    d.durations.forEach((m, i) => {
      if (seen.has(m)) ctx.addIssue({ code: "custom", path: ["durations", i], message: MESSAGES.durationDuplicate });
      seen.add(m);
    });
    const ids = new Set<string>();
    const identities = new Set<string>();
    d.locations.forEach((l, i) => {
      if (ids.has(l.id)) ctx.addIssue({ code: "custom", path: ["locations", i], message: MESSAGES.locationDuplicate });
      ids.add(l.id);
      const key = locationIdentity(l);
      if (identities.has(key)) ctx.addIssue({ code: "custom", path: ["locations", i], message: MESSAGES.locationDuplicate });
      identities.add(key);
    });
    const qids = new Set<string>();
    d.questions.forEach((q, i) => {
      if (qids.has(q.id)) ctx.addIssue({ code: "custom", path: ["questions", i], message: "This question is listed twice." });
      qids.add(q.id);
    });
    if (d.dateRange.type === "fixed") {
      if (!d.dateRange.start || !isIsoDate(d.dateRange.start)) {
        ctx.addIssue({ code: "custom", path: ["dateRange", "start"], message: MESSAGES.dateRangeStart });
      }
      if (!d.dateRange.end || !isIsoDate(d.dateRange.end) || (d.dateRange.start && d.dateRange.end < d.dateRange.start)) {
        ctx.addIssue({ code: "custom", path: ["dateRange", "end"], message: MESSAGES.dateRangeEnd });
      }
    }
    if (d.timeZoneDisplay === "locked" && !isValidTimeZone(d.lockedTimeZone)) {
      ctx.addIssue({ code: "custom", path: ["lockedTimeZone"], message: MESSAGES.timeZone });
    }
    // The redirect URL is only checked while "Redirect to an external site" is chosen: with the confirmation page the
    // field is hidden, and the service drops a leftover invalid value instead of failing on a field nobody sees.
    if (d.afterBooking === "redirect") {
      if (!d.redirectUrl) ctx.addIssue({ code: "custom", path: ["redirectUrl"], message: MESSAGES.redirectRequired });
      else if (!zUrlHttp.safeParse(d.redirectUrl).success) ctx.addIssue({ code: "custom", path: ["redirectUrl"], message: MESSAGES.url });
    }
    if (!d.scheduleAnotherLabel || d.scheduleAnotherLabel.length > LINK_NAME_MAX) {
      ctx.addIssue({ code: "custom", path: ["scheduleAnotherLabel"], message: MESSAGES.linkName });
    }
  }) as unknown as z.ZodType<EventTypeDraft>;

/** Kind rules (ARCHITECTURE 5.4.5, ET-16, ET-17, ET-30) as dotted field errors. */
export function kindProblems(draft: Pick<EventTypeDraft, "durations" | "locations">, kind: "solo" | "group"): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (kind === "group") {
    if (draft.durations.length > 1) out.durations = [MESSAGES.durationGroup];
    if (draft.locations.length > 1) out.locations = [MESSAGES.locationGroup];
  }
  return out;
}

export type DraftValidation = { ok: true; draft: EventTypeDraft } | { ok: false; fieldErrors: Record<string, string[]> };

/** Validates a draft like the save action does (zod schema plus kind rules); fieldErrors use dotted draft paths. */
export function validateDraft(draft: unknown, kind: "solo" | "group" = "solo"): DraftValidation {
  const parsed = zEventTypeDraft.safeParse(draft);
  const fieldErrors: Record<string, string[]> = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path.length ? issue.path.map(String).join(".") : "_form";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, fieldErrors };
  }
  const kindErrors = kindProblems(parsed.data, kind);
  if (Object.keys(kindErrors).length) return { ok: false, fieldErrors: kindErrors };
  return { ok: true, draft: parsed.data };
}

/** The editor section that displays a dotted field path. */
export type EditorSectionId =
  | "details"
  | "duration"
  | "location"
  | "availability"
  | "description"
  | "limits"
  | "bookingPage"
  | "inviteeForm"
  | "notifications"
  | "confirmation";

export const PRIMARY_SECTIONS: readonly EditorSectionId[] = ["details", "duration", "location", "availability"];
export const MORE_SECTIONS: readonly EditorSectionId[] = [
  "description",
  "limits",
  "bookingPage",
  "inviteeForm",
  "notifications",
  "confirmation",
];

const FIELD_SECTIONS: Record<string, EditorSectionId> = {
  name: "details",
  color: "details",
  secret: "details",
  internalNote: "details",
  durations: "duration",
  locations: "location",
  schedule: "availability",
  dateRange: "availability",
  minimumNoticeMinutes: "availability",
  descriptionHtml: "description",
  bufferBeforeMinutes: "limits",
  bufferAfterMinutes: "limits",
  limitPerDay: "limits",
  limitPerWeek: "limits",
  limitPerMonth: "limits",
  slug: "bookingPage",
  slotIncrementMinutes: "bookingPage",
  timeZoneDisplay: "bookingPage",
  lockedTimeZone: "bookingPage",
  destinationCalendarId: "bookingPage",
  nameFormat: "inviteeForm",
  allowGuests: "inviteeForm",
  questions: "inviteeForm",
  notificationType: "notifications",
  notificationTemplates: "notifications",
  includeCancelRescheduleLinks: "notifications",
  includeAnswersInNotifications: "notifications",
  cancellationPolicy: "notifications",
  afterBooking: "confirmation",
  redirectUrl: "confirmation",
  redirectPassDetails: "confirmation",
  scheduleAnotherEnabled: "confirmation",
  scheduleAnotherLabel: "confirmation",
  confirmationLinks: "confirmation",
};

/** A ?section= query value as a section id, or null. */
export function parseEditorSection(value: string | string[] | undefined | null): EditorSectionId | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && ([...PRIMARY_SECTIONS, ...MORE_SECTIONS] as string[]).includes(v) ? (v as EditorSectionId) : null;
}

/** The section of a dotted field error key, or null for form-level errors. */
export function sectionOfField(key: string): EditorSectionId | null {
  const head = key.replace(/^draft\./, "").split(".")[0] ?? "";
  return FIELD_SECTIONS[head] ?? null;
}

/** The first section (in display order) that has an error. */
export function firstErrorSection(fieldErrors: Record<string, string[]>): EditorSectionId | null {
  const order = [...PRIMARY_SECTIONS, ...MORE_SECTIONS];
  const sections = new Set(Object.keys(fieldErrors).map(sectionOfField).filter((s): s is EditorSectionId => s !== null));
  return order.find((s) => sections.has(s)) ?? null;
}

/** Strips a "draft." prefix from server field errors (the save action wraps the draft). */
export function draftFieldErrors(fieldErrors: Record<string, string[]> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(fieldErrors ?? {})) out[k.replace(/^draft\./, "")] = v;
  return out;
}

// Action inputs ------------------------------------------------------------------------------------------------

export const zSaveEventTypeInput = z.object({
  /** null creates a new event type (ET-14: created on first save). */
  id: zUuid.nullable(),
  /** updated_at the editor loaded (ISO); a different value means someone else saved in between. */
  version: z.string().max(64).nullable(),
  /** UI kind for new types (docs/SCOPE.md: one-on-one). */
  kind: z.enum(["one_on_one"]).optional(),
  draft: z.unknown(),
});
export type SaveEventTypeInput = z.infer<typeof zSaveEventTypeInput>;

export const zEventTypeRef = z.object({ id: zUuid });
export const zSetActiveInput = z.object({ id: zUuid, active: z.boolean() });
export const zSetSecretInput = z.object({ id: zUuid, secret: z.boolean() });
export const zInternalNoteInput = z.object({
  id: zUuid,
  note: z
    .string()
    .max(INTERNAL_NOTE_MAX, MESSAGES.internalNoteTooLong)
    .transform((v) => v.replace(/\r\n?/g, "\n").trim()),
});
export const zReorderInput = z.object({ ids: z.array(zUuid).min(1).max(500) });
export const zSlugCheckInput = z.object({ slug: z.string().max(200), eventTypeId: zUuid.nullable() });
export const zLocaleInput = z.object({ id: zUuid, locale: z.enum(SUPPORTED_LOCALES) });
export const zConferencingInput = z.object({ userId: zUuid });
