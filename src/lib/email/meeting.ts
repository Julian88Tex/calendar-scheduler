// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Meeting email helpers shared by lifecycle-core, workflows, polls-core and links-sharing, so every module applies the
// same rules:
// - emailBrandForUser: the header image (logo, else avatar) and the "Powered by" switch from the host's branding (NT-05).
// - meetingSender: From display name "{Host name} via {AppName}" and Reply-To the host's email for invitee-facing
//   meeting emails, omitted when the host turned on "Use a no-reply address for invitee emails" (NT-20).
// - buildMeetingIcs: the ICS of a meeting with the NT-06 rules read from the schema: UID (the provider iCal UID in
//   calendar invitation mode, `{inviteeId}@{host}` for group invitees, else scheduled_events.ics_uid), SEQUENCE
//   (scheduled_events.ics_sequence), ORGANIZER the organizer host, ATTENDEE the invitee, guests and co-hosts (RSVP),
//   SUMMARY the invitee-facing title (template, else "{event} with {host}"; host copies: the host calendar title of
//   CAL-11), DESCRIPTION and LOCATION as NT-01 (calendar invitation mode: the host's invitation description template),
//   URL the confirmation page, METHOD REQUEST, CANCEL or PUBLISH with STATUS CONFIRMED or CANCELLED. A meeting poll
//   booked from a date-only option is an all-day event (DTSTART;VALUE=DATE) on that date (meetingAllDayDate).
import "server-only";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { inviteeGuests, invitees, meetingPollOptions, meetingPolls, scheduledEventHosts, scheduledEvents, users } from "@/db/schema";
import { DEFAULT_NOTIFICATION_PREFS } from "@/db/types";
import { appName } from "../brand";
import { getT, resolveLocale } from "../i18n";
import { renderTemplate } from "../template";
import { buildMeetingTemplateContext, isConferenceKind, locationText } from "../template-context";
import { addDays, isValidZone, localDateOf, startOfLocalDay } from "../time/luxon";
import { appHost, fileAbsoluteUrl, inviteeUrls, joinUrl } from "../url";
import { htmlToText } from "./html";
import { buildIcs, icsUid } from "./ical";
import type { EmailBrand } from "./types";

/** The email header image and footer switch of a host (NT-05). Unknown users get the plain product layout. */
export async function emailBrandForUser(userId: string | null | undefined, db?: DbOrTx): Promise<EmailBrand> {
  if (!userId) return { showPoweredBy: true };
  const d = db ?? (await getDb());
  const [u] = await d
    .select({ avatarFileId: users.avatarFileId, avatarUrl: users.avatarUrl, logoFileId: users.logoFileId, showBranding: users.showBranding })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return { showPoweredBy: true };
  return {
    logoUrl: u.logoFileId ? fileAbsoluteUrl(u.logoFileId) : null,
    avatarUrl: u.avatarFileId ? fileAbsoluteUrl(u.avatarFileId) : (u.avatarUrl ?? null),
    showPoweredBy: u.showBranding,
  };
}

export type MeetingSender = { fromName: string; replyTo: string | null };

/**
 * From name and Reply-To for meeting emails (NT-20). audience "invitee": "{Host} via {AppName}" and the host's email
 * (null with the no-reply setting); "host": "{AppName}" and `replyTo` (for example the invitee) when given.
 */
export async function meetingSender(p: {
  hostUserId: string;
  audience: "invitee" | "host";
  replyTo?: string | null;
  db?: DbOrTx;
}): Promise<MeetingSender> {
  if (p.audience === "host") return { fromName: appName(), replyTo: p.replyTo ?? null };
  const d = p.db ?? (await getDb());
  const [u] = await d
    .select({ name: users.name, email: users.email, prefs: users.notificationPrefs })
    .from(users)
    .where(eq(users.id, p.hostUserId))
    .limit(1);
  if (!u) return { fromName: appName(), replyTo: null };
  const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...(u.prefs ?? {}) };
  return {
    fromName: `${u.name} via ${appName()}`,
    replyTo: p.replyTo !== undefined ? p.replyTo : prefs.noReplyInviteeEmails ? null : u.email,
  };
}

