// Confirmation page data (SPEC BK-20, BK-22, CAL-12, CR-01, GEN-06, TM-08). Server only.
//
// /booking/{inviteeId} is a capability URL: the invitee id alone opens it. An old (rescheduled) invitee id follows the
// chain to the current booking (CR-04). Times use the invitee's stored zone and time format; the notification copy
// follows the meeting's effective CAL-12 mode; "Open Invitation" appears when the provider returned a link to the event.
// A rescheduled booking also carries the time it replaced (the meeting of current.oldInviteeId), shown struck through
// under "Former Time" (CR-03).
import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { eventTypes, handles, inviteeGuests, invitees, scheduledEventHosts, scheduledEvents, teams, users } from "@/db/schema";
import type { ConfirmationLink, MeetingSettingsSnapshot } from "@/db/types";
import { getOperatorEmail } from "@/components/public/operator";
import { isReschedulableSource } from "@/lib/booking";
import { APP_NAME } from "@/lib/brand";
import { addToCalendarLinks, type AddToCalendarLink } from "@/lib/email";
import { isUuid } from "@/lib/ids";
import { resolveActiveInviteeChain } from "@/lib/lifecycle";
import { formatMeetingWhen, hour12For } from "@/lib/time/format";
import { now } from "@/lib/time/now";
import { friendlyZoneName, isValidTimeZone } from "@/lib/time/zones";
import { absoluteUrl } from "@/lib/url";
import { meetingLocation, type MeetingLocationView } from "../lib/locations";
import { bt } from "../lib/t";
import { avatarOf, getLegalLinks, safeLink } from "./host";

export type ConfirmationView = {
  inviteeId: string;
  status: "active" | "canceled";
  rescheduled: boolean;
  past: boolean;
  eventName: string;
  /** Slug of the meeting's event type (friendly names in friends mode), null when it is gone. */
  eventTypeSlug: string | null;
  /** Owner of a personal event type (friends mode content), else null. */
  eventTypeOwnerUserId: string | null;
  /** "/{handle}" of that owner (friends mode "Plan another hang"), else null. */
  ownerLandingPath: string | null;
  hostNames: string[];
  hostAvatar: { src: string | null; name: string } | null;
  /** "You are scheduled with {name}." (one-on-one meetings only). */
  scheduledWith: string | null;
  start: string;
  end: string;
  zone: string;
  zoneName: string;
  hour12: boolean;
  whenText: string;
  /** Rescheduled bookings: the replaced meeting's time ("Former Time", struck through, CR-03), else null. */
  formerWhenText: string | null;
  location: MeetingLocationView | null;
  mode: MeetingSettingsSnapshot["notificationMode"];
  invitationUrl: string | null;
  icsUrl: string;
  calendarLinks: AddToCalendarLink[];
  scheduleAnother: { label: string; href: string } | null;
  customLinks: ConfirmationLink[];
  manage: { cancel: string | null; reschedule: string | null } | null;
  canceled: { by: string | null; reason: string | null } | null;
  guests: string[];
  branding: { primaryColor: string | null; backgroundColor: string | null; textColor: string | null };
  ribbon: boolean;
  privacyUrl: string | null;
  operatorEmail: string | null;
  appName: string;
};

export type ConfirmationResult = { state: "ok"; view: ConfirmationView } | { state: "redirect"; inviteeId: string } | null;

