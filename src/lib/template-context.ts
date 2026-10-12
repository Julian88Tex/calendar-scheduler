// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Template context for meeting messages (SPEC NT-07, GEN-06, GEN-10; ARCHITECTURE section 13.2): every NT-07 variable
// of one scheduled event (and optionally one invitee), rendered for the recipient:
//
// | recipient | zone                                             | time format                         | locale            |
// | invitee   | invitee.timezone (the zone the invitee booked in) | invitee.time_format, else locale    | invitee.locale, else the meeting locale |
// | host      | the host's profile zone (hostUserId, else the organizer) | that host's time_format        | English (the dashboard language) |
// | other     | the meeting's display zone (locked zone, else the organizer's) | the locale default    | the meeting locale |
//
// Explicit locale, timeZone and timeFormat inputs override these. Used by lifecycle-core (emails, calendar
// descriptions), workflows and polls-core, so none of them depends on another for variables. Reads schema tables only.
import "server-only";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { eventTypes, inviteeGuests, invitees, scheduledEvents, teams, users } from "@/db/schema";
import type { LocationKind, ResolvedLocation } from "@/db/types";
import { richTextToPlain } from "./html";
import { getT, intlLocale, resolveLocale, zoneLabel } from "./i18n";
import type { TemplateContext } from "./template";
import { formatDateLong, formatTime, hour12For } from "./time/format";
import { zoneOrUtc } from "./time/zones";
import { inviteeUrls, joinUrl, publicBookingUrl } from "./url";

export type TemplateRecipient = "invitee" | "host" | "other";

export type BuildMeetingTemplateContextInput = {
  scheduledEventId: string;
  inviteeId?: string | null;
  recipient: TemplateRecipient;
  /** Overrides the recipient's locale (default: see the file header). */
  locale?: string | null;
  /** Overrides the recipient's zone. */
  timeZone?: string | null;
  /** Overrides the recipient's time format ("12h" | "24h"). */
  timeFormat?: "12h" | "24h" | null;
  /** Host recipients: whose profile zone and time format to use (collective hosts each get their own). Default: the organizer. */
  hostUserId?: string | null;
  db?: DbOrTx;
};

const CONFERENCE_KINDS = new Set<LocationKind>([
  "google_conference",
  "microsoft_teams_conference",
  "zoom_conference",
  "jitsi_conference",
  "webex_conference",
  "gotomeeting_conference",
]);

/** True for web conferencing location kinds (a join link exists or will). */
export function isConferenceKind(kind: LocationKind | null | undefined): boolean {
  return Boolean(kind && CONFERENCE_KINDS.has(kind));
}

/** The {{location}} text: address, phone or custom text; the provider join URL for conferences (or "to follow"). */
export function locationText(location: ResolvedLocation | null | undefined, locale: string): string {
  if (!location || !location.kind) return location?.location ?? "";
  if (isConferenceKind(location.kind)) {
    if (location.joinUrl) return location.joinUrl;
    return location.location || getT(locale, "common")("location.conferencingToFollow");
  }
  return location.location ?? "";
}

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

/**
 * Builds the NT-07 variables for one meeting ({} when the meeting is missing). Invitee variables (names, answers,
 * guests, UTM values, manage links) are present only when an invitee is given; absent variables render as empty text.
 */