export type BuildMeetingIcsInput = {
  scheduledEventId: string;
  /** The invitee the file is for (attendees: that invitee, their guests and the co-hosts). */
  inviteeId?: string | null;
  method: "REQUEST" | "CANCEL" | "PUBLISH";
  /** Defaults to scheduled_events.ics_sequence. */
  sequence?: number;
  /** Overrides the NT-06 UID choice (hidden poll invites use `{inviteeId}@{host}`). */
  uid?: string;
  /**
   * Whose calendar the file is for (default "invitee"). "host": the host calendar title (the event type's host title
   * template, else CAL-11: "{{invitee_full_name}} and {{my_name}}" one-on-one, "{{event_name}}" group,
   * "{{event_name}} with {{invitee_full_name}}" with several hosts), for hosts without a writable calendar (NT-02).
   */
  audience?: "invitee" | "host";
  /** Overrides the title. */
  summary?: string;
  /** Overrides the generated description. */
  description?: string;
  /** Cancel and reschedule links in the description (default: the meeting setting; never for CANCEL). */
  manageLinks?: boolean;
  /** Include guests as attendees (default true). */
  includeGuests?: boolean;
  locale?: string | null;
  db?: DbOrTx;
};

/** A template body (plain text, or rich text HTML from the editor) rendered to plain text for an ICS description. */
function templateToPlainText(template: string, ctx: Record<string, string | number | null | undefined>): string {
  if (/<[a-z][^>]*>/i.test(template)) return htmlToText(renderTemplate(template, ctx, { escape: "html" }));
  return renderTemplate(template, ctx).replace(/\r\n?/g, "\n").trim();
}

export type MeetingIcs = {
  content: string;
  uid: string;
  sequence: number;
  method: "REQUEST" | "CANCEL" | "PUBLISH";
  filename: string;
  /** The date of an all-day meeting (a poll booked from a date-only option), for "Add to calendar" links; else null. */
  allDayDate: string | null;
};

/**
 * The local date ("YYYY-MM-DD") of a meeting poll booked from a date-only option (MP-18: an all-day meeting), else
 * null. The meeting must still span exactly that day of the poll zone (local midnight to the next one, 23 to 25 hours
 * across daylight saving changes), so a meeting moved in place to a timed option keeps its times.
 */
export async function meetingAllDayDate(
  event: Pick<typeof scheduledEvents.$inferSelect, "source" | "pollId" | "startAt" | "endAt">,
  db?: DbOrTx,
): Promise<string | null> {
  if (event.source !== "poll" || !event.pollId) return null;
  const d = db ?? (await getDb());
  const [poll] = await d.select({ timezone: meetingPolls.timezone }).from(meetingPolls).where(eq(meetingPolls.id, event.pollId)).limit(1);
  if (!poll || !isValidZone(poll.timezone)) return null;
  const date = localDateOf(event.startAt, poll.timezone);
  const dayStart = startOfLocalDay(date, poll.timezone).getTime();
  const dayEnd = startOfLocalDay(addDays(date, 1), poll.timezone).getTime();
  if (event.startAt.getTime() !== dayStart || event.endAt.getTime() !== dayEnd) return null;
  const [option] = await d
    .select({ id: meetingPollOptions.id })
    .from(meetingPollOptions)
    .where(and(eq(meetingPollOptions.pollId, event.pollId), eq(meetingPollOptions.allDayDate, date)))
    .limit(1);
  return option ? date : null;
}

