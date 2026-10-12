// The provider calendar event of a booked meeting (SPEC CAL-11, CAL-12, NT-08, MP-19, GEN-08):
//
// - title: the event type's host calendar title (snapshot template, else the event type's calendar title template),
//   else "{{invitee_full_name}} and {{my_name}}" one-on-one, "{{event_name}}" for group slots and meetings with several
//   invitees (polls), "{{event_name}} with {{invitee_full_name}}" with several hosts.
// - description: Calendly's calendar text: event name, invitee and email (or every invitee with "{n} of {limit} spots
//   filled" for group slots), guests, location or the Meet wording, questions and answers (unless excluded), "Need to
//   make changes to this event?" with Cancel and Reschedule links (unless excluded; only when the event holds exactly
//   one invitee, so per-invitee links never land in a description shared by several invitees) and "Booked with
//   {AppName}". Calendar invitation mode uses the host's custom invitation description when set (NT-08).
// - location: address, phone or text; the join URL for standalone conferences; nothing for Google Meet (the event's
//   conference carries it).
// - attendees: calendar invitation mode only (the invitee, guests and co-hosts, sendInvitations = Google sendUpdates=all);
//   email confirmation mode writes no attendees (sendUpdates=none).
import "server-only";
import { createHash } from "node:crypto";
import type { WriteEventInput } from "@/lib/calendars";
import { appName } from "@/lib/brand";
import { calendarConferenceFor, conferenceProviderName, isConferenceKind } from "@/lib/conferencing";
import { richTextToPlain } from "@/lib/html";
import { getT } from "@/lib/i18n";
import { renderTemplate, type TemplateContext } from "@/lib/template";
import { inviteeUrls, joinUrl } from "@/lib/url";
import { activeInvitees, guestsOf, type MeetingBundle } from "./load";

export type CalendarEventInput = Omit<WriteEventInput, "idempotencyKey" | "privateProperties">;

export type CalendarEventOptions = {
  /** The host whose calendar receives the event. */
  hostUserId: string;
  /** Effective notification mode of the meeting (CAL-12). */
  mode: "calendar_invitation" | "email_confirmation";
  /** Template context for the host (zone, format), with the single invitee when there is one. */
  ctx: TemplateContext;
};

/** The host calendar title (see the file header). */
export function calendarTitle(b: MeetingBundle, ctx: TemplateContext): string {
  const snap = b.meeting.settingsSnapshot;
  const custom = snap?.templates?.hostEventTitle?.trim() || b.eventType?.calendarEventTitleTemplate?.trim();
  const shared = b.meeting.isGroup || activeInvitees(b).length !== 1;
  const template = custom
    ? custom
    : shared
      ? "{{event_name}}"
      : b.hosts.length > 1
        ? "{{event_name}} with {{invitee_full_name}}"
        : "{{invitee_full_name}} and {{my_name}}";
  const out = renderTemplate(template, shared && !b.meeting.isGroup ? { ...ctx, invitee_full_name: "" } : ctx).replace(/\s+/g, " ").trim();
  return (out.replace(/^and\s+|\s+and$/i, "").trim() || b.meeting.name).slice(0, 1024);
}

/** Whether the event shows exactly one invitee (manage links and attendees are per invitee). */
export function singleInviteeOf(b: MeetingBundle) {
  const list = activeInvitees(b);
  return !b.meeting.isGroup && list.length === 1 ? list[0]! : null;
}

function locationLines(b: MeetingBundle, t: ReturnType<typeof getT>): string[] {
  const loc = b.meeting.location;
  const out: string[] = [];
  if (loc?.kind && isConferenceKind(loc.kind)) {
    const provider = conferenceProviderName(loc.kind) ?? "web";
    if (calendarConferenceFor(loc.kind) && loc.status !== "failed") {
      // Meet comes with the event itself (Google adds the join button and link): the text never depends on the link,
      // so the event is not rewritten (and invitees not notified again) once Google has created it.
      out.push(t("calendar.webConference", { provider }));
    } else if (loc.joinUrl) {
      out.push(t("calendar.webConference", { provider }));
      out.push(t("calendar.joinFrom"));
      out.push(loc.joinUrl);
    } else {
      out.push(t("calendar.toFollow"));
    }
    out.push(t("calendar.joinLink", { url: joinUrl(b.meeting.id) }));
  } else if (loc?.location?.trim()) {
    out.push(t("calendar.location", { location: loc.location.trim() }));
  }
  if (loc?.additionalInfo?.trim()) out.push(loc.additionalInfo.trim());
  return out;
}

