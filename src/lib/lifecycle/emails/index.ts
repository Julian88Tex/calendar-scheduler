// Booking lifecycle email templates (SPEC NT-01 to NT-05, NT-20, CR-06, CR-08, CAL-12, VID-12; ARCHITECTURE 13.2).
//
// Pure functions returning { subject, html, text }. The standard meeting emails (confirmation, new event,
// cancellation, reschedule; invitee, guest and host versions) are the shared Calendly-style templates of
// src/lib/email/meeting-templates.ts with the lifecycle notices added here; this file adds the emails only lifecycle
// sends: "{Host} would like to reschedule" (CR-08) and its reminder, the conference failure notice (VID-12) and the
// calendar invitation fallback notice (CAL-12). Every template takes a template context already built for its
// recipient (buildMeetingTemplateContext: zone, time format and locale of that recipient, GEN-06) and the recipient's
// locale; copy comes from the i18n catalogs with English fallback; user text is escaped.
import { meetingDateTimeLine, renderEmail, renderMeetingEmail, type EmailBlock, type EmailBrand, type MeetingEmailInput, type MeetingEmailKind, type RenderedEmail } from "@/lib/email";
import { appName } from "@/lib/brand";
import { getT, resolveLocale } from "@/lib/i18n";
import type { TemplateContext } from "@/lib/template";

export type LifecycleNotice = NonNullable<MeetingEmailInput["notices"]>[number];

export type NoticeFacts = {
  /** Group slots: active invitees and the slot limit ("{n} of {limit} spots filled"). */
  spots?: { filled: number; limit: number } | null;
  /** Round robin host emails ("You were assigned this meeting."). */
  assigned?: boolean;
  /** Poll meetings ("Booked from meeting poll"). */
  pollTitle?: string | null;
  /** Booked over other events of the host (SCH-13): title (null when untitled) and local time text. */
  overlaps?: { title: string | null; time: string }[];
  /** CR-17: the change came from the host's connected calendar. */
  fromCalendar?: boolean;
};

const str = (v: TemplateContext[string]): string => (v === null || v === undefined ? "" : String(v)).trim();

/** The callouts of a meeting email from the facts of that meeting (host emails mostly). */
export function lifecycleNotices(facts: NoticeFacts, locale?: string | null): LifecycleNotice[] {
  const t = getT(resolveLocale(locale), "lifecycle");
  const out: LifecycleNotice[] = [];
  if (facts.fromCalendar) out.push({ tone: "info", text: t("emails.notices.calendarSync") });
  if (facts.pollTitle) out.push({ tone: "info", text: `${t("emails.notices.fromPoll")}: ${facts.pollTitle}` });
  if (facts.assigned) out.push({ tone: "success", text: t("emails.notices.assigned") });
  if (facts.spots) out.push({ tone: "info", text: t("emails.notices.spotsFilled", { filled: facts.spots.filled, limit: facts.spots.limit }) });
  for (const o of (facts.overlaps ?? []).slice(0, 3)) {
    out.push({
      tone: "warning",
      title: t("emails.notices.overlapTitle"),
      text: o.title ? t("emails.notices.overlap", { title: o.title, time: o.time }) : t("emails.notices.overlapUntitled", { time: o.time }),
    });
  }
  return out;
}

export type BookingEmailInput = Omit<MeetingEmailInput, "kind" | "notices"> & { notices?: LifecycleNotice[]; facts?: NoticeFacts };

/** One of the standard meeting emails with lifecycle notices (see the file header). */
export function bookingEmail(kind: MeetingEmailKind, input: BookingEmailInput): RenderedEmail {
  const notices = [...lifecycleNotices(input.facts ?? {}, input.locale), ...(input.notices ?? [])];
  const { facts: _facts, ...rest } = input;
  void _facts;
  return renderMeetingEmail({ ...rest, kind, notices });
}

// ---------------------------------------------------------------------------------------------------------------
// CR-08 "Share new times to meet"

export type RequestRescheduleEmailInput = {
  /** Context of the canceled meeting for the invitee (their zone and time format). */
  ctx: TemplateContext;
  brand: EmailBrand;
  locale?: string | null;
  /** The host's message (optional). */
  message?: string | null;
  /** Where the invitee picks a new time (/reschedulings/{inviteeId}). */
  rebookUrl: string;
  /** The 1, 3 or 7 day reminder version. */
  reminder?: boolean;
};

