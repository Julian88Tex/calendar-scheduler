// OWNER: conferencing.
//
// Calendar native conferences (SPEC VID-07, VID-12, VID-14; ARCHITECTURE section 11). Google Meet is created by the
// organizer's Google Calendar event (calendar-integrations writes conferenceData.createRequest with a stable request
// id), so this adapter never calls a provider itself:
//
//   1. requestNativeConference: at provisioning, checks that the organizer's destination calendar (honoring the event
//      type override) can host the conference and answers status "processing" (queued) with the conference request
//      in data, or "failed" with the reason (VID-07: "Web conferencing details to follow." for the invitee).
//   2. The provisioning job (lifecycle-core) writes the calendar event with
//      `conference: calendarConferenceFor(location.kind)` through calendars.upsertLinkedEvent and folds the result in
//      with applyLinkedEventConference: "pushed" with the join URL, "initiated" while Google still creates the Meet
//      (statusCode pending), "processing" again after a transient calendar error (the job retries), "failed" else.
//   3. refreshMeetingConference re-reads a pending Meet link (calendars.refreshLinkedConference) and stores it on the
//      meeting, only while the stored location is still pending (a concurrent reschedule or cancel wins).
//
// Teams stays in the data model (docs/SCOPE.md skips Microsoft): its request answers "not_configured".
import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarLinkedEvents, scheduledEvents } from "@/db/schema";
import type { LocationKind, ResolvedLocation } from "@/db/types";
import { getDestinationCalendar, refreshLinkedConference, type UpsertLinkedEventResult } from "@/lib/calendars";
import { isUuid } from "@/lib/ids";
import { log } from "@/lib/logger";
import { now } from "@/lib/time/now";
import { calendarConferenceFor, isConferenceKind, isSafeJoinUrl, type ConferenceErrorCode, type ConferenceKind } from "./kinds";

/** The calendar conference result shape of calendars.upsertLinkedEvent / refreshLinkedConference. */
export type CalendarConferenceResult = NonNullable<UpsertLinkedEventResult["conference"]>;

/** A blank location of a conferencing kind that keeps the choice and notes of `base` (the booked location). */
export function conferenceLocationBase(kind: LocationKind, base?: ResolvedLocation | null): ResolvedLocation {
  return {
    configId: base?.configId ?? null,
    kind,
    location: null,
    additionalInfo: base?.additionalInfo ?? null,
    joinUrl: null,
    status: null,
    providerMeetingId: null,
    password: null,
    dialIn: null,
    data: null,
    error: null,
  };
}

export function failedConference(kind: LocationKind, error: ConferenceErrorCode, base?: ResolvedLocation | null, data?: Record<string, unknown> | null): ResolvedLocation {
  return { ...conferenceLocationBase(kind, base), status: "failed", error, data: data ?? null };
}

/**
 * Step 1 (see the file header): whether the organizer's destination calendar can create this conference. Google Meet
 * needs a writable Google calendar that allows Meet (Workspace admins can turn Meet off per domain).
 */
export async function requestNativeConference(p: {
  kind: ConferenceKind;
  organizerUserId: string;
  eventTypeId?: string | null;
  base?: ResolvedLocation | null;
}): Promise<ResolvedLocation> {
  const conference = calendarConferenceFor(p.kind);
  if (conference !== "google_meet") return failedConference(p.kind, "not_configured", p.base);
  const dest = await getDestinationCalendar(p.organizerUserId, p.eventTypeId ?? undefined);
  if (!dest || dest.provider !== "google" || !dest.supports.googleMeet) {
    return failedConference(p.kind, "meet_requires_google_calendar", p.base, { provider: conference });
  }
  return {
    ...conferenceLocationBase(p.kind, p.base),
    status: "processing",
    data: { provider: conference, calendarId: dest.calendarId, requestedAt: now().toISOString() },
  };
}

function entryPointsOf(data: Record<string, unknown> | undefined): unknown[] {
  const list = data?.entryPoints;
  return Array.isArray(list) ? list : [];
}

/** Folds a calendar conference (pushed, processing or failed) into the meeting location. */
export function applyCalendarConference(location: ResolvedLocation, conference: CalendarConferenceResult | null | undefined, extra: Record<string, unknown> = {}): ResolvedLocation {
  const kind = location.kind;
  const provider = calendarConferenceFor(kind);
  if (!kind || !provider) return location;
  const prior = location.data ?? {};
  const confData = conference?.data ?? {};
  const conferenceId = typeof confData.conferenceId === "string" && confData.conferenceId ? confData.conferenceId : null;
  const data: Record<string, unknown> = {
    ...prior,
    ...extra,
    provider,
    ...(conferenceId ? { conferenceId } : {}),
    ...(typeof confData.statusCode === "string" || confData.statusCode === null ? { statusCode: confData.statusCode } : {}),
    ...(entryPointsOf(confData).length ? { entryPoints: entryPointsOf(confData) } : {}),
  };
  if (conference?.status === "pushed" && isSafeJoinUrl(conference.joinUrl)) {
    return {
      ...location,
      location: conference.joinUrl,
      joinUrl: conference.joinUrl,
      status: "pushed",
      providerMeetingId: conferenceId ?? location.providerMeetingId,
      data,
      error: null,
    };
  }
  if (conference?.status === "processing") {
    return { ...location, joinUrl: null, status: "initiated", data, error: null };
  }
  return { ...location, joinUrl: null, location: null, status: "failed", data, error: "conference_not_created" };
}