/** The plain text description (see the file header). */
export function calendarDescription(b: MeetingBundle, opts: CalendarEventOptions): string {
  const t = getT("en", "lifecycle");
  const snap = b.meeting.settingsSnapshot;
  const one = singleInviteeOf(b);
  const parts: string[] = [];
  const custom = opts.mode === "calendar_invitation" ? snap?.templates?.invitationDescription?.trim() : undefined;
  if (custom) {
    const rendered = /<[a-z][^>]*>/i.test(custom) ? richTextToPlain(renderTemplate(custom, opts.ctx, { escape: "html" })) : renderTemplate(custom, opts.ctx).trim();
    if (rendered) parts.push(rendered);
  } else {
    parts.push(t("calendar.eventName", { eventName: b.meeting.name }));
    if (b.poll) parts.push(t("calendar.fromPoll", { title: b.poll.title }));
    const list = activeInvitees(b);
    if (one) {
      const guests = guestsOf(b, one.id).map((g) => g.email);
      parts.push(
        [
          t("calendar.invitee", { name: one.name }),
          t("calendar.inviteeEmail", { email: one.email }),
          ...(guests.length ? [t("calendar.guests", { guests: guests.join(", ") })] : []),
        ].join("\n"),
      );
    } else if (list.length) {
      const lines = list.map((i) => `${i.name} (${i.email})`);
      const head = b.meeting.isGroup ? [t("calendar.spotsFilled", { filled: list.length, limit: b.meeting.inviteesLimit })] : [];
      parts.push([...head, t("calendar.invitees"), ...lines].join("\n"));
    }
    const loc = locationLines(b, t);
    if (loc.length) parts.push(loc.join("\n"));
    if (one && snap?.includeAnswersInNotifications !== false) {
      const answers = [...(one.questionsAndAnswers ?? [])]
        .sort((a, c) => a.position - c.position)
        .filter((a) => a.answer?.trim())
        .map((a) => `${a.question}\n${a.answer.trim()}`);
      if (answers.length) parts.push(answers.join("\n\n"));
    }
  }
  if (one && snap?.includeCancelRescheduleLinks !== false) {
    const urls = inviteeUrls(one.id);
    parts.push([t("calendar.needChanges"), t("calendar.cancel", { url: urls.cancel }), t("calendar.reschedule", { url: urls.reschedule })].join("\n"));
  }
  parts.push(t("calendar.footer", { appName: appName() }));
  return parts.join("\n\n").slice(0, 8000);
}

/** The write input of one host's provider event (see the file header). */
export function calendarEventInput(b: MeetingBundle, opts: CalendarEventOptions): CalendarEventInput {
  const m = b.meeting;
  const loc = m.location;
  const isOrganizer = opts.hostUserId === m.organizerUserId;
  const invite = opts.mode === "calendar_invitation" && isOrganizer && !m.isGroup;
  const attendees: CalendarEventInput["attendees"] = [];
  if (invite) {
    for (const i of activeInvitees(b)) {
      attendees.push({ email: i.email, name: i.name });
      for (const g of guestsOf(b, i.id)) attendees.push({ email: g.email });
    }
    for (const h of b.hosts) if (h.userId !== m.organizerUserId && h.isActive) attendees.push({ email: h.email, name: h.name });
  }
  const standaloneJoin = loc?.kind && isConferenceKind(loc.kind) && !calendarConferenceFor(loc.kind) ? loc.joinUrl : null;
  const location = loc?.kind && isConferenceKind(loc.kind) ? standaloneJoin : (loc?.location?.trim() || null);
  // Only the organizer's event carries the conference (VID-13); copies show the join link in the description.
  const conference = isOrganizer && loc?.kind && loc.status !== "failed" ? calendarConferenceFor(loc.kind) : null;
  return {
    title: calendarTitle(b, opts.ctx),
    descriptionText: calendarDescription(b, opts),
    location,
    start: m.startAt,
    end: m.endAt,
    attendees,
    sendInvitations: invite,
    conference,
    transparency: "busy",
    visibility: "default",
    icalUid: m.icsUid,
  };
}

/** A stable fingerprint of a write (an identical rewrite is skipped). */
export function writeFingerprint(input: CalendarEventInput, extra: Record<string, unknown> = {}): string {
  const json = JSON.stringify({
    ...input,
    start: input.start.toISOString(),
    end: input.end.toISOString(),
    attendees: [...input.attendees].map((a) => a.email.toLowerCase()).sort(),
    ...extra,
  });
  return createHash("sha256").update(json).digest("hex").slice(0, 32);
}