export function requestRescheduleEmail(p: RequestRescheduleEmailInput): RenderedEmail {
  const locale = resolveLocale(p.locale);
  const t = getT(locale, "lifecycle");
  const c = getT(locale, "common");
  const hostName = str(p.ctx.my_name) || appName();
  const vars = { hostName, eventName: str(p.ctx.event_name), date: str(p.ctx.event_date) };
  const first = str(p.ctx.invitee_first_name);
  const intro = t(p.reminder ? "emails.requestReschedule.reminderIntro" : "emails.requestReschedule.intro", vars);
  const blocks: EmailBlock[] = [
    { kind: "text", text: first ? c("meetingEmail.greeting.named").replace("{{name}}", first) : c("meetingEmail.greeting.plain") },
    { kind: "text", text: intro },
  ];
  const message = (p.message ?? "").trim();
  if (message) blocks.push({ kind: "fields", items: [{ label: t("emails.requestReschedule.messageLabel", { hostName }), value: message }] });
  const when = meetingDateTimeLine(p.ctx);
  blocks.push({
    kind: "fields",
    items: [
      { label: c("meetingEmail.labels.event"), value: str(p.ctx.event_name) },
      ...(when ? [{ label: t("emails.requestReschedule.formerTime"), lines: [{ text: when, strike: true }] }] : []),
    ],
  });
  blocks.push({ kind: "button", label: t("emails.requestReschedule.button"), url: p.rebookUrl });
  return renderEmail({
    subject: t(p.reminder ? "emails.requestReschedule.reminderSubject" : "emails.requestReschedule.subject", vars),
    preheader: intro,
    brand: p.brand,
    locale,
    reason: t("emails.requestReschedule.reason", { hostName }),
    blocks,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// VID-12 conference failure (host)

export type ConferenceFailureEmailInput = {
  /** Host context (host zone and format) of the meeting with its invitee. */
  ctx: TemplateContext;
  brand: EmailBrand;
  /** "Google Meet". */
  provider: string;
  /** conferenceErrorMessage(location.error, location.kind). */
  problem: string;
  meetingUrl: string;
};

export function conferenceFailureEmail(p: ConferenceFailureEmailInput): RenderedEmail {
  const t = getT("en", "lifecycle");
  const c = getT("en", "common");
  const inviteeName = str(p.ctx.invitee_full_name) || c("meetingEmail.labels.invitee");
  const vars = { provider: p.provider, inviteeName, eventName: str(p.ctx.event_name), date: str(p.ctx.event_date) };
  const host = str(p.ctx.my_name);
  const when = meetingDateTimeLine(p.ctx);
  const intro = t("emails.conferenceFailure.intro", vars);
  return renderEmail({
    subject: t("emails.conferenceFailure.subject", vars),
    preheader: intro,
    brand: p.brand,
    locale: "en",
    reason: t("emails.conferenceFailure.reason"),
    blocks: [
      { kind: "text", text: host ? c("meetingEmail.greeting.named").replace("{{name}}", host) : c("meetingEmail.greeting.plain") },
      { kind: "text", text: intro },
      {
        kind: "fields",
        items: [
          { label: c("meetingEmail.labels.eventType"), value: str(p.ctx.event_name) },
          { label: c("meetingEmail.labels.invitee"), value: inviteeName },
          ...(when ? [{ label: c("meetingEmail.labels.dateTime"), value: when }] : []),
          { label: t("emails.conferenceFailure.details"), value: p.problem },
        ],
      },
      { kind: "text", text: t("emails.conferenceFailure.action") },
      { kind: "button", label: t("emails.conferenceFailure.button"), url: p.meetingUrl },
    ],
  });
}

// ---------------------------------------------------------------------------------------------------------------
// CAL-12 calendar invitation fallback (host)

export type CalendarFallbackEmailInput = { ctx: TemplateContext; brand: EmailBrand; meetingUrl: string; problem?: string | null };

export function calendarFallbackEmail(p: CalendarFallbackEmailInput): RenderedEmail {
  const t = getT("en", "lifecycle");
  const c = getT("en", "common");
  const inviteeName = str(p.ctx.invitee_full_name) || c("meetingEmail.labels.invitee");
  const vars = { inviteeName, eventName: str(p.ctx.event_name), date: str(p.ctx.event_date) };
  const host = str(p.ctx.my_name);
  const when = meetingDateTimeLine(p.ctx);
  const intro = t("emails.calendarFallback.intro", vars);
  return renderEmail({
    subject: t("emails.calendarFallback.subject", vars),
    preheader: intro,
    brand: p.brand,
    locale: "en",
    reason: t("emails.calendarFallback.reason"),
    blocks: [
      { kind: "text", text: host ? c("meetingEmail.greeting.named").replace("{{name}}", host) : c("meetingEmail.greeting.plain") },
      { kind: "text", text: intro },
      {
        kind: "fields",
        items: [
          { label: c("meetingEmail.labels.eventType"), value: str(p.ctx.event_name) },
          { label: c("meetingEmail.labels.invitee"), value: inviteeName },
          ...(when ? [{ label: c("meetingEmail.labels.dateTime"), value: when }] : []),
          ...(p.problem?.trim() ? [{ label: t("emails.conferenceFailure.details"), value: p.problem.trim() }] : []),
        ],
      },
      { kind: "text", text: t("emails.calendarFallback.action") },
      { kind: "button", label: t("emails.calendarFallback.button"), url: p.meetingUrl },
    ],
  });
}
