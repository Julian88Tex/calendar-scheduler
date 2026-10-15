// Details form model (SPEC BK-09 to BK-12, BK-14, BK-19): values, client-side validation with the server's field keys
// and messages, the POST /api/public/bookings body, and the mapping of the endpoint's answers to what the page shows.
// Pure and client safe. The server re-validates everything (booking-core); these checks only save a round trip.
import type { LocationKind } from "@/db/types";
import { locationInput, type PublicLocation } from "./locations";
import { bt } from "./t";

export type QuestionType = "string" | "text" | "single_select" | "multi_select" | "dropdown" | "phone_number";

export type PublicQuestion = {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  answerChoices: string[];
  includeOther: boolean;
  position: number;
};

export type FormValues = {
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  guests: string[];
  showGuests: boolean;
  /** Chosen location option id (several options), or null. */
  locationId: string | null;
  /** Phone (outbound call) or text (ask invitee) for the chosen location. */
  locationValue: string;
  /** Question id -> text answer, selected choice, or selected choices. */
  answers: Record<string, string | string[]>;
  /** Question id -> the "Other" free text. */
  other: Record<string, string>;
  /** Question id -> "Other" is selected. */
  otherSelected: Record<string, boolean>;
  /** Phone fields ("location" or a question id) -> the typed text, to tell an invalid number from an empty one. */
  phoneRaw: Record<string, string>;
  marketing: boolean;
};

export type FormContext = {
  nameFormat: "full" | "first_last";
  allowGuests: boolean;
  locations: PublicLocation[];
  questions: PublicQuestion[];
};

export type FieldErrors = Record<string, string>;

export const MAX_ANSWER = 10_000;
export const MAX_GUESTS = 10;
const EMAIL = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;
const E164 = /^\+[1-9]\d{6,14}$/;

export function isEmail(value: string): boolean {
  const v = value.trim();
  return v.length <= 254 && EMAIL.test(v);
}

/** "+1 (415) 555-0123" -> "+14155550123", or null (the server's normalizePhone rule). */
export function toE164(value: string): string | null {
  const compact = value.trim().replace(/[\s().-]/g, "");
  const withPlus = compact.startsWith("00") ? `+${compact.slice(2)}` : compact;
  return E164.test(withPlus) ? withPlus : null;
}

export function emptyValues(): FormValues {
  return {
    name: "",
    firstName: "",
    lastName: "",
    email: "",
    guests: [],
    showGuests: false,
    locationId: null,
    locationValue: "",
    answers: {},
    other: {},
    otherSelected: {},
    phoneRaw: {},
    marketing: false,
  };
}

/** The location the booking uses: the only option, or the chosen one. */
export function chosenLocation(ctx: Pick<FormContext, "locations">, values: Pick<FormValues, "locationId">): PublicLocation | null {
  if (ctx.locations.length === 1) return ctx.locations[0]!;
  return ctx.locations.find((l) => l.id === values.locationId) ?? null;
}

/** Guest emails that are valid, unique and not the invitee's (BK-10). */
export function guestError(guests: readonly string[], inviteeEmail: string): string | null {
  const own = inviteeEmail.trim().toLowerCase();
  const seen = new Set<string>();
  for (const g of guests) {
    const n = g.trim().toLowerCase();
    if (!isEmail(n)) return bt("validation.email");
    if (own && n === own) return bt("validation.guestIsInvitee");
    seen.add(n);
  }
  if (seen.size > MAX_GUESTS) return bt("validation.tooManyGuests");
  return null;
}

/** Field errors keyed like the server's (name, firstName, lastName, email, guests, location, location.value, answers.{id}). */
export function validateForm(values: FormValues, ctx: FormContext): FieldErrors {
  const errors: FieldErrors = {};
  if (ctx.nameFormat === "first_last") {
    if (!values.firstName.trim()) errors.firstName = bt("validation.blank");
    if (!values.lastName.trim()) errors.lastName = bt("validation.blank");
  } else if (!values.name.trim()) errors.name = bt("validation.blank");

  const email = values.email.trim();
  if (!email) errors.email = bt("validation.blank");
  else if (!isEmail(email)) errors.email = bt("validation.email");

  if (ctx.allowGuests && values.guests.length > 0) {
    const g = guestError(values.guests, email);
    if (g) errors.guests = g;
  }

  if (ctx.locations.length > 1 && !chosenLocation(ctx, values)) errors.location = bt("validation.location");
  const input = locationInput(chosenLocation(ctx, values));
  if (input === "phone") {
    if (!values.locationValue.trim()) errors["location.value"] = (values.phoneRaw.location ?? "").trim() ? bt("validation.phone") : bt("validation.blank");
    else if (!toE164(values.locationValue)) errors["location.value"] = bt("validation.phone");
  } else if (input === "text" && !values.locationValue.trim()) errors["location.value"] = bt("validation.blank");

  for (const q of ctx.questions) {
    const key = `answers.${q.id}`;
    const raw = values.answers[q.id];
    if (q.type === "multi_select") {
      const picked = Array.isArray(raw) ? raw.filter(Boolean) : [];
      const other = values.otherSelected[q.id] ? (values.other[q.id] ?? "").trim() : "";
      if (values.otherSelected[q.id] && !other) errors[key] = bt("validation.blank");
      else if (q.required && picked.length === 0 && !other) errors[key] = bt("validation.checkbox");
      continue;
    }
    if (q.type === "single_select" && values.otherSelected[q.id]) {
      const other = (values.other[q.id] ?? "").trim();
      if (!other) errors[key] = bt("validation.blank");
      else if (other.length > MAX_ANSWER) errors[key] = bt("validation.tooLong");
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      if (q.type === "phone_number" && (values.phoneRaw[q.id] ?? "").trim()) errors[key] = bt("validation.phone");
      else if (q.required) errors[key] = q.type === "single_select" || q.type === "dropdown" ? bt("validation.radio") : bt("validation.blank");
      continue;
    }
    if (text.length > MAX_ANSWER) errors[key] = bt("validation.tooLong");
    else if (q.type === "phone_number" && !toE164(text)) errors[key] = bt("validation.phone");
  }
  return errors;
}

