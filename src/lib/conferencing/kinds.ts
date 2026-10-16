// OWNER: conferencing.
//
// Conferencing kinds and display rules (SPEC VID-07, VID-11, VID-12, VID-16; ARCHITECTURE section 11). Pure and client
// safe: event type editors, booking pages, meeting details and emails can import it (the module index is server only).
//
//   conferenceMode(kind)               standalone (Zoom, Jitsi, Webex, GoTo), calendar_native (Meet, Teams), none
//   calendarConferenceFor(kind)        the WriteEventInput.conference value a calendar native kind asks for
//   conferenceProviderName(kind)       "Google Meet"
//   isConferencePending(location)      the link is still being created (processing or initiated)
//   conferenceJoinUrl(location)        the provider join URL when it is known and safe to link to (https only)
//   conferenceLocationText(...)        "Web conferencing details provided upon confirmation." before booking,
//                                      "Web conferencing details to follow." until the link exists, then the link
//
// docs/SCOPE.md keeps Google Meet only: the other kinds stay in the data model (and in this file) so existing rows keep
// rendering, but no screen offers them.
import type { ConferenceStatus, LocationKind, ResolvedLocation } from "@/db/types";

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

export type ConferenceMode = "standalone" | "calendar_native" | "none";

/**
 * standalone: zoom, jitsi (webex, gotomeeting later) create their own meeting; calendar_native: Google Meet and
 * Microsoft Teams come from the organizer's calendar event; none: every other location.
 */
export function conferenceMode(kind: LocationKind): ConferenceMode {
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

/** The conference a calendar native kind asks the organizer's calendar event for (calendars.upsertLinkedEvent). */
export function calendarConferenceFor(kind: LocationKind | null | undefined): "google_meet" | "microsoft_teams" | null {
  if (kind === "google_conference") return "google_meet";
  if (kind === "microsoft_teams_conference") return "microsoft_teams";
  return null;
}

const PROVIDER_NAMES: Record<ConferenceKind, string> = {
  google_conference: "Google Meet",
  microsoft_teams_conference: "Microsoft Teams",
  zoom_conference: "Zoom",
  jitsi_conference: "Jitsi Meet",
  webex_conference: "Webex",
  gotomeeting_conference: "GoTo Meeting",
};

/** "Google Meet" for google_conference; null for kinds that are not web conferences. */
export function conferenceProviderName(kind: LocationKind | null | undefined): string | null {
  return isConferenceKind(kind) ? PROVIDER_NAMES[kind] : null;
}

export const CONFERENCING_COPY = {
  /** Booking pages before booking (the owner's live page shows exactly this). */
  beforeBooking: "Web conferencing details provided upon confirmation.",
  /** A booked meeting whose link does not exist yet (or could not be created, VID-07). */
  toFollow: "Web conferencing details to follow.",
  /** The stable join page while the link is being created (VID-11). */
  preparing: "Your meeting link is being prepared. This page will refresh automatically.",
  canceled: "This meeting was canceled.",
  /** VID-07: why Google Meet is unavailable when the destination calendar is not Google. */
  meetRequiresGoogle:
    "You must configure your calendar connections to push events to a Google Calendar to host Google Meet web conferences on your events.",
} as const;

/** ResolvedLocation.error codes written by this module. */
export type ConferenceErrorCode =
  | "not_configured"
  | "meet_requires_google_calendar"
  | "calendar_write_failed"
  | "conference_not_created";

/**
 * What a host reads about a conference that could not be created (meeting details, the VID-12 failure email). The
 * invitee side always shows "Web conferencing details to follow." instead.
 */
export function conferenceErrorMessage(error: string | null | undefined, kind: LocationKind | null | undefined): string {
  const provider = conferenceProviderName(kind) ?? "web conferencing";
  switch (error) {
    case "meet_requires_google_calendar":
      return CONFERENCING_COPY.meetRequiresGoogle;
    case "calendar_write_failed":
      return `We couldn't add this meeting to your calendar, so it has no ${provider} link yet. Check your calendar connection, then retry.`;
    case "conference_not_created":
      return `Your calendar didn't create a ${provider} link for this meeting.`;
    case "not_configured":
      return `${conferenceProviderName(kind) ?? "Web conferencing"} isn't available on this server.`;
    default:
      return `We couldn't create a ${provider} link for this meeting.`;
  }
}

/** True while the conference is queued or requested and its link is not known yet (VID-12 statuses). */
export function isConferencePending(location: Pick<ResolvedLocation, "status" | "joinUrl"> | null | undefined): boolean {
  if (!location) return false;
  const status: ConferenceStatus | null = location.status;
  return (status === "processing" || status === "initiated") && !conferenceJoinUrl(location);
}

/**
 * A URL we are willing to send people to: absolute https, no credentials, at most 2048 characters, and no whitespace
 * or control characters (the URL parser silently drops tabs and newlines, but the raw value goes into a Location
 * header and into emails).
 */
export function isSafeJoinUrl(url: string | null | undefined): url is string {
  if (!url || url.length > 2048) return false;
  if (/[\u0000-\u0020\u007f-\u009f\u2028\u2029]/.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password && Boolean(u.hostname);
  } catch {
    return false;
  }
}

/** The provider join URL of a booked conference, when it exists and is safe to link to. */
export function conferenceJoinUrl(location: Pick<ResolvedLocation, "joinUrl"> | null | undefined): string | null {
  const url = location?.joinUrl?.trim() ?? null;
  return isSafeJoinUrl(url) ? url : null;
}

/**
 * The location line of a conferencing kind (BK-03, BK-20, VID-11): before booking the confirmation promise, after
 * booking the join link once it exists (the stable /events/{id}/join link when given, else the provider link), else
 * "Web conferencing details to follow.". Returns null for kinds that are not web conferences.
 */
export function conferenceLocationText(
  location: Pick<ResolvedLocation, "kind" | "joinUrl" | "status"> | null | undefined,
  opts: { booked: boolean; stableJoinUrl?: string | null } = { booked: true },
): { provider: string; text: string; href: string | null } | null {
  const provider = conferenceProviderName(location?.kind);
  if (!provider || !location) return null;
  if (!opts.booked) return { provider, text: CONFERENCING_COPY.beforeBooking, href: null };
  const providerUrl = conferenceJoinUrl(location);
  if (!providerUrl) return { provider, text: CONFERENCING_COPY.toFollow, href: null };
  const href = opts.stableJoinUrl && /^https?:\/\//.test(opts.stableJoinUrl) ? opts.stableJoinUrl : providerUrl;
  return { provider, text: providerUrl, href };
}
