// Prefill via URL parameters (SPEC BK-15). Pure and client safe.
//
//   parsePrefill(searchParams, { questions, durationOptions })
//
// Supported: name, first_name, last_name, email, location (location answer: the phone for outbound call or the
// ask-invitee text), a1 to a10 (answers by question order: text for text types, 1-based option indexes for radios and
// checkboxes such as a3=2,3, exact answer text for dropdowns), guests (comma separated), utm_source, utm_medium,
// utm_campaign, utm_content, utm_term, salesforce_uuid (tracking), duration, routing_form_submission. Values arrive URL
// decoded (URLSearchParams or Next searchParams); invalid values are ignored silently. "Other" texts and the SMS number
// cannot be prefilled (Calendly parity).
import type { Tracking } from "@/db/types";

export type PrefillQuestion = {
  id: string;
  position: number;
  type: "string" | "text" | "single_select" | "multi_select" | "dropdown" | "phone_number";
  answerChoices: string[];
  enabled?: boolean;
};

export type BookingPrefill = {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  /** Location answer text (outbound call phone or ask-invitee text). */
  location?: string;
  /** Question id -> answer (string, or the selected options for checkboxes). */
  answers: Record<string, string | string[]>;
  guests: string[];
  tracking: Tracking;
  durationMinutes?: number;
  routingFormSubmissionId?: string;
};

export type PrefillSource = URLSearchParams | Record<string, string | string[] | undefined | null>;

export const MAX_PREFILL_TEXT = 10_000;
export const MAX_GUESTS = 10;
const MAX_SHORT = 255;

const EMAIL = /^[^\s@<>(),;:"[\]\\]+@[^\s@<>(),;:"[\]\\]+\.[^\s@<>(),;:"[\]\\]+$/;
const PHONE = /^\+?[0-9][0-9 ().-]{4,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** True for a plausible email address (the form re-validates on submit). */
export function looksLikeEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}

function read(source: PrefillSource, key: string): string | undefined {
  let raw: string | null | undefined;
  if (source instanceof URLSearchParams) raw = source.get(key);
  else {
    const v = source[key];
    raw = Array.isArray(v) ? v[0] : v;
  }
  if (typeof raw !== "string") return undefined;
  // Strip control characters (keeps line breaks for multi-line answers).
  const cleaned = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return cleaned ? cleaned : undefined;
}

/** A single-line value (names, email, location, tracking): line breaks and tabs become one space. */
function short(source: PrefillSource, key: string): string | undefined {
  const v = read(source, key)?.replace(/[\t\r\n\u2028\u2029]+/g, " ").replace(/ {2,}/g, " ").trim();
  return v && v.length <= MAX_SHORT ? v : undefined;
}

/** 1-based option indexes ("2,3") to choices; invalid entries are skipped. */
function choicesByIndex(value: string, choices: readonly string[]): string[] {
  const out: string[] = [];
  for (const part of value.split(",")) {
    const p = part.trim();
    if (!/^\d{1,3}$/.test(p)) continue;
    const choice = choices[Number(p) - 1];
    if (choice !== undefined && !out.includes(choice)) out.push(choice);
  }
  return out;
}

function answerFor(q: PrefillQuestion, value: string): string | string[] | undefined {
  switch (q.type) {
    case "string":
    case "text":
      return value.length <= MAX_PREFILL_TEXT ? value : undefined;
    case "phone_number":
      return PHONE.test(value) ? value : undefined;
    case "single_select": {
      const picked = choicesByIndex(value, q.answerChoices);
      return picked.length === 1 && !value.includes(",") ? picked[0] : undefined;
    }
    case "multi_select": {
      const picked = choicesByIndex(value, q.answerChoices);
      return picked.length > 0 ? picked : undefined;
    }
    case "dropdown":
      return q.answerChoices.find((c) => c.trim() === value) ?? undefined;
    default:
      return undefined;
  }
}

/** Parses the BK-15 prefill parameters (see the file header). */
export function parsePrefill(
  source: PrefillSource,
  opts: { questions?: readonly PrefillQuestion[]; durationOptions?: readonly number[] | null } = {},
): BookingPrefill {
  const out: BookingPrefill = { answers: {}, guests: [], tracking: {} };

  const name = short(source, "name");
  if (name) out.name = name;
  const firstName = short(source, "first_name");
  if (firstName) out.firstName = firstName;
  const lastName = short(source, "last_name");
  if (lastName) out.lastName = lastName;
  const email = short(source, "email");
  if (email && looksLikeEmail(email)) out.email = email;
  const location = short(source, "location");
  if (location) out.location = location;

  const questions = [...(opts.questions ?? [])]
    .filter((q) => q.enabled !== false)
    .sort((a, b) => a.position - b.position);
  for (let i = 0; i < Math.min(10, questions.length); i++) {
    const q = questions[i]!;
    const raw = read(source, `a${i + 1}`);
    if (raw === undefined) continue;
    const answer = answerFor(q, raw);
    if (answer !== undefined) out.answers[q.id] = answer;
  }

  const guestsRaw = read(source, "guests");
  if (guestsRaw) {
    const seen = new Set<string>(out.email ? [out.email.toLowerCase()] : []);
    for (const part of guestsRaw.split(/[,\s;]+/)) {
      const g = part.trim();
      if (!g || !looksLikeEmail(g)) continue;
      const key = g.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.guests.push(g);
      if (out.guests.length >= MAX_GUESTS) break;
    }
  }

  const tracking: [keyof Tracking, string][] = [
    ["utmSource", "utm_source"],
    ["utmMedium", "utm_medium"],
    ["utmCampaign", "utm_campaign"],
    ["utmContent", "utm_content"],
    ["utmTerm", "utm_term"],
    ["salesforceUuid", "salesforce_uuid"],
  ];
  for (const [key, param] of tracking) {
    const v = short(source, param);
    if (v) out.tracking[key] = v;
  }

  const duration = read(source, "duration");
  if (duration && /^\d{1,3}$/.test(duration)) {
    const n = Number(duration);
    const allowed = opts.durationOptions;
    if (n >= 1 && n <= 720 && (!allowed || allowed.length === 0 || allowed.includes(n))) out.durationMinutes = n;
  }

  const routing = read(source, "routing_form_submission");
  if (routing && UUID.test(routing)) out.routingFormSubmissionId = routing.toLowerCase();

  return out;
}
