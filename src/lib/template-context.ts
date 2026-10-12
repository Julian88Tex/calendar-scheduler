// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Template context for meeting messages (SPEC NT-07, GEN-06; ARCHITECTURE section 13.2): names, dates, links and
// answers of one scheduled event (and optionally one invitee), rendered in the recipient's zone and time format.
// Invitee recipients default to the invitee's stored timezone and time_format; host recipients to the organizer's
// profile; "other" recipients to the event's display zone (locked zone, else the organizer's). Used by lifecycle-core,
// workflows and polls-core so none depends on another for variables. Reads schema tables only.
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { eventTypes, inviteeGuests, invitees, scheduledEvents, teams, users } from "@/db/schema";
import type { TemplateContext } from "./template";
import { formatDateLong, formatTime, hour12For } from "./time/format";
import { friendlyZoneName, zoneOrUtc } from "./time/zones";
import { inviteeUrls, joinUrl, publicBookingUrl } from "./url";

export type TemplateRecipient = "invitee" | "host" | "other";

export type BuildMeetingTemplateContextInput = {
  scheduledEventId: string;
  inviteeId?: string | null;
  recipient: TemplateRecipient;
  /** Overrides the recipient's locale (default: invitee locale, else the meeting locale, else "en"). */
  locale?: string | null;
  /** Overrides the recipient's zone. */
  timeZone?: string | null;
  /** Overrides the recipient's time format ("12h" | "24h"). */
  timeFormat?: "12h" | "24h" | null;
  db?: DbOrTx;
};

function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] ?? "", last: "" };
  return { first: parts[0]!, last: parts.slice(1).join(" ") };
}

/** Builds the NT-07 variables for one meeting (empty strings for anything unknown). */
export async function buildMeetingTemplateContext(input: BuildMeetingTemplateContextInput): Promise<TemplateContext> {
  const db = input.db ?? (await getDb());
  const [row] = await db
    .select({
      event: scheduledEvents,
      organizer: { name: users.name, email: users.email, timezone: users.timezone, timeFormat: users.timeFormat, slug: users.slug },
      eventType: {
        slug: eventTypes.slug,
        scope: eventTypes.scope,
        type: eventTypes.type,
        shareCode: eventTypes.shareCode,
        descriptionPlain: eventTypes.descriptionPlain,
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
    ? ((await db.select().from(invitees).where(eq(invitees.id, input.inviteeId)).limit(1))[0] ?? null)
    : null;
  const activeInvitees = await db
    .select({ id: invitees.id })
    .from(invitees)
    .where(and(eq(invitees.scheduledEventId, event.id), eq(invitees.status, "active")));
  const guests = invitee
    ? await db
        .select({ email: inviteeGuests.email })
        .from(inviteeGuests)
        .where(and(eq(inviteeGuests.inviteeId, invitee.id), isNull(inviteeGuests.canceledAt)))
        .orderBy(asc(inviteeGuests.createdAt))
    : [];

  const snapshot = event.settingsSnapshot;
  const displayZone =
    snapshot?.timeZoneDisplay === "locked" && snapshot.lockedTimeZone ? snapshot.lockedTimeZone : (organizer?.timezone ?? "UTC");
  const zone = zoneOrUtc(
    input.timeZone ??
      (input.recipient === "invitee" ? (invitee?.timezone ?? displayZone) : input.recipient === "host" ? (organizer?.timezone ?? displayZone) : displayZone),
  );
  const locale = input.locale ?? (input.recipient === "invitee" ? invitee?.locale : null) ?? event.locale ?? "en";
  const timeFormat =
    input.timeFormat ?? (input.recipient === "invitee" ? invitee?.timeFormat : input.recipient === "host" ? organizer?.timeFormat : null);
  const hour12 = hour12For(timeFormat ?? "12h", locale);

  let eventTypeUrl = "";
  if (eventType && eventType.type === "standard") {
    if (eventType.scope === "shared" && eventType.shareCode) {
      eventTypeUrl = publicBookingUrl({ code: eventType.shareCode, eventSlug: eventType.slug });
    } else if (eventType.teamId) {
      const [team] = await db.select({ slug: teams.slug }).from(teams).where(eq(teams.id, eventType.teamId)).limit(1);
      if (team) eventTypeUrl = publicBookingUrl({ handle: team.slug, eventSlug: eventType.slug });
    } else if (eventType.ownerUserId) {
      const [owner] = await db.select({ slug: users.slug }).from(users).where(eq(users.id, eventType.ownerUserId)).limit(1);
      if (owner?.slug) eventTypeUrl = publicBookingUrl({ handle: owner.slug, eventSlug: eventType.slug });
    }
  }

  const location = event.location;
  const hostName = organizer?.name ?? "";
  const ctx: TemplateContext = {
    event_name: event.name,
    event_date: formatDateLong(event.startAt, zone, locale),
    event_time: formatTime(event.startAt, zone, locale, hour12),
    event_end_time: formatTime(event.endAt, zone, locale, hour12),
    event_time_zone: friendlyZoneName(zone, locale),
    event_description: eventType?.descriptionPlain ?? "",
    location: location?.location ?? location?.joinUrl ?? "",
    join_url: location?.joinUrl ? joinUrl(event.id) : "",
    my_name: hostName,
    host_name: hostName,
    host_email: organizer?.email ?? "",
    invitees_count: activeInvitees.length,
    event_type_url: eventTypeUrl,
  };

  if (invitee) {
    const split = splitName(invitee.name);
    const answers = [...(invitee.questionsAndAnswers ?? [])].sort((a, b) => a.position - b.position);
    const urls = inviteeUrls(invitee.id);
    Object.assign(ctx, {
      invitee_full_name: invitee.name,
      invitee_first_name: invitee.firstName ?? split.first,
      invitee_last_name: invitee.lastName ?? split.last,
      invitee_email: invitee.email,
      invitee_phone_number: invitee.textReminderNumber ?? "",
      invitee_uuid: invitee.id,
      questions_and_answers: answers.map((a) => `${a.question}\n${a.answer}`).join("\n\n"),
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
