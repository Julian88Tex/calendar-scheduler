// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Template variables (SPEC NT-07, ARCHITECTURE section 13.2): {{var}} tokens (whitespace inside the braces allowed)
// replaced from a context; unknown variables render as empty text. With escape "html" the values are HTML-escaped
// (the template itself is trusted, already sanitized HTML). Pure and client safe.

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
    let value = ctx[key];
    if (value === undefined && TEMPLATE_ALIASES[key]) value = ctx[TEMPLATE_ALIASES[key]!];
    if (value === null || value === undefined) return "";
    const text = String(value);
    return opts.escape === "html" ? escapeHtml(text).replace(/\r?\n/g, "<br>") : text;
  });
}

/** Variable keys used in a template (for validation hints and SMS-only checks). */
export function templateVariablesIn(template: string): string[] {
  return [...new Set([...template.matchAll(TOKEN)].map((m) => m[1]!.toLowerCase()))];
}