/** The ICS of one meeting following NT-06 (see the file header); null when the meeting does not exist. */
export async function buildMeetingIcs(p: BuildMeetingIcsInput): Promise<MeetingIcs | null> {
  const db = p.db ?? (await getDb());
  const [row] = await db
    .select({ event: scheduledEvents, organizer: { name: users.name, email: users.email, showBranding: users.showBranding } })
    .from(scheduledEvents)
    .leftJoin(users, eq(users.id, scheduledEvents.organizerUserId))
    .where(eq(scheduledEvents.id, p.scheduledEventId))
    .limit(1);
  if (!row) return null;
  const { event, organizer } = row;
  const snapshot = event.settingsSnapshot;
  const invitee = p.inviteeId
    ? ((await db
        .select()
        .from(invitees)
        .where(and(eq(invitees.id, p.inviteeId), eq(invitees.scheduledEventId, event.id)))
        .limit(1))[0] ?? null)
    : null;
  const locale = resolveLocale(p.locale ?? invitee?.locale ?? event.locale ?? snapshot?.locale);
  const t = getT(locale, "common");

  const uid =
    p.uid ??
    (snapshot?.notificationMode === "calendar_invitation" && event.providerIcalUid
      ? event.providerIcalUid
      : event.isGroup && invitee
        ? icsUid(invitee.id, appHost())
        : event.icsUid);

  // Attendees: the invitee (or every active invitee for a host copy of a one-on-one), guests, co-hosts.
  const attendeeRows = invitee
    ? [invitee]
    : event.isGroup
      ? []
      : await db
          .select()
          .from(invitees)
          .where(and(eq(invitees.scheduledEventId, event.id), eq(invitees.status, "active")));
  const guests =
    p.includeGuests === false || !attendeeRows.length
      ? []
      : await db
          .select({ email: inviteeGuests.email })
          .from(inviteeGuests)
          .where(and(inArray(inviteeGuests.inviteeId, attendeeRows.map((i) => i.id)), isNull(inviteeGuests.canceledAt)))
          .orderBy(asc(inviteeGuests.createdAt));
  const cohosts = await db
    .select({ name: users.name, email: users.email })
    .from(scheduledEventHosts)
    .innerJoin(users, eq(users.id, scheduledEventHosts.userId))
    .where(and(eq(scheduledEventHosts.scheduledEventId, event.id), ne(scheduledEventHosts.userId, event.organizerUserId)))
    .orderBy(asc(scheduledEventHosts.createdAt));

  const forHost = p.audience === "host";
  // Host copies of a one-on-one name the invitee even when the file is not built for one invitee.
  const ctxInvitee = invitee ?? (forHost && !event.isGroup ? (attendeeRows[0] ?? null) : null);
  const ctx = await buildMeetingTemplateContext({
    scheduledEventId: event.id,
    inviteeId: ctxInvitee?.id ?? null,
    recipient: forHost ? "host" : invitee ? "invitee" : "other",
    locale,
    db,
  });
  const titleTemplate = (forHost ? snapshot?.templates?.hostEventTitle : snapshot?.templates?.inviteeEventTitle)?.trim();
  const summary = (
    p.summary ??
    (titleTemplate
      ? renderTemplate(titleTemplate, ctx)
      : forHost
        ? renderTemplate(
            event.isGroup
              ? "{{event_name}}"
              : cohosts.length
                ? "{{event_name}} with {{invitee_full_name}}"
                : ctxInvitee
                  ? "{{invitee_full_name}} and {{my_name}}"
                  : "{{event_name}}",
            ctx,
          )
        : t("meeting.titleWith", { eventName: event.name, hostName: organizer?.name ?? "" }))
  ).trim() || event.name;

  const loc = locationText(event.location, locale);
  const conference = isConferenceKind(event.location?.kind);
  const stableJoin = conference ? joinUrl(event.id) : null;
  const canceled = p.method === "CANCEL" || event.status === "canceled";
  let description = p.description;
  if (description === undefined) {
    const parts: string[] = [];
    // Calendar invitation mode: the host's custom invitation description replaces the generated details (NT-08), so
    // the downloaded file matches the provider invitation the invitee already holds (CAL-12).
    const customTemplate =
      snapshot?.notificationMode === "calendar_invitation" ? snapshot.templates?.invitationDescription?.trim() : undefined;
    const custom = customTemplate ? templateToPlainText(customTemplate, ctx) : "";
    if (custom) {
      parts.push(custom);
    } else {
      parts.push(`${t("meeting.eventName")}: ${event.name}`);
      if (loc) parts.push(`${t("meeting.location")}: ${loc}`);
      if (stableJoin) parts.push(`${t("meeting.joinLink")}: ${stableJoin}`);
      if (snapshot?.includeAnswersInNotifications !== false && ctx.questions_and_answers) {
        parts.push(`${t("meeting.questions")}:\n${ctx.questions_and_answers}`);
      }
    }
    const links = p.manageLinks ?? snapshot?.includeCancelRescheduleLinks !== false;
    if (ctxInvitee && links && !canceled) {
      const urls = inviteeUrls(ctxInvitee.id);
      parts.push(`${t("meeting.needChanges")}\n${t("meeting.cancel")}: ${urls.cancel}\n${t("meeting.reschedule")}: ${urls.reschedule}`);
    }
    if (organizer?.showBranding !== false) parts.push(t("meeting.poweredBy", { appName: appName() }));
    description = parts.join("\n\n");
  }

  const sequence = Math.max(0, p.sequence ?? event.icsSequence ?? 0);
  const allDayDate = await meetingAllDayDate(event, db);
  const content = buildIcs({
    method: p.method,
    uid,
    sequence,
    start: event.startAt,
    end: event.endAt,
    allDayDate: allDayDate ?? undefined,
    summary,
    description,
    location: (conference ? (event.location?.joinUrl ?? stableJoin) : loc) || null,
    url: invitee ? inviteeUrls(invitee.id).confirmation : null,
    organizer: { name: organizer?.name ?? appName(), email: organizer?.email ?? `notifications@${appHost().replace(/:\d+$/, "")}` },
    attendees: [
      ...attendeeRows.map((i) => ({ name: i.name, email: i.email })),
      ...guests.map((g) => ({ email: g.email })),
      ...cohosts.map((c) => ({ name: c.name, email: c.email })),
    ],
    status: canceled ? "CANCELLED" : "CONFIRMED",
  });
  return { content, uid, sequence, method: p.method, filename: "invite.ics", allDayDate };
}