export async function buildMeetingTemplateContext(input: BuildMeetingTemplateContextInput): Promise<TemplateContext> {
  const db = input.db ?? (await getDb());
  const [row] = await db
    .select({
      event: scheduledEvents,
      organizer: { id: users.id, name: users.name, email: users.email, timezone: users.timezone, timeFormat: users.timeFormat },
      eventType: {
        slug: eventTypes.slug,
        scope: eventTypes.scope,
        type: eventTypes.type,
        shareCode: eventTypes.shareCode,
        descriptionPlain: eventTypes.descriptionPlain,
        descriptionHtml: eventTypes.descriptionHtml,
        ownerUserId: eventTypes.ownerUserId,
        teamId: eventTypes.teamId,
      },
    })
    .from(scheduledEvents)
    .leftJoin(users, eq(users.id, scheduledEvents.organizerUserId))
    .leftJoin(eventTypes, eq(eventTypes.id, scheduledEvents.eventTypeId))
    .where(eq(scheduledEvents.id, input.scheduledEventId))
    .limit(1);
  if (!row) return {};
  const { event, organizer, eventType } = row;

  const invitee = input.inviteeId
    ? ((await db
        .select()
        .from(invitees)
        .where(and(eq(invitees.id, input.inviteeId), eq(invitees.scheduledEventId, event.id)))
        .limit(1))[0] ?? null)
    : null;
  const [active] = await db
    .select({ n: count() })
    .from(invitees)
    .where(and(eq(invitees.scheduledEventId, event.id), eq(invitees.status, "active")));
  const guests = invitee
    ? await db
        .select({ email: inviteeGuests.email })
        .from(inviteeGuests)
        .where(and(eq(inviteeGuests.inviteeId, invitee.id), isNull(inviteeGuests.canceledAt)))
        .orderBy(asc(inviteeGuests.createdAt))
    : [];
  const hostUser =
    input.recipient === "host" && input.hostUserId && input.hostUserId !== organizer?.id
      ? ((await db
          .select({ timezone: users.timezone, timeFormat: users.timeFormat })
          .from(users)
          .where(eq(users.id, input.hostUserId))
          .limit(1))[0] ?? null)
      : null;

  const snapshot = event.settingsSnapshot;
  const displayZone =
    snapshot?.timeZoneDisplay === "locked" && snapshot.lockedTimeZone ? snapshot.lockedTimeZone : (organizer?.timezone ?? "UTC");
  const recipientZone =
    input.recipient === "invitee"
      ? (invitee?.timezone ?? displayZone)
      : input.recipient === "host"
        ? (hostUser?.timezone ?? organizer?.timezone ?? displayZone)
        : displayZone;
  const zone = zoneOrUtc(input.timeZone ?? recipientZone);
  const meetingLocale = event.locale || snapshot?.locale || "en";
  const locale = resolveLocale(
    input.locale ?? (input.recipient === "invitee" ? (invitee?.locale ?? meetingLocale) : input.recipient === "host" ? "en" : meetingLocale),
  );
  const timeFormat =
    input.timeFormat ??
    (input.recipient === "invitee"
      ? invitee?.timeFormat
      : input.recipient === "host"
        ? (hostUser?.timeFormat ?? organizer?.timeFormat)
        : null);
  const hour12 = hour12For(timeFormat ?? null, locale);
  const intl = intlLocale(locale);

  let eventTypeUrl = "";
  if (eventType && eventType.type === "standard") {
    if (eventType.scope === "shared" && eventType.shareCode) {
      eventTypeUrl = publicBookingUrl({ code: eventType.shareCode, eventSlug: eventType.slug });
    } else if (eventType.teamId) {
      const [team] = await db.select({ slug: teams.slug }).from(teams).where(eq(teams.id, eventType.teamId)).limit(1);
      if (team?.slug) eventTypeUrl = publicBookingUrl({ handle: team.slug, eventSlug: eventType.slug });
    } else if (eventType.ownerUserId) {
      const [owner] = await db.select({ slug: users.slug }).from(users).where(eq(users.id, eventType.ownerUserId)).limit(1);
      if (owner?.slug) eventTypeUrl = publicBookingUrl({ handle: owner.slug, eventSlug: eventType.slug });
    }
  }

  const location = event.location;
  const hostName = organizer?.name ?? "";
  const description = eventType?.descriptionPlain?.trim() || (eventType?.descriptionHtml ? richTextToPlain(eventType.descriptionHtml) : "");
  const ctx: TemplateContext = {
    event_name: event.name,
    event_date: formatDateLong(event.startAt, zone, intl),
    event_time: formatTime(event.startAt, zone, intl, hour12),
    event_end_time: formatTime(event.endAt, zone, intl, hour12),
    event_time_zone: zoneLabel(zone, locale),
    event_description: description,
    location: locationText(location, locale),
    join_url: isConferenceKind(location?.kind) ? joinUrl(event.id) : "",
    my_name: hostName,
    host_name: hostName,
    host_email: organizer?.email ?? "",
    invitees_count: Number(active?.n ?? 0),
    event_type_url: eventTypeUrl,
  };

  if (invitee) {
    const split = splitName(invitee.name);
    const answers = [...(invitee.questionsAndAnswers ?? [])].sort((a, b) => a.position - b.position);
    const urls = inviteeUrls(invitee.id);
    Object.assign(ctx, {
      invitee_full_name: invitee.name,
      invitee_first_name: invitee.firstName?.trim() || split.first,
      invitee_last_name: invitee.lastName?.trim() || (invitee.firstName ? "" : split.last),
      invitee_email: invitee.email,
      invitee_phone_number: invitee.textReminderNumber ?? "",
      invitee_uuid: invitee.id,
      questions_and_answers: answers
        .filter((a) => a.answer?.trim())
        .map((a) => `${a.question}\n${a.answer}`)
        .join("\n\n"),
      guests: guests.map((g) => g.email).join(", "),
      utm_source: invitee.utmSource ?? "",
      utm_medium: invitee.utmMedium ?? "",
      utm_campaign: invitee.utmCampaign ?? "",
      utm_content: invitee.utmContent ?? "",
      utm_term: invitee.utmTerm ?? "",
      cancel_url: urls.cancel,
      reschedule_url: urls.reschedule,
      reconfirm_url: urls.reconfirm,
    });
    for (let i = 0; i < 10; i++) ctx[`answer_${i + 1}`] = answers[i]?.answer ?? "";
  }
  return ctx;
}