/** The answers of the request body: "Other" texts replace the "Other" choice (the server accepts them as answers). */
export function answersOf(values: FormValues, questions: readonly PublicQuestion[]): { questionId: string; value: string | string[] }[] {
  const out: { questionId: string; value: string | string[] }[] = [];
  for (const q of questions) {
    const raw = values.answers[q.id];
    const other = values.otherSelected[q.id] ? (values.other[q.id] ?? "").trim() : "";
    if (q.type === "multi_select") {
      const picked = (Array.isArray(raw) ? raw : []).filter((v) => q.answerChoices.includes(v));
      const all = other ? [...picked, other] : picked;
      if (all.length) out.push({ questionId: q.id, value: all });
      continue;
    }
    if (q.type === "single_select" && other) {
      out.push({ questionId: q.id, value: other });
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) continue;
    out.push({ questionId: q.id, value: q.type === "phone_number" ? (toE164(text) ?? text) : text });
  }
  return out;
}

export type BookingTargetBody = { kind: "event_type" | "single_use" | "one_off" | "shared"; eventTypeId?: string; code?: string; handle?: string; eventSlug?: string };

export type BuildBodyInput = {
  target: BookingTargetBody;
  start: string;
  durationMinutes: number;
  values: FormValues;
  ctx: FormContext;
  collectMarketing: boolean;
  timezone: string;
  detectedTimezone: string | null;
  timeFormat: "12h" | "24h";
  locale: string;
  tracking: Record<string, string>;
  routingFormSubmissionId?: string | null;
  clientRequestId: string;
  formToken: string;
  honeypot: string;
  /** Cloudflare Turnstile token when the instance requires one (BK-18). */
  turnstileToken?: string | null;
  embed: boolean;
};

/** The POST /api/public/bookings body (booking-core bookingRequestSchema). */
export function buildBookingBody(p: BuildBodyInput) {
  const loc = chosenLocation(p.ctx, p.values);
  const input = locationInput(loc);
  const full = p.ctx.nameFormat === "first_last";
  return {
    target: p.target,
    start: p.start,
    durationMinutes: p.durationMinutes,
    invitee: {
      name: full ? `${p.values.firstName.trim()} ${p.values.lastName.trim()}`.trim() : p.values.name.trim(),
      firstName: full ? p.values.firstName.trim() : null,
      lastName: full ? p.values.lastName.trim() : null,
      email: p.values.email.trim(),
      timezone: p.timezone,
      detectedTimezone: p.detectedTimezone,
      timeFormat: p.timeFormat,
      locale: p.locale,
      marketingConsent: p.collectMarketing ? p.values.marketing : false,
    },
    guests: p.ctx.allowGuests ? p.values.guests.map((g) => g.trim()).filter(Boolean) : [],
    locationAnswer: loc
      ? { configId: loc.id, value: input === "phone" ? (toE164(p.values.locationValue) ?? p.values.locationValue.trim()) : input === "text" ? p.values.locationValue.trim() : null }
      : null,
    answers: answersOf(p.values, p.ctx.questions),
    tracking: p.tracking,
    routingFormSubmissionId: p.routingFormSubmissionId ?? null,
    clientRequestId: p.clientRequestId,
    website: p.honeypot,
    formToken: p.formToken,
    ...(p.turnstileToken ? { turnstileToken: p.turnstileToken } : {}),
    embed: p.embed,
  };
}

export type SubmitOutcome =
  | { type: "ok"; inviteeId: string; scheduledEventId: string | null; redirectUrl: string | null }
  | { type: "verify"; reservationId: string }
  | { type: "fields"; fieldErrors: FieldErrors; message: string | null }
  | { type: "slot_taken" }
  | { type: "link_used" }
  | { type: "error"; message: string };