/**
 * Step 2 (see the file header): the meeting location after calendars.upsertLinkedEvent wrote the organizer's event.
 * Locations of other kinds are returned unchanged. A Meet link that already exists is kept when an update answers
 * without conference data (an update never replaces the link, VID-14).
 */
export function applyLinkedEventConference(location: ResolvedLocation, result: UpsertLinkedEventResult): ResolvedLocation {
  const kind = location.kind;
  if (!kind || !isConferenceKind(kind) || !calendarConferenceFor(kind)) return location;
  const linked = result.linkedEventId ? { linkedEventId: result.linkedEventId } : {};
  const withLinked = (): ResolvedLocation => ({ ...location, data: { ...(location.data ?? {}), ...linked } });
  // A link that already reached the invitee stays until the provider hands a new one: a later write that cannot
  // reach the calendar (disconnected, read only, transient error) or answers without a usable conference keeps it.
  const hasLink = location.status === "pushed" && isSafeJoinUrl(location.joinUrl);
  switch (result.status) {
    case "skipped_no_calendar":
      if (hasLink) return withLinked();
      return { ...withLinked(), joinUrl: null, location: null, status: "failed", error: "meet_requires_google_calendar" };
    case "pending":
      // A transient calendar error: still queued, the provisioning job retries with backoff.
      return { ...withLinked(), status: hasLink ? "pushed" : "processing" };
    case "failed":
      if (hasLink) return location;
      return { ...withLinked(), joinUrl: null, location: null, status: "failed", error: "calendar_write_failed" };
    case "synced": {
      const fresh = result.conference?.status === "pushed" && isSafeJoinUrl(result.conference.joinUrl);
      if (hasLink && !fresh) return withLinked();
      return applyCalendarConference(location, result.conference, linked);
    }
    default:
      return location;
  }
}

/** The meeting's own calendar event row (organizer, purpose meeting), newest live one first. */
async function meetingLinkedEventId(scheduledEventId: string, organizerUserId: string, hint: unknown): Promise<string | null> {
  const db = await getDb();
  const rows = await db
    .select({ id: calendarLinkedEvents.id, externalId: calendarLinkedEvents.externalId })
    .from(calendarLinkedEvents)
    .where(
      and(
        eq(calendarLinkedEvents.scheduledEventId, scheduledEventId),
        eq(calendarLinkedEvents.userId, organizerUserId),
        eq(calendarLinkedEvents.purpose, "meeting"),
        ne(calendarLinkedEvents.status, "deleted"),
      ),
    );
  const withEvent = rows.filter((r) => r.externalId);
  const hinted = typeof hint === "string" ? withEvent.find((r) => r.id === hint) : undefined;
  return (hinted ?? withEvent[0])?.id ?? null;
}

/**
 * Step 3 (see the file header): re-reads a pending Meet link of a meeting and stores it. Returns the stored location,
 * or null when there is nothing to refresh (not pending, not Meet, no calendar event yet, or the provider still has no
 * answer). Never throws for provider errors (the caller retries later).
 */
export async function refreshMeetingConference(scheduledEventId: string): Promise<ResolvedLocation | null> {
  if (!isUuid(scheduledEventId)) return null;
  const db = await getDb();
  const [meeting] = await db
    .select({ status: scheduledEvents.status, location: scheduledEvents.location, organizerUserId: scheduledEvents.organizerUserId })
    .from(scheduledEvents)
    .where(eq(scheduledEvents.id, scheduledEventId))
    .limit(1);
  const loc = meeting?.location;
  if (!meeting || meeting.status !== "active" || !loc || calendarConferenceFor(loc.kind) !== "google_meet") return null;
  if (loc.status !== "processing" && loc.status !== "initiated") return null;
  const linkedEventId = await meetingLinkedEventId(scheduledEventId, meeting.organizerUserId, loc.data?.linkedEventId);
  if (!linkedEventId) return null;
  let conference: CalendarConferenceResult | null;
  try {
    conference = (await refreshLinkedConference(linkedEventId)) ?? null;
  } catch (e) {
    log.warn("conferencing.refresh_failed", { scheduledEventId, error: e });
    return null;
  }
  if (!conference || conference.status === "processing") return null;
  return db.transaction(async (tx) => {
    // Lock the row and re-check: a reschedule, reassignment or cancel that changed the meeting meanwhile wins. The
    // result is folded into the locked row (not the snapshot read before the provider call), so fields written
    // meanwhile survive.
    const [current] = await tx
      .select({ status: scheduledEvents.status, location: scheduledEvents.location, organizerUserId: scheduledEvents.organizerUserId })
      .from(scheduledEvents)
      .where(eq(scheduledEvents.id, scheduledEventId))
      .for("update")
      .limit(1);
    const cur = current?.location;
    if (!current || current.status !== "active" || current.organizerUserId !== meeting.organizerUserId) return null;
    if (!cur || cur.kind !== loc.kind || cur.configId !== loc.configId) return null;
    if (cur.status !== "processing" && cur.status !== "initiated") return null;
    const next = applyCalendarConference(cur, conference, { linkedEventId });
    await tx.update(scheduledEvents).set({ location: next, updatedAt: now() }).where(eq(scheduledEvents.id, scheduledEventId));
    return next;
  });
}
