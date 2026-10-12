// OWNER: conferencing.
//
// Conference lifecycle (SPEC VID-07, VID-10, VID-12, VID-13, VID-14; ARCHITECTURE section 11). Links are generated at
// provisioning time (lifecycle-core jobs), never at event type creation (VID-12).
//
//   createConference   idempotent: a location that already holds a created conference of the kind is returned as is;
//                      google_conference: "processing" when the organizer's destination calendar can host Meet (the
//                      provisioning job then writes the calendar event with calendarConferenceFor(kind) and folds the
//                      result in with applyLinkedEventConference), else "failed" (VID-07 fallback);
//                      jitsi_conference: a unique unguessable room right away ("pushed", VID-10);
//                      every other kind: "failed" / "not_configured" (docs/SCOPE.md skips Zoom, Teams, Webex, GoTo).
//   updateConference   reschedules keep the conference: Meet moves with its calendar event, Jitsi rooms never change.
//   deleteConference   nothing to delete: deleting the calendar event removes the Meet (calendar-integrations).
//   resolveConferenceOrganizer  VID-13 organizer rules for multi-host meetings.
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { scheduledEvents } from "@/db/schema";
import type { ResolvedLocation } from "@/db/types";
import { isUuid } from "@/lib/ids";
import { jitsiConference } from "./jitsi";
import { conferenceJoinUrl, conferenceMode, type ConferenceKind } from "./kinds";
import { conferenceLocationBase, failedConference, requestNativeConference } from "./native";

export type CreateConferenceInput = {
  kind: ConferenceKind;
  organizerUserId: string;
  scheduledEventId: string;
  title: string;
  agenda?: string | null;
  start: Date;
  end: Date;
  timeZone: string;
  inviteeEmails: string[];
  /** Additive: the booked location (its configId and notes are kept on the result). */
  location?: ResolvedLocation | null;
  /** Additive: the event type, for its destination calendar override (looked up from the meeting when omitted). */
  eventTypeId?: string | null;
};

async function eventTypeOfMeeting(scheduledEventId: string): Promise<string | null> {
  if (!isUuid(scheduledEventId)) return null;
  const db = await getDb();
  const [row] = await db.select({ eventTypeId: scheduledEvents.eventTypeId }).from(scheduledEvents).where(eq(scheduledEvents.id, scheduledEventId)).limit(1);
  return row?.eventTypeId ?? null;
}

/**
 * Creates the conference for a booked meeting (provisioning job). See the file header. Idempotent: when the booked
 * location already holds a created conference of this kind (a retried job, a reschedule that kept the location), it
 * is returned unchanged, so invitees keep the link they were sent. resetConference first to force a new one.
 */
export async function createConference(p: CreateConferenceInput): Promise<ResolvedLocation> {
  const base = p.location ?? null;
  if (base && base.kind === p.kind && base.status === "pushed" && conferenceJoinUrl(base)) return base;
  if (p.kind === "jitsi_conference") return { ...jitsiConference(), configId: base?.configId ?? null, additionalInfo: base?.additionalInfo ?? null };
  if (p.kind === "google_conference") {
    const eventTypeId = p.eventTypeId ?? (await eventTypeOfMeeting(p.scheduledEventId));
    return requestNativeConference({ kind: p.kind, organizerUserId: p.organizerUserId, eventTypeId, base });
  }
  return failedConference(p.kind, "not_configured", base);
}

/**
 * Updates times and title. Calendar native conferences move with the calendar event (the provisioning job patches it
 * and the Meet link stays, VID-14); Jitsi rooms never change; other kinds are not offered.
 */
export async function updateConference(p: {
  location: ResolvedLocation;
  organizerUserId: string;
  title: string;
  start: Date;
  end: Date;
  timeZone: string;
}): Promise<ResolvedLocation> {
  return p.location;
}

/** Deletes a standalone conference. Jitsi rooms need no deletion; Meet goes away with its calendar event. */
export async function deleteConference(p: { location: ResolvedLocation; organizerUserId: string }): Promise<void> {
  void p;
}

/** True when a reschedule to a different organizer needs a new conference (VID-14 round robin reassignment). */
export function conferenceNeedsRecreate(p: { location: ResolvedLocation; previousOrganizerUserId: string; organizerUserId: string }): boolean {
  const kind = p.location.kind;
  if (!kind || conferenceMode(kind) === "none") return false;
  // A new organizer needs a conference on their own account (Jitsi rooms belong to nobody); the same organizer keeps
  // the conference unless creating it failed before.
  if (p.previousOrganizerUserId !== p.organizerUserId) return kind !== "jitsi_conference";
  return p.location.status === "failed";
}

/** A queued conference of this kind for a meeting that is being re-provisioned (keeps the choice and notes). */
export function resetConference(location: ResolvedLocation): ResolvedLocation {
  if (!location.kind || conferenceMode(location.kind) === "none") return location;
  return { ...conferenceLocationBase(location.kind, location), status: "processing" };
}

/**
 * VID-13 organizer rules: collective uses the event type's meeting organizer when attending, else the event owner or
 * first host; round robin the assigned host; multi-pool the first required co-host, else the host of the first pool.
 * Hosts are given in assignment order: the preferred organizer when attending, else the first required host (no
 * pool), else the first host, else the meeting's organizer.
 */
export function resolveConferenceOrganizer(meeting: {
  organizerUserId: string;
  hosts?: { userId: string; poolId: string | null }[];
  preferredOrganizerUserId?: string | null;
}): string {
  const hosts = meeting.hosts ?? [];
  if (meeting.preferredOrganizerUserId && hosts.some((h) => h.userId === meeting.preferredOrganizerUserId)) {
    return meeting.preferredOrganizerUserId;
  }
  return hosts.find((h) => h.poolId === null)?.userId ?? hosts[0]?.userId ?? meeting.organizerUserId;
}