type Body = {
  ok?: boolean;
  code?: string;
  error?: string;
  message?: string;
  inviteeId?: string;
  scheduledEventId?: string;
  redirectUrl?: string;
  reservationId?: string;
  fieldErrors?: Record<string, string[] | string>;
};

function firstErrors(fe: Body["fieldErrors"]): FieldErrors {
  const out: FieldErrors = {};
  for (const [k, v] of Object.entries(fe ?? {})) {
    const msg = Array.isArray(v) ? v[0] : v;
    if (typeof msg === "string" && msg) out[k.replace(/^invitee\./, "")] = msg;
  }
  return out;
}

/** Maps the booking endpoint's answer (status and JSON body) to what the page does next. */
export function interpretBookingResponse(status: number, body: unknown): SubmitOutcome {
  const b = (body && typeof body === "object" ? body : {}) as Body;
  if (b.ok === true && typeof b.inviteeId === "string") {
    return { type: "ok", inviteeId: b.inviteeId, scheduledEventId: b.scheduledEventId ?? null, redirectUrl: typeof b.redirectUrl === "string" ? b.redirectUrl : null };
  }
  const code = b.code ?? b.error;
  switch (code) {
    case "verification_required":
      if (b.reservationId) return { type: "verify", reservationId: b.reservationId };
      return { type: "error", message: bt("errors.generic") };
    case "slot_unavailable":
      return { type: "slot_taken" };
    case "already_booked":
      return { type: "error", message: bt("errors.alreadyBooked") };
    case "link_used":
      return { type: "link_used" };
    case "payment_required":
      return { type: "error", message: bt("errors.payment") };
    case "blocked":
      return { type: "error", message: b.message || bt("errors.blocked") };
    case "rate_limited":
      return { type: "error", message: bt("errors.rateLimited") };
    case "not_found":
      return { type: "error", message: b.message || bt("errors.notFound") };
    case "validation": {
      const fieldErrors = firstErrors(b.fieldErrors);
      if (Object.keys(fieldErrors).length > 0) return { type: "fields", fieldErrors, message: b.message ?? null };
      return { type: "error", message: b.message || bt("errors.generic") };
    }
    default:
      if (status === 429) return { type: "error", message: bt("errors.rateLimited") };
      return { type: "error", message: b.message && status < 500 ? b.message : bt("errors.generic") };
  }
}

/**
 * One "Schedule Event" request at a time (docs/QA_REPORT.md, "Found outside these paths" item 8). The page asks
 * start() synchronously before it sends anything: a second click or a fast double tap while a request is in flight gets
 * false and sends nothing (the disabled button alone cannot stop it, both clicks can run before the re-render that
 * disables it). finish(outcome) ends the request: after a booking ("ok") the form stays locked while the page navigates
 * to the confirmation, so no later answer (such as already_booked for the invitee's own new booking) can flash an
 * error, and finish() then reports false for any further outcome; any other outcome (slot taken, network error,
 * validation, the email code step) releases it for a retry. release() ends a request that stopped before it was sent
 * (the bot check failed). Per page instance: a genuinely new submit later (a new page) is not affected.
 */
export type SubmitGuard = {
  /** True when a request may be sent now; marks it in flight. */
  start(): boolean;
  /** Ends the request with its outcome; false when the page must ignore it (a booking was already made). */
  finish(outcome: SubmitOutcome): boolean;
  /** Ends a request that was never sent. */
  release(): void;
  /** "idle", "in_flight" or "booked". */
  readonly state: "idle" | "in_flight" | "booked";
};

export function createSubmitGuard(): SubmitGuard {
  let state: SubmitGuard["state"] = "idle";
  return {
    start() {
      if (state !== "idle") return false;
      state = "in_flight";
      return true;
    },
    finish(outcome) {
      if (state === "booked") return false;
      state = outcome.type === "ok" ? "booked" : "idle";
      return true;
    },
    release() {
      if (state === "in_flight") state = "idle";
    },
    get state() {
      return state;
    },
  };
}

/** Order of the fields on the page, to focus the first invalid one. */
export function fieldOrder(ctx: FormContext): string[] {
  const out = ctx.nameFormat === "first_last" ? ["firstName", "lastName"] : ["name"];
  out.push("email", "guests", "location", "location.value");
  for (const q of ctx.questions) out.push(`answers.${q.id}`);
  return out;
}

/** True for location kinds whose radio shows an extra field. */
export function kindNeedsInput(kind: LocationKind): boolean {
  return kind === "outbound_call" || kind === "ask_invitee";
}

/**
 * The "By proceeding, you confirm that you have read and agree to ..." sentence shows only when the instance configured
 * a Terms of Use or Privacy Notice URL (instance settings terms_url, privacy_policy_url); without links it says nothing.
 */
export function showsLegalNotice(termsUrl: string | null | undefined, privacyUrl: string | null | undefined): boolean {
  return Boolean(termsUrl?.trim() || privacyUrl?.trim());
}