const hex = (v: unknown): string | null => (typeof v === "string" && /^#?[0-9a-fA-F]{6}$/.test(v) ? `#${v.replace(/^#/, "").toLowerCase()}` : null);

/** The public booking page path of the meeting's event type, when it still has one (BK-20 "Schedule another event"). */
async function bookingPagePath(eventTypeId: string): Promise<string | null> {
  const db = await getDb();
  const [et] = await db
    .select({ slug: eventTypes.slug, ownerUserId: eventTypes.ownerUserId, teamId: eventTypes.teamId, scope: eventTypes.scope, type: eventTypes.type, active: eventTypes.active })
    .from(eventTypes)
    .where(and(eq(eventTypes.id, eventTypeId), isNull(eventTypes.deletedAt)))
    .limit(1);
  if (!et || et.type !== "standard" || et.scope === "shared" || !et.active) return null;
  const ownerCondition = et.teamId ? eq(handles.teamId, et.teamId) : et.ownerUserId ? eq(handles.userId, et.ownerUserId) : null;
  if (!ownerCondition) return null;
  const [h] = await db.select({ slug: handles.slug }).from(handles).where(ownerCondition).limit(1);
  return h ? `/${encodeURIComponent(h.slug)}/${encodeURIComponent(et.slug)}` : null;
}

/** "/{handle}" of the user who owns a personal event type, else null. */
async function ownerLandingPath(ownerUserId: string | null | undefined, teamId: string | null | undefined): Promise<string | null> {
  if (!ownerUserId || teamId) return null;
  const db = await getDb();
  const [h] = await db.select({ slug: handles.slug }).from(handles).where(eq(handles.userId, ownerUserId)).limit(1);
  return h ? `/${encodeURIComponent(h.slug)}` : null;
}

/** Start and end of the meeting an invitee of a reschedule chain belonged to (the time the reschedule replaced). */
async function formerTimes(oldInviteeId: string | null): Promise<{ startAt: Date; endAt: Date } | null> {
  if (!oldInviteeId) return null;
  const db = await getDb();
  const [row] = await db
    .select({ startAt: scheduledEvents.startAt, endAt: scheduledEvents.endAt })
    .from(invitees)
    .innerJoin(scheduledEvents, eq(scheduledEvents.id, invitees.scheduledEventId))
    .where(eq(invitees.id, oldInviteeId))
    .limit(1);
  return row ?? null;
}

export async function loadConfirmation(inviteeIdRaw: string): Promise<ConfirmationResult> {
  if (!isUuid(inviteeIdRaw)) return null;
  const db = await getDb();
  const current = await resolveActiveInviteeChain(inviteeIdRaw, db);
  if (!current) return null;
  if (current.id !== inviteeIdRaw) return { state: "redirect", inviteeId: current.id };
  const [event] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, current.scheduledEventId)).limit(1);
  if (!event) return null;

  const hostRows = await db
    .select({ id: users.id, name: users.name, email: users.email, avatarFileId: users.avatarFileId, avatarUrl: users.avatarUrl, role: scheduledEventHosts.role })
    .from(scheduledEventHosts)
    .innerJoin(users, eq(users.id, scheduledEventHosts.userId))
    .where(eq(scheduledEventHosts.scheduledEventId, event.id))
    .orderBy(asc(scheduledEventHosts.createdAt));
  const organizerFirst = [...hostRows].sort((a, b) => (a.id === event.organizerUserId ? -1 : b.id === event.organizerUserId ? 1 : 0));
  const hostNames = organizerFirst.map((h) => h.name?.trim() || h.email || "").filter(Boolean);
  const organizer = organizerFirst[0] ?? null;

  const [orgUser] = await db.select().from(users).where(eq(users.id, event.organizerUserId)).limit(1);
  const [et] = await db
    .select({ teamId: eventTypes.teamId, scope: eventTypes.scope, ownerUserId: eventTypes.ownerUserId, slug: eventTypes.slug })
    .from(eventTypes)
    .where(eq(eventTypes.id, event.eventTypeId))
    .limit(1);
  const team = et?.teamId
    ? ((await db.select({ name: teams.name }).from(teams).where(eq(teams.id, et.teamId)).limit(1))[0] ?? null)
    : null;
  const brandUser = et?.scope === "team" ? null : orgUser;
  const colors = (brandUser?.brandColors ?? {}) as Record<string, unknown>;

  const guests = (
    await db
      .select({ email: inviteeGuests.email })
      .from(inviteeGuests)
      .where(and(eq(inviteeGuests.inviteeId, current.id), isNull(inviteeGuests.canceledAt)))
      .orderBy(asc(inviteeGuests.createdAt))
  ).map((g) => g.email);

  const snap = event.settingsSnapshot;
  const zone = isValidTimeZone(current.timezone) ? current.timezone : (orgUser?.timezone && isValidTimeZone(orgUser.timezone) ? orgUser.timezone : "UTC");
  const hour12 = hour12For(current.timeFormat, "en-US");
  const at = now().getTime();
  const past = event.endAt.getTime() <= at;
  const active = current.status === "active" && event.status === "active";
  const id = encodeURIComponent(current.id);
  const icsUrl = `/booking/${id}/event.ics`;
  const hostLabel = hostNames.length === 1 ? hostNames[0]! : hostNames.length > 1 ? hostNames.join(", ") : (team?.name ?? "");
  const location = meetingLocation(event.location, { hostName: organizer?.name ?? hostLabel });
  const title = `${event.name} with ${hostLabel}`.trim();
  const confirmationAbs = absoluteUrl(`/booking/${id}`);
  const legal = await getLegalLinks();
  const pagePath = snap.scheduleAnotherEnabled && event.source !== "poll" && event.source !== "one_off" ? await bookingPagePath(event.eventTypeId) : null;
  const metadata = (brandUser?.metadata ?? {}) as Record<string, unknown>;
  const former = await formerTimes(current.oldInviteeId);
  const formerChanged = former && (former.startAt.getTime() !== event.startAt.getTime() || former.endAt.getTime() !== event.endAt.getTime());

  const view: ConfirmationView = {
    inviteeId: current.id,
    status: active ? "active" : "canceled",
    rescheduled: Boolean(current.oldInviteeId),
    past,
    eventName: event.name,
    eventTypeSlug: et?.slug ?? null,
    eventTypeOwnerUserId: et && !et.teamId ? (et.ownerUserId ?? null) : null,
    ownerLandingPath: await ownerLandingPath(et?.ownerUserId, et?.teamId),
    hostNames,
    hostAvatar: organizer && !event.isGroup ? { src: avatarOf(organizer), name: organizer.name?.trim() || organizer.email || "" } : null,
    scheduledWith: !event.isGroup && hostLabel ? hostLabel : null,
    start: event.startAt.toISOString(),
    end: event.endAt.toISOString(),
    zone,
    zoneName: friendlyZoneName(zone),
    hour12,
    whenText: formatMeetingWhen(event.startAt, event.endAt, zone, "en-US", hour12),
    formerWhenText: former && formerChanged ? formatMeetingWhen(former.startAt, former.endAt, zone, "en-US", hour12) : null,
    location,
    mode: snap.notificationMode,
    invitationUrl: snap.notificationMode === "calendar_invitation" ? safeLink(event.invitationUrl) : null,
    icsUrl,
    calendarLinks: addToCalendarLinks({
      title,
      start: event.startAt,
      end: event.endAt,
      location: location ? [location.text, location.detail].filter(Boolean).join("\n") : null,
      details: `${bt("confirmation.needChanges")} ${confirmationAbs}`,
      icsUrl,
      locale: "en",
    }),
    scheduleAnother: pagePath ? { label: snap.scheduleAnotherLabel?.trim() || bt("confirmation.scheduleAnother"), href: pagePath } : null,
    customLinks: (snap.confirmationLinks ?? [])
      .map((l) => ({ label: (l.label ?? "").trim(), url: safeLink(l.url) ?? "" }))
      .filter((l) => l.label && /^https?:\/\//.test(l.url))
      .slice(0, 5),
    manage:
      active && !past
        ? { cancel: `/cancellations/${id}`, reschedule: isReschedulableSource(event.source) ? `/reschedulings/${id}` : null }
        : null,
    canceled: active
      ? null
      : { by: current.canceledByName ?? event.canceledByName ?? null, reason: (current.cancelReason ?? event.cancelReason)?.trim() || null },
    guests,
    branding: { primaryColor: hex(colors.primary), backgroundColor: hex(colors.background), textColor: hex(colors.text) },
    ribbon: brandUser ? brandUser.showBranding !== false : true,
    privacyUrl: safeLink(metadata.privacyPolicyUrl) ?? legal.privacyUrl,
    operatorEmail: await getOperatorEmail(),
    appName: APP_NAME,
  };
  return { state: "ok", view };
}

/**
 * Invitee row for the ICS route (status and meeting). An old invitee id of a rescheduled booking follows the chain to
 * the current booking (CR-04), like the confirmation page: a reschedule keeps the calendar UID (SEQUENCE + 1), so a
 * CANCEL file for the old id would remove the rescheduled meeting from the invitee's calendar.
 */
export async function loadInviteeForIcs(inviteeId: string): Promise<{ id: string; scheduledEventId: string; status: "active" | "canceled"; eventStatus: "active" | "canceled" } | null> {
  if (!isUuid(inviteeId)) return null;
  const db = await getDb();
  const current = await resolveActiveInviteeChain(inviteeId, db);
  if (!current) return null;
  const [row] = await db
    .select({ id: invitees.id, scheduledEventId: invitees.scheduledEventId, status: invitees.status, eventStatus: scheduledEvents.status })
    .from(invitees)
    .innerJoin(scheduledEvents, eq(scheduledEvents.id, invitees.scheduledEventId))
    .where(eq(invitees.id, current.id))
    .limit(1);
  return row ?? null;
}
