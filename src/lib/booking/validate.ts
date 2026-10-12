// Booking input validation against the resolved target (SPEC BK-09 to BK-13, VID-01 to VID-06) and the meeting
// location resolution. Pure (no I/O): validateBookingInput() returns either the normalized booking or field errors
// keyed by input path ("name", "email", "guests", "location", "location.value", "answers.{questionId}",
// "textReminderNumber", "timezone", "start", "duration").
import type { LocationConfig, QuestionAnswer, ResolvedLocation, Tracking } from "@/db/types";
import { isValidTimeZone } from "@/lib/slots";
import { looksLikeEmail, MAX_GUESTS, MAX_PREFILL_TEXT } from "./prefill";
import { resolveDuration } from "./rules";
import type { BookingTarget, CreateBookingInput } from "./types";

export const MESSAGES = {
  blank: "Can't be blank.",
  email: "Enter a valid email address.",
  tooManyGuests: `You can add up to ${MAX_GUESTS} guests.`,
  location: "One location must be selected.",
  radio: "One answer must be selected.",
  checkbox: "At least one answer must be checked.",
  phone: "This phone number format is not recognized. Please check the country and number.",
  smsCountry: "Text messages aren't available for this country.",
  tooLong: "Answers can be up to 10,000 characters.",
  timezone: "Choose a valid time zone.",
  start: "Choose a valid time.",
  duration: "This duration isn't available.",
  slotTaken: "Sorry, that time is no longer available.",
  slotTakenHint: "Please select a different time to book this event.",
  alreadyBooked: "You've already booked this time.",
  notReschedulable: "This event can no longer be rescheduled.",
  notAvailable: "This event type is not currently available.",
  linkUsed: "Someone has already used this link to book a meeting.",
  notFound: "This page isn't available.",
  botBlocked: "We couldn't schedule this event. Please refresh the page and try again.",
  staleForm: "This form was already used to schedule an event. Please refresh the page and try again.",
} as const;

/** Countries where text reminders are not offered (BK-13): Russia, Singapore, Iran. */
const SMS_BLOCKED_PREFIXES = ["+7", "+65", "+98"];

export type ValidatedBooking = {
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  emailNormalized: string;
  timezone: string;
  detectedTimezone: string | null;
  timeFormat: "12h" | "24h" | null;
  locale: string;
  guests: { email: string; emailNormalized: string }[];
  location: { config: LocationConfig | null; value: string | null };
  answers: QuestionAnswer[];
  textReminderNumber: string | null;
  marketingConsent: boolean;
  tracking: Tracking;
  start: Date;
  durationMinutes: number;
};

export type ValidationOutcome = { ok: true; value: ValidatedBooking } | { ok: false; fieldErrors: Record<string, string[]> };

const clean = (s: unknown, max = 255): string => (typeof s === "string" ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "");
/**
 * Single-line fields (names, the invitee-provided location, one-line answers, the locale): line breaks and tabs become
 * one space, so a name can never smuggle a line into an email header, a calendar invite or a subject line.
 */
const cleanLine = (s: unknown, max = 255): string =>
  typeof s === "string" ? clean(s.replace(/[\t\r\n\u2028\u2029]+/g, " ").replace(/ {2,}/g, " "), max) : "";
/** BCP 47 style locale tags we accept ("en", "pt-BR", "zh-Hant"); anything else falls back to the event type's. */
const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

/** Normalizes a phone number to E.164 ("+1 (415) 555-0123" -> "+14155550123"), or null when it is not valid. */
export function normalizePhone(value: string): string | null {
  const compact = value.trim().replace(/[\s().-]/g, "");
  const withPlus = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  return /^\+[1-9]\d{6,14}$/.test(withPlus) ? withPlus : null;
}

/** The event type's offered locations (single-use overrides first), sorted by position. */
export function locationsOf(target: Pick<BookingTarget, "eventType" | "overrides">): LocationConfig[] {
  const list = target.overrides?.locations ?? target.eventType.locations ?? [];
  return [...list].sort((a, b) => a.position - b.position);
}

/**
 * The meeting location stored on the scheduled event (VID-01): conferencing kinds start "processing" (the
 * provisioning job creates the link); invitee-provided kinds take the invitee's answer.
 */
