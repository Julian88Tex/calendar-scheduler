// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Calendly-style meeting emails (SPEC NT-01 to NT-04, NT-09, BK-22, NT-05) rendered from a template context
// (buildMeetingTemplateContext for the recipient, so times are already in the recipient's zone, time format and locale):
//
//   const ctx = await buildMeetingTemplateContext({ scheduledEventId, inviteeId, recipient: "invitee" });
//   const email = renderMeetingEmail({ kind: "invitee_confirmation", ctx, brand, location: event.location,
//     questions: invitee.questionsAndAnswers, manageLinks: snapshot.includeCancelRescheduleLinks,
//     addToCalendar: addToCalendarLinks({ ... }) });
//   await sendEmail({ ...email, to: [invitee.email], ics: { method: "REQUEST", content: ics.content }, ... });
//
// Every kind follows Calendly's notification structure: greeting, one sentence saying what happened, labelled detail
// blocks (Event, Event Date/Time, Location with "Join now", Invitee Time Zone, Questions), the "Need to make changes to
// this event?" Cancel | Reschedule links (never for guests), "Add to calendar" links on invitee confirmations, a "View
// event in {AppName}" button on host emails and "Schedule again" on invitee cancellations. Custom subjects and bodies
// (NT-08 confirmation templates, NT-09 reminders, workflow messages) replace the defaults; the link block is still
// appended when manage links are on. Copy comes from the i18n `common` namespace (meetingEmail.*) in the recipient's
// locale; user-entered text is never translated and always escaped. Pure (no I/O).
import type { LocationKind, ResolvedLocation } from "@/db/types";
import { appName } from "../brand";
import { getT } from "../i18n";
import { resolveLocale } from "../i18n/locales";
import { renderTemplate, type TemplateContext } from "../template";
import { renderEmail, type EmailBlock, type EmailField, type EmailFieldLine } from "./blocks";
import type { AddToCalendarLink } from "./calendar-links";
import { htmlToText, safeHref } from "./html";
import type { EmailBrand, RenderedEmail } from "./types";

export type MeetingEmailKind =
  | "invitee_confirmation"
  | "guest_confirmation"
  | "host_new_event"
  | "invitee_canceled"
  | "guest_canceled"
  | "host_canceled"
  | "invitee_rescheduled"
  | "guest_rescheduled"
  | "host_rescheduled"
  | "invitee_reminder"
  | "host_reminder";

export type MeetingEmailInput = {
  kind: MeetingEmailKind;
  /** buildMeetingTemplateContext for this recipient (zone, time format and locale already applied). */
  ctx: TemplateContext;
  brand: EmailBrand;
  /** The recipient's locale (defaults to English). */
  locale?: string | null;
  /** The meeting location: conference wording ("This is a Google Meet web conference." + "Join now"), venue notes. */
  location?: Pick<ResolvedLocation, "kind" | "location" | "additionalInfo" | "joinUrl"> | null;
  /** The invitee's answers (each question on its own, multi-line answers kept). Falls back to ctx.questions_and_answers. */
  questions?: { question: string; answer: string }[] | null;
  /** Show the Questions block (the meeting's includeAnswersInNotifications; default true, never for guests). */
  includeAnswers?: boolean;
  /** Show the event description (default false; Calendly shows it only when the template includes it). */
  includeDescription?: boolean;
  /** Cancel and Reschedule links (the meeting's includeCancelRescheduleLinks; default true; never for guests). */
  manageLinks?: boolean;
  /** "Add to calendar" links (BK-22) on invitee and guest confirmations and reschedules. */
  addToCalendar?: AddToCalendarLink[] | null;
  /** Host emails: the meeting in the dashboard ("View event in {AppName}"). */
  meetingUrl?: string | null;
  /** Host emails: the invitee's own time zone label (default ctx.invitee_time_zone). Invitee emails use ctx.event_time_zone. */
  inviteeTimeZone?: string | null;
  /** Cancellations: who canceled (a name) and the reason. */
  cancellation?: { canceledBy?: string | null; reason?: string | null } | null;
  /** Reschedules: the former meeting's context for this recipient (struck-through "Former Time") and the reason. */
  former?: { ctx: TemplateContext; reason?: string | null } | null;
  /** Custom subject template ({{variables}}), e.g. the event type's confirmation subject or a workflow subject. */
  subjectTemplate?: string | null;
  /** Custom body template: trusted, sanitized rich text HTML with {{variables}} (values are escaped). */
  bodyTemplate?: string | null;
  /** Extra callouts: booked-over alerts, "You were assigned this meeting.", "{n} of {limit} spots filled". */
  notices?: { tone: "info" | "warning" | "success"; text: string; title?: string | null }[];
  /** A payment receipt line ("Paid $50.00 USD"). */
  paymentLine?: string | null;
  /** Preheader override (defaults to the intro sentence). */
  preheader?: string | null;
};

