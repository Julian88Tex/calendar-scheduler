// OWNER: conferencing. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Conferencing public API (ARCHITECTURE section 11). Conference links are generated at provisioning time (lifecycle-core
// jobs), never at event type creation (VID-12).
// Foundation stub: Jitsi works (`{JITSI_BASE_URL}/{app-name-slug}-{20 random chars}`, VID-10); every other kind
// answers status "failed" with error "not_configured".
import "server-only";
import type { LocationKind, ResolvedLocation } from "@/db/types";
import { jitsiBaseUrl } from "@/lib/env";
import { jitsiRoom } from "@/lib/ids";

export type ConferenceKind =
  | "google_conference"
  | "microsoft_teams_conference"
  | "zoom_conference"
  | "jitsi_conference"
  | "webex_conference"
  | "gotomeeting_conference";

export const CONFERENCE_KINDS: readonly ConferenceKind[] = [
  "google_conference",
  "microsoft_teams_conference",
  "zoom_conference",
  "jitsi_conference",
  "webex_conference",
  "gotomeeting_conference",
];

export function isConferenceKind(kind: unknown): kind is ConferenceKind {
  return typeof kind === "string" && (CONFERENCE_KINDS as readonly string[]).includes(kind);
}

export type ConferencingOption = { available: boolean; reason?: string; connectUrl?: string };

/**
 * standalone: zoom, jitsi (webex, gotomeeting later) create their own meeting; calendar_native: Google Meet and
 * Microsoft Teams come from the organizer's calendar event; none: every other location.
 */
export function conferenceMode(kind: LocationKind): "standalone" | "calendar_native" | "none" {
  switch (kind) {
    case "zoom_conference":
    case "jitsi_conference":
    case "webex_conference":
    case "gotomeeting_conference":
      return "standalone";
    case "google_conference":
    case "microsoft_teams_conference":
      return "calendar_native";
    default:
      return "none";
  }
}

/** Which conferencing locations this user can offer (stub: Jitsi only). */
export async function getConferencingOptions(userId: string): Promise<Record<ConferenceKind, ConferencingOption>> {
  void userId;
  const notConfigured: ConferencingOption = { available: false, reason: "Not configured on this server" };
  return {
    google_conference: notConfigured,
    microsoft_teams_conference: notConfigured,
    zoom_conference: notConfigured,
    jitsi_conference: { available: true },
    webex_conference: { available: false, reason: "Coming soon" },
    gotomeeting_conference: { available: false, reason: "Coming soon" },
  };
}

function emptyLocation(kind: ConferenceKind): ResolvedLocation {
  return {
    configId: null,
    kind,
    location: null,
    additionalInfo: null,
    joinUrl: null,
    status: null,
    providerMeetingId: null,
    password: null,
    dialIn: null,
    data: null,
    error: null,
  };
}

/** Creates the conference for a booked meeting (provisioning job). */
export async function createConference(p: {
  kind: ConferenceKind;
  organizerUserId: string;
  scheduledEventId: string;
  title: string;
  agenda?: string | null;
  start: Date;
  end: Date;
  timeZone: string;
  inviteeEmails: string[];
}): Promise<ResolvedLocation> {
  if (p.kind === "jitsi_conference") {
    const room = jitsiRoom();
    const joinUrl = `${jitsiBaseUrl().replace(/\/+$/, "")}/${room}`;
    return { ...emptyLocation(p.kind), joinUrl, location: joinUrl, status: "pushed", providerMeetingId: room };
  }
  return { ...emptyLocation(p.kind), status: "failed", error: "not_configured" };
}

/** Updates times and title (Zoom PATCH; Jitsi unchanged; calendar-native moves with the calendar event). */
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

/** Deletes a standalone conference (Zoom); nothing to do for Jitsi and calendar-native kinds. */
export async function deleteConference(p: { location: ResolvedLocation; organizerUserId: string }): Promise<void> {
  void p;
}

/**
 * VID-13 organizer rules: collective uses the event type's meeting organizer when attending, else the event owner or
 * first host; round robin the assigned host; multi-pool the first required co-host, else the host of the first pool.
 * Stub: the preferred organizer when attending, else the first required host, else the first host, else the
 * meeting's organizer.
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