export function resolveLocation(config: LocationConfig | null, value: string | null): ResolvedLocation {
  const base: ResolvedLocation = {
    configId: config?.id ?? null,
    kind: config?.kind ?? null,
    location: null,
    additionalInfo: null,
    joinUrl: null,
    status: null,
    providerMeetingId: null,
    password: null,
    dialIn: null,
    data: null,
    error: null,
  };
  if (!config) return base;
  switch (config.kind) {
    case "physical":
    case "custom":
      return { ...base, location: config.location ?? null, additionalInfo: config.additionalInfo ?? null };
    case "inbound_call":
      return { ...base, location: config.phoneNumber ?? null, additionalInfo: config.additionalInfo ?? null };
    case "outbound_call":
    case "ask_invitee":
      return { ...base, location: value };
    case "google_conference":
    case "microsoft_teams_conference":
    case "zoom_conference":
    case "jitsi_conference":
    case "webex_conference":
    case "gotomeeting_conference":
      return { ...base, status: "processing" };
    default:
      return base;
  }
}

/** Validates a booking request against the target (see the file header). Hosts skip required questions (OO-13). */
export function validateBookingInput(
  input: CreateBookingInput,
  target: BookingTarget,
  opts: { hostActor?: boolean; requireNames?: boolean } = {},
): ValidationOutcome {
  const et = target.eventType;
  const errors: Record<string, string[]> = {};
  const add = (key: string, message: string) => {
    const list = (errors[key] ??= []);
    if (!list.includes(message)) list.push(message);
  };

  // Name: "Name *" or "First Name *" and "Last Name *" (ET name format).
  const firstName = cleanLine(input.invitee.firstName) || null;
  const lastName = cleanLine(input.invitee.lastName) || null;
  let name = cleanLine(input.invitee.name);
  if (et.nameFormat === "first_last" && opts.requireNames !== false) {
    if (!firstName) add("firstName", MESSAGES.blank);
    if (!lastName) add("lastName", MESSAGES.blank);
    if (!name) name = [firstName, lastName].filter(Boolean).join(" ");
  } else if (!name) {
    name = [firstName, lastName].filter(Boolean).join(" ");
    if (!name) add("name", MESSAGES.blank);
  }

  const email = clean(input.invitee.email, 254);
  if (!email) add("email", MESSAGES.blank);
  else if (!looksLikeEmail(email)) add("email", MESSAGES.email);
  const emailNormalized = email.toLowerCase();

  // Zone (GEN-06): a locked zone event stores the locked zone; the browser zone is kept as detected_timezone.
  const locked = et.timeZoneDisplay === "locked" && isValidTimeZone(et.lockedTimeZone) ? et.lockedTimeZone : null;
  const requestedZone = clean(input.invitee.timezone, 64);
  if (!locked && !isValidTimeZone(requestedZone)) add("timezone", MESSAGES.timezone);
  const timezone = locked ?? requestedZone;
  const detected = clean(input.invitee.detectedTimezone, 64);
  const detectedTimezone = isValidTimeZone(detected) ? detected : null;
  const timeFormat = input.invitee.timeFormat === "24h" || input.invitee.timeFormat === "12h" ? input.invitee.timeFormat : null;
  const requestedLocale = cleanLine(input.invitee.locale, 16);
  const locale = LOCALE.test(requestedLocale) ? requestedLocale : et.locale || "en";

  // Guests (BK-10): hidden when the event disallows guests and for group events.
  const guests: ValidatedBooking["guests"] = [];
  const rawGuests = (input.guests ?? []).map((g) => clean(g, 254)).filter(Boolean);
  if (rawGuests.length > 0) {
    if (!et.allowGuests || et.kind === "group") add("guests", "Guests can't be added to this event.");
    const seen = new Set<string>([emailNormalized]);
    for (const g of rawGuests) {
      if (!looksLikeEmail(g)) {
        add("guests", MESSAGES.email);
        continue;
      }
      const n = g.toLowerCase();
      if (seen.has(n)) continue;
      seen.add(n);
      guests.push({ email: g, emailNormalized: n });
    }
    if (guests.length > MAX_GUESTS) add("guests", MESSAGES.tooManyGuests);
  }

  // Location (BK-11, VID-03, VID-06).
  const locations = locationsOf(target);
  let config: LocationConfig | null = null;
  let locationValue: string | null = null;
  const answer = input.locationAnswer ?? null;
  if (locations.length === 1) config = locations[0]!;
  if (answer?.configId) {
    const chosen = locations.find((l) => l.id === answer.configId);
    if (chosen) config = chosen;
    else if (locations.length > 0) add("location", MESSAGES.location);
  } else if (locations.length > 1) add("location", MESSAGES.location);
  if (config?.kind === "outbound_call") {
    const phone = answer?.value ? normalizePhone(answer.value) : null;
    if (!answer?.value?.trim()) add("location.value", MESSAGES.blank);
    else if (!phone) add("location.value", MESSAGES.phone);
    locationValue = phone;
  } else if (config?.kind === "ask_invitee") {
    const text = cleanLine(answer?.value, 1000);
    if (!text) add("location.value", MESSAGES.blank);
    locationValue = text || null;
  }

  // Questions (BK-12): enabled questions only, required unless a host books.
  const answers: QuestionAnswer[] = [];
  const given = new Map<string, string | string[]>();
  for (const a of input.answers ?? []) if (a && typeof a.questionId === "string") given.set(a.questionId, a.value);
  const questions = [...et.questions].filter((q) => q.enabled).sort((a, b) => a.position - b.position);
  for (const q of questions) {
    const key = `answers.${q.id}`;
    const raw = given.get(q.id);
    const required = q.required && !opts.hostActor;
    if (q.type === "multi_select") {
      const values = (Array.isArray(raw) ? raw : typeof raw === "string" && raw ? [raw] : [])
        .map((v) => clean(v, MAX_PREFILL_TEXT))
        .filter(Boolean);
      const unique = [...new Set(values)];
      const invalid = unique.filter((v) => !q.answerChoices.includes(v));
      if (invalid.length > (q.includeOther ? 1 : 0)) add(key, MESSAGES.checkbox);
      if (unique.length === 0) {
        if (required) add(key, MESSAGES.checkbox);
        continue;
      }
      answers.push({ questionId: q.id, question: q.label, type: q.type, position: q.position, answer: unique.join("\n"), values: unique });
      continue;
    }
    const value = typeof raw === "string" ? raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : Array.isArray(raw) ? clean(raw[0], MAX_PREFILL_TEXT + 1) : "";
    if (!value) {
      if (required) add(key, q.type === "single_select" || q.type === "dropdown" ? MESSAGES.radio : MESSAGES.blank);
      continue;
    }
    if (value.length > MAX_PREFILL_TEXT) {
      add(key, MESSAGES.tooLong);
      continue;
    }
    if (q.type === "single_select" || q.type === "dropdown") {
      if (!q.answerChoices.includes(value) && !(q.includeOther && q.type === "single_select")) {
        add(key, MESSAGES.radio);
        continue;
      }
    }
    // "One Line" answers stay on one line; "Multiple Lines" keep their line breaks.
    let stored = q.type === "string" ? cleanLine(value, MAX_PREFILL_TEXT) : value;
    if (q.type === "phone_number") {
      const phone = normalizePhone(value);
      if (!phone) {
        add(key, MESSAGES.phone);
        continue;
      }
      stored = phone;
    }
    answers.push({ questionId: q.id, question: q.label, type: q.type, position: q.position, answer: stored });
  }

  // SMS reminder number (BK-13).
  let textReminderNumber: string | null = null;
  const sms = clean(input.invitee.textReminderNumber, 32);
  if (sms) {
    const phone = normalizePhone(sms);
    if (!phone) add("textReminderNumber", MESSAGES.phone);
    else if (SMS_BLOCKED_PREFIXES.some((p) => phone.startsWith(p))) add("textReminderNumber", MESSAGES.smsCountry);
    else textReminderNumber = phone;
  }

  // Time and duration.
  const start = new Date(input.start);
  if (!input.start || Number.isNaN(start.getTime())) add("start", MESSAGES.start);
  const durationMinutes = resolveDuration(target, input.durationMinutes ?? null);
  if (durationMinutes === null) add("duration", MESSAGES.duration);

  const tracking: Tracking = {};
  for (const k of ["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "salesforceUuid"] as const) {
    const v = clean(input.tracking?.[k]);
    if (v) tracking[k] = v;
  }

  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    value: {
      name: name.slice(0, 255),
      firstName,
      lastName,
      email,
      emailNormalized,
      timezone,
      detectedTimezone,
      timeFormat,
      locale,
      guests,
      location: { config, value: locationValue },
      answers,
      textReminderNumber,
      marketingConsent: et.collectMarketingConsent ? input.invitee.marketingConsent === true : false,
      tracking,
      start,
      durationMinutes: durationMinutes!,
    },
  };
}