const CONFERENCE_PROVIDER: Partial<Record<LocationKind, string>> = {
  google_conference: "location.googleMeet",
  zoom_conference: "location.zoom",
  microsoft_teams_conference: "location.microsoftTeams",
  jitsi_conference: "location.jitsi",
  webex_conference: "location.webex",
  gotomeeting_conference: "location.gotomeeting",
};

type Audience = "invitee" | "guest" | "host";

const AUDIENCE: Record<MeetingEmailKind, Audience> = {
  invitee_confirmation: "invitee",
  guest_confirmation: "guest",
  host_new_event: "host",
  invitee_canceled: "invitee",
  guest_canceled: "guest",
  host_canceled: "host",
  invitee_rescheduled: "invitee",
  guest_rescheduled: "guest",
  host_rescheduled: "host",
  invitee_reminder: "invitee",
  host_reminder: "host",
};

// Copy keys per kind in common.meetingEmail (templates with {{variables}}).
const COPY: Record<MeetingEmailKind, { subject: string; intro: string }> = {
  invitee_confirmation: { subject: "subjects.confirmed", intro: "intro.confirmed" },
  guest_confirmation: { subject: "subjects.confirmed", intro: "intro.confirmed" },
  host_new_event: { subject: "subjects.newEvent", intro: "intro.newEvent" },
  invitee_canceled: { subject: "subjects.canceled", intro: "intro.canceled" },
  guest_canceled: { subject: "subjects.canceled", intro: "intro.canceled" },
  host_canceled: { subject: "subjects.hostCanceled", intro: "intro.hostCanceled" },
  invitee_rescheduled: { subject: "subjects.updated", intro: "intro.updated" },
  guest_rescheduled: { subject: "subjects.updated", intro: "intro.updated" },
  host_rescheduled: { subject: "subjects.rescheduled", intro: "intro.rescheduled" },
  invitee_reminder: { subject: "subjects.reminder", intro: "intro.reminder" },
  host_reminder: { subject: "subjects.hostReminder", intro: "intro.hostReminder" },
};

const str = (v: TemplateContext[string]): string => (v === null || v === undefined ? "" : String(v)).trim();

/** "10:00am - Tuesday, October 20, 2026 (Eastern Time - US & Canada)": Calendly's Event Date/Time line, in the context's zone and format. */
export function meetingDateTimeLine(ctx: TemplateContext): string {
  const time = str(ctx.event_time);
  const date = str(ctx.event_date);
  const zone = str(ctx.event_time_zone);
  const when = [time, date].filter(Boolean).join(" - ");
  return when ? `${when}${zone ? ` (${zone})` : ""}` : "";
}

/**
 * The Location block lines: "This is a Google Meet web conference." with a "Join now" link (the stable join URL) once
 * the conference exists, "Web conferencing details to follow." before that; otherwise the venue, phone or text, with
 * the location notes under it.
 */
