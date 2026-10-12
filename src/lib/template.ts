// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Template variables (SPEC NT-07, ARCHITECTURE section 13.2): {{var}} tokens (whitespace inside the braces allowed,
// keys case-insensitive) replaced from a context; unknown variables render as empty text. With escape "html" the
// values are HTML-escaped and line breaks become <br> (the template itself is trusted, already sanitized HTML). Used
// by workflows (subjects and bodies), lifecycle-core (invitation titles, descriptions, confirmation subjects and
// bodies) and polls-core. Pure and client safe (the workflow editor previews with it).

export type TemplateContext = Record<string, string | number | null | undefined>;

export type TemplateVariable = { key: string; label: string; smsOnly?: boolean };

/** NT-07 variables with their "+ Variables" menu labels, in menu order. */
export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  { key: "event_name", label: "Event Name" },
  { key: "my_name", label: "Event Organizer Name" },
  { key: "event_date", label: "Event Date" },
  { key: "event_time", label: "Event Time" },
  { key: "event_end_time", label: "Event End Time" },
  { key: "event_time_zone", label: "Event Time Zone" },
  { key: "event_description", label: "Event Description" },
  { key: "invitees_count", label: "Invitees count" },
  { key: "questions_and_answers", label: "Questions and Answers" },
  ...Array.from({ length: 10 }, (_, i) => ({ key: `answer_${i + 1}`, label: `Answer ${i + 1}` })),
  { key: "invitee_first_name", label: "Invitee First Name" },
  { key: "invitee_last_name", label: "Invitee Last Name" },
  { key: "invitee_full_name", label: "Invitee Full Name" },
  { key: "invitee_email", label: "Invitee Email" },
  { key: "invitee_phone_number", label: "Invitee Phone Number", smsOnly: true },
  { key: "invitee_uuid", label: "Invitee UUID" },
  { key: "guests", label: "Guests" },
  { key: "utm_source", label: "UTM Source" },
  { key: "utm_medium", label: "UTM Medium" },
  { key: "utm_campaign", label: "UTM Campaign" },
  { key: "utm_content", label: "UTM Content" },
  { key: "utm_term", label: "UTM Term" },
  { key: "location", label: "Location" },
  { key: "join_url", label: "Join link" },
  { key: "cancel_url", label: "Cancel link" },
  { key: "reschedule_url", label: "Reschedule link" },
  { key: "reconfirm_url", label: "Reconfirm link" },
];

/** Keys accepted besides the menu (aliases and extra context). */
export const TEMPLATE_ALIASES: Readonly<Record<string, string>> = { host_name: "my_name" };

/** Every supported variable key (menu keys, aliases and the extra NT-07 keys without a menu entry). */
export const TEMPLATE_KEYS: readonly string[] = [
  ...TEMPLATE_VARIABLES.map((v) => v.key),
  ...Object.keys(TEMPLATE_ALIASES),
  "host_email",
  "event_type_url",
];

/** The NT-07 variable list with UI labels. */
export function listTemplateVariables(): { key: string; label: string; smsOnly?: boolean }[] {
  return TEMPLATE_VARIABLES.map((v) => ({ ...v }));
}

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Replaces {{var}} tokens (see the file header). */
export function renderTemplate(template: string, ctx: TemplateContext, opts: { escape?: "html" | "none" } = {}): string {
  if (!template) return "";
  return template.replace(TOKEN, (_m, rawKey: string) => {
    const key = rawKey.toLowerCase();
    const own = (k: string) => (Object.prototype.hasOwnProperty.call(ctx, k) ? ctx[k] : undefined);
    let value = own(key);
    if (value === undefined && Object.prototype.hasOwnProperty.call(TEMPLATE_ALIASES, key)) value = own(TEMPLATE_ALIASES[key]!);
    if (value === null || value === undefined) return "";
    const text = String(value);
    return opts.escape === "html" ? escapeHtml(text).replace(/\r\n|\r|\n/g, "<br>") : text;
  });
}

/** Variable keys used in a template (for validation hints and SMS-only checks). */
export function templateVariablesIn(template: string): string[] {
  return [...new Set([...(template ?? "").matchAll(TOKEN)].map((m) => m[1]!.toLowerCase()))];
}

/** Variables used in a template that the engine does not know (rendered as empty text). */
export function unknownTemplateVariables(template: string): string[] {
  const known = new Set(TEMPLATE_KEYS);
  return templateVariablesIn(template).filter((k) => !known.has(k));
}

/** SMS-only variables used in a template (invitee_phone_number only works in text-to-invitee actions). */
export function smsOnlyVariablesIn(template: string): string[] {
  const smsOnly = new Set(TEMPLATE_VARIABLES.filter((v) => v.smsOnly).map((v) => v.key));
  return templateVariablesIn(template).filter((k) => smsOnly.has(k));
}

/** Sample values for editor previews ("Preview" in the workflow builder). */
export const TEMPLATE_PREVIEW_CONTEXT: Readonly<TemplateContext> = {
  event_name: "30 Minute Meeting",
  my_name: "Jordan Lee",
  host_email: "jordan@example.com",
  event_date: "Tuesday, October 20, 2026",
  event_time: "10:00am",
  event_end_time: "10:30am",
  event_time_zone: "Eastern Time - US & Canada",
  event_description: "A quick call to get to know each other.",
  invitees_count: 1,
  questions_and_answers: "Please share anything that will help prepare for our meeting.\nLooking forward to it.",
  answer_1: "Looking forward to it.",
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`answer_${i + 2}`, ""])),
  utm_source: "newsletter",
  utm_medium: "email",
  utm_campaign: "fall_launch",
  utm_content: "",
  utm_term: "",
  invitee_first_name: "Sam",
  invitee_last_name: "Rivera",
  invitee_full_name: "Sam Rivera",
  invitee_email: "sam@example.com",
  invitee_phone_number: "+1 415 555 0100",
  invitee_uuid: "00000000-0000-4000-8000-000000000000",
  guests: "alex@example.com",
  location: "https://meet.example.com/abc-defg-hij",
  join_url: "https://example.com/events/00000000-0000-4000-8000-000000000000/join",
  cancel_url: "https://example.com/cancellations/00000000-0000-4000-8000-000000000000",
  reschedule_url: "https://example.com/reschedulings/00000000-0000-4000-8000-000000000000",
  reconfirm_url: "https://example.com/reconfirm/00000000-0000-4000-8000-000000000000",
  event_type_url: "https://example.com/jordan/30min",
};