export function meetingLocationLines(
  ctx: TemplateContext,
  location: MeetingEmailInput["location"],
  locale: string,
): EmailFieldLine[] {
  const t = getT(locale, "common");
  const lines: EmailFieldLine[] = [];
  const providerKey = location?.kind ? CONFERENCE_PROVIDER[location.kind] : undefined;
  if (providerKey) {
    const join = safeHref(str(ctx.join_url)) || safeHref(location?.joinUrl ?? "");
    if (location?.joinUrl && join) {
      lines.push(t("location.webConference", { provider: t(providerKey) }));
      lines.push({ text: t("location.joinNow"), href: join });
    } else {
      lines.push(t("location.conferencingToFollow"));
    }
  } else {
    const text = str(ctx.location) || (location?.location ?? "").trim();
    if (text) lines.push(/^https?:\/\//i.test(text) && safeHref(text) ? { text, href: text } : text);
  }
  const notes = (location?.additionalInfo ?? "").trim();
  if (notes) lines.push({ text: notes, muted: true });
  return lines;
}

function questionsField(input: MeetingEmailInput, label: string): EmailField | null {
  const list = (input.questions ?? []).filter((q) => q.answer?.trim());
  if (list.length) {
    const lines: EmailFieldLine[] = [];
    list.forEach((q, i) => {
      if (i > 0) lines.push("");
      lines.push({ text: q.question, muted: true });
      lines.push(q.answer.trim());
    });
    return { label, lines };
  }
  const flat = str(input.ctx.questions_and_answers);
  return flat ? { label, value: flat } : null;
}

/** The labelled detail blocks of a meeting email (exported for previews and custom layouts). */
export function meetingEmailFields(input: MeetingEmailInput): EmailField[] {
  const locale = resolveLocale(input.locale);
  const t = getT(locale, "common");
  const L = (k: string) => t(`meetingEmail.labels.${k}`);
  const { ctx } = input;
  const audience = AUDIENCE[input.kind];
  const host = audience === "host";
  const kind = input.kind;
  const canceled = kind.endsWith("_canceled");
  const rescheduled = kind.endsWith("_rescheduled");
  const reminder = kind.endsWith("_reminder");
  const fields: EmailField[] = [];

  fields.push({ label: host ? L("eventType") : L("event"), value: str(ctx.event_name) });
  if (host) {
    fields.push({ label: L("invitee"), value: str(ctx.invitee_full_name) });
    const email = str(ctx.invitee_email);
    if (email) fields.push({ label: L("inviteeEmail"), lines: [{ text: email, href: `mailto:${email}` }] });
    const guests = str(ctx.guests);
    if (guests && !canceled) fields.push({ label: L("guests"), value: guests });
  }
  const when = meetingDateTimeLine(ctx);
  if (when) fields.push({ label: L("dateTime"), lines: [canceled ? { text: when, strike: true } : when] });
  if (rescheduled && input.former) {
    const former = meetingDateTimeLine(input.former.ctx);
    if (former) fields.push({ label: L("formerTime"), lines: [{ text: former, strike: true }] });
  }
  if (!canceled) {
    const loc = meetingLocationLines(ctx, input.location, locale);
    if (loc.length) fields.push({ label: L("location"), lines: loc });
  }
  const zone = host ? str(input.inviteeTimeZone) || str(ctx.invitee_time_zone) : str(ctx.event_time_zone);
  if (zone && !reminder) fields.push({ label: L("inviteeTimeZone"), value: zone });
  if (canceled && input.cancellation) {
    const by = str(input.cancellation.canceledBy);
    if (by) fields.push({ label: L("canceledBy"), value: by });
    const reason = str(input.cancellation.reason);
    if (reason) fields.push({ label: L("reason"), value: reason });
  }
  if (rescheduled && input.former) {
    const reason = str(input.former.reason);
    if (reason) fields.push({ label: L("rescheduleReason"), value: reason });
  }
  if (input.includeAnswers !== false && audience !== "guest" && !canceled && !reminder) {
    const q = questionsField(input, L("questions"));
    if (q) fields.push(q);
  }
  if (input.includeDescription && !canceled) {
    const d = str(ctx.event_description);
    if (d) fields.push({ label: L("description"), value: d });
  }
  if (input.paymentLine?.trim()) fields.push({ label: L("payment"), value: input.paymentLine.trim() });
  return fields;
}

/** Renders one meeting email (subject, HTML and text) per the file header. */
export function renderMeetingEmail(input: MeetingEmailInput): RenderedEmail {
  const locale = resolveLocale(input.locale);
  const t = getT(locale, "common");
  const M = (k: string) => t(`meetingEmail.${k}`);
  const { ctx } = input;
  const audience = AUDIENCE[input.kind];
  const copy = COPY[input.kind];
  const canceled = input.kind.endsWith("_canceled");
  const vars: TemplateContext = { ...ctx, app_name: appName() };

  const subject = renderTemplate(input.subjectTemplate?.trim() || M(copy.subject), vars);
  const firstName = str(ctx.invitee_first_name);
  const greeting =
    audience === "host"
      ? str(ctx.my_name)
        ? renderTemplate(M("greeting.named"), { name: str(ctx.my_name) })
        : M("greeting.plain")
      : audience === "invitee" && firstName
        ? renderTemplate(M("greeting.named"), { name: firstName })
        : M("greeting.plain");
  const intro = renderTemplate(M(copy.intro), vars);

  const blocks: EmailBlock[] = [];
  const custom = input.bodyTemplate?.trim();
  if (custom) {
    // User-authored body (NT-08, NT-09, workflows): trusted rich text with escaped variable values.
    const html = renderTemplate(custom, vars, { escape: "html" });
    blocks.push(/<[a-z][^>]*>/i.test(custom) ? { kind: "html", html, text: htmlToText(html) } : { kind: "text", text: renderTemplate(custom, vars) });
    for (const n of input.notices ?? []) blocks.push({ kind: "notice", tone: n.tone, title: n.title ?? null, text: n.text });
  } else {
    blocks.push({ kind: "text", text: greeting });
    blocks.push({ kind: "text", text: intro });
    for (const n of input.notices ?? []) blocks.push({ kind: "notice", tone: n.tone, title: n.title ?? null, text: n.text });
    blocks.push({ kind: "fields", items: meetingEmailFields({ ...input, locale }) });
  }

  if (audience === "host" && input.meetingUrl && safeHref(input.meetingUrl)) {
    blocks.push({ kind: "button", label: renderTemplate(M("viewEvent"), vars), url: input.meetingUrl });
  }
  const manage = input.manageLinks !== false && audience === "invitee";
  if (manage && !canceled) {
    const links = [
      { label: t("meeting.cancel"), url: str(ctx.cancel_url) },
      { label: t("meeting.reschedule"), url: str(ctx.reschedule_url) },
    ].filter((l) => safeHref(l.url));
    if (links.length) blocks.push({ kind: "links", text: t("meeting.needChanges"), links });
  }
  if (manage && canceled && safeHref(str(ctx.event_type_url))) {
    blocks.push({ kind: "button", label: M("scheduleAgain"), url: str(ctx.event_type_url) });
  }
  const calendarLinks = (input.addToCalendar ?? []).filter((l) => safeHref(l.url));
  if (audience !== "host" && !canceled && !input.kind.endsWith("_reminder") && calendarLinks.length) {
    blocks.push({ kind: "links", text: t("meeting.addToCalendar"), links: calendarLinks.map((l) => ({ label: l.label, url: l.url })) });
  }

  const reasonKey = audience === "host" ? "reason.host" : audience === "guest" ? "reason.guest" : "reason.invitee";
  return renderEmail({
    subject,
    preheader: input.preheader?.trim() || intro,
    brand: input.brand,
    locale,
    reason: renderTemplate(M(reasonKey), vars),
    blocks,
  });
}
