// OWNER: conferencing.
//
// Which conferencing locations a user can offer (SPEC VID-07, VID-16; docs/SCOPE.md keeps Google Meet only) and the
// Integrations > Google Meet read model.
//
// Google Meet is available when the user's destination calendar ("Calendar to add events to") is a writable Google
// calendar whose account allows Meet: getDestinationCalendar(...).supports.googleMeet, the same check provisioning
// makes. Otherwise getGoogleMeetStatus says why (no Google account, a connection that needs a reconnect, no calendar
// chosen for new events, Meet turned off by a Workspace administrator) and where to fix it. Every other kind answers
// unavailable: Zoom, Teams, Jitsi, Webex and GoTo are not offered by this deployment.
import "server-only";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarConnections, calendars, eventTypes, users } from "@/db/schema";
import { oauthStartPath } from "@/lib/auth/oauth/links";
import { getDestinationCalendar } from "@/lib/calendars";
import { getFeatures } from "@/lib/env";
import { isUuid } from "@/lib/ids";
import { CONFERENCING_COPY, type ConferenceKind } from "./kinds";

export const GOOGLE_MEET_PAGE_PATH = "/app/integrations/conferencing/google-meet";
export const CALENDAR_SETTINGS_PAGE_PATH = "/app/availability/calendar-settings";

/** Why an option is unavailable (additive to the section 11 shape). */
export type ConferencingUnavailableCode =
  | "not_offered"
  | "not_configured"
  | "not_connected"
  | "needs_reauth"
  | "no_destination"
  | "destination_not_google"
  | "meet_disabled";

export type ConferencingOption = { available: boolean; reason?: string; connectUrl?: string; code?: ConferencingUnavailableCode };

export type GoogleMeetState = "ready" | Exclude<ConferencingUnavailableCode, "not_offered">;

export type GoogleMeetStatus = {
  state: GoogleMeetState;
  /** GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set (new Google connections possible). */
  serverConfigured: boolean;
  /** The calendar new meetings are added to (its Meet link comes from this calendar's account). */
  calendar: { id: string; name: string; accountEmail: string | null } | null;
  /** Live Google accounts of the user. */
  accounts: { id: string; email: string | null; status: "active" | "needs_reauth" | "error" }[];
  /** The account to reconnect (state needs_reauth). */
  reconnectConnectionId: string | null;
  /** Explanation of a state other than ready (null when ready). */
  reason: string | null;
  /** Where the user fixes it (null when ready). */
  fixUrl: string | null;
};

export type MeetEventType = { id: string; name: string; slug: string; color: string; active: boolean; onlyLocation: boolean };

const REASONS: Record<Exclude<GoogleMeetState, "ready">, string> = {
  not_configured: "Google Meet isn't set up on this server yet. Your administrator needs to add a Google OAuth client.",
  not_connected: CONFERENCING_COPY.meetRequiresGoogle,
  needs_reauth: "Your Google Calendar connection needs attention. Reconnect it so new meetings get Google Meet links.",
  no_destination: CONFERENCING_COPY.meetRequiresGoogle,
  destination_not_google: CONFERENCING_COPY.meetRequiresGoogle,
  meet_disabled:
    "Google Meet is turned off for the calendar you add events to. Ask your Google Workspace administrator to allow Google Meet, or choose another Google calendar to add events to.",
};

/** Google Calendar connect link that comes back to the Google Meet page. */
export function googleMeetConnectHref(reconnectConnectionId?: string | null): string {
  return oauthStartPath("google", {
    intent: "connect_calendar",
    next: GOOGLE_MEET_PAGE_PATH,
    ...(reconnectConnectionId ? { data: { reconnect: reconnectConnectionId } } : {}),
  });
}

type AccountRow = { id: string; email: string | null; status: string };

function liveStatus(status: string): "active" | "needs_reauth" | "error" {
  return status === "needs_reauth" || status === "error" ? status : "active";
}

/** Everything the Google Meet page and the options need (the user's own rows only). */
export async function getGoogleMeetStatus(userId: string): Promise<GoogleMeetStatus> {
  const serverConfigured = getFeatures().googleOAuth;
  const empty: GoogleMeetStatus = {
    state: serverConfigured ? "not_connected" : "not_configured",
    serverConfigured,
    calendar: null,
    accounts: [],
    reconnectConnectionId: null,
    reason: null,
    fixUrl: null,
  };
  if (!isUuid(userId)) return withReason(empty);
  const db = await getDb();
  const accountRows: AccountRow[] = await db
    .select({ id: calendarConnections.id, email: calendarConnections.accountEmail, status: calendarConnections.status })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.provider, "google"), ne(calendarConnections.status, "disconnected")))
    .orderBy(asc(calendarConnections.createdAt), asc(calendarConnections.id));
  const accounts = accountRows.map((a) => ({ id: a.id, email: a.email, status: liveStatus(a.status) }));

  const dest = await getDestinationCalendar(userId);
  if (dest?.provider === "google" && dest.supports.googleMeet) {
    const email = accounts.find((a) => a.id === dest.connectionId)?.email ?? null;
    return { ...empty, state: "ready", accounts, calendar: { id: dest.calendarId, name: dest.name, accountEmail: email } };
  }

  // Not usable: find out why from the stored destination.
  const [chosen] = await db
    .select({
      id: calendars.id,
      name: calendars.name,
      canWrite: calendars.canWrite,
      deletedAt: calendars.deletedAt,
      allowed: calendars.allowedOnlineMeetingProviders,
      connectionId: calendarConnections.id,
      connectionUserId: calendarConnections.userId,
      provider: calendarConnections.provider,
      status: calendarConnections.status,
      email: calendarConnections.accountEmail,
    })
    .from(users)
    .innerJoin(calendars, eq(calendars.id, users.destinationCalendarId))
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendars.connectionId))
    .where(and(eq(users.id, userId), isNull(calendars.deletedAt)))
    .limit(1);
  const base = { ...empty, accounts };
  const usable = chosen && chosen.connectionUserId === userId && chosen.status !== "disconnected";
  if (usable && chosen) {
    const calendar = { id: chosen.id, name: chosen.name, accountEmail: chosen.email };
    if (chosen.provider !== "google") return withReason({ ...base, state: "destination_not_google", calendar });
    if (chosen.status === "needs_reauth") return withReason({ ...base, state: "needs_reauth", calendar, reconnectConnectionId: chosen.connectionId });
    if (chosen.canWrite && chosen.allowed.length > 0 && !chosen.allowed.includes("hangoutsMeet")) {
      return withReason({ ...base, state: "meet_disabled", calendar });
    }
  }
  if (accounts.length === 0) return withReason(base);
  const working = accounts.filter((a) => a.status !== "needs_reauth");
  if (working.length === 0) return withReason({ ...base, state: "needs_reauth", reconnectConnectionId: accounts[0]!.id });
  return withReason({ ...base, state: "no_destination" });
}

function withReason(s: GoogleMeetStatus): GoogleMeetStatus {
  if (s.state === "ready") return { ...s, reason: null, fixUrl: null };
  const fixUrl =
    s.state === "not_configured"
      ? GOOGLE_MEET_PAGE_PATH
      : s.state === "not_connected"
        ? googleMeetConnectHref()
        : s.state === "needs_reauth"
          ? s.serverConfigured
            ? googleMeetConnectHref(s.reconnectConnectionId)
            : GOOGLE_MEET_PAGE_PATH
          : CALENDAR_SETTINGS_PAGE_PATH;
  return { ...s, reason: REASONS[s.state], fixUrl };
}

/** The user's own event types with a Google Meet location (the Google Meet page lists them). */
export async function listMeetEventTypes(userId: string): Promise<MeetEventType[]> {
  if (!isUuid(userId)) return [];
  const db = await getDb();
  const rows = await db
    .select({ id: eventTypes.id, name: eventTypes.name, slug: eventTypes.slug, color: eventTypes.color, active: eventTypes.active, locations: eventTypes.locations })
    .from(eventTypes)
    .where(
      and(
        eq(eventTypes.ownerUserId, userId),
        isNull(eventTypes.teamId),
        isNull(eventTypes.deletedAt),
        sql`${eventTypes.locations} @> '[{"kind":"google_conference"}]'::jsonb`,
      ),
    )
    .orderBy(asc(eventTypes.position), asc(eventTypes.createdAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    color: r.color,
    active: r.active,
    onlyLocation: r.locations.length === 1,
  }));
}

const NOT_OFFERED: ConferencingOption = { available: false, code: "not_offered", reason: "Not available on this server." };

/** Which conferencing locations this user can offer (section 11), with the reason and fix link when unavailable. */
export async function getConferencingOptions(userId: string): Promise<Record<ConferenceKind, ConferencingOption>> {
  const meet = await getGoogleMeetStatus(userId);
  const google: ConferencingOption =
    meet.state === "ready" ? { available: true } : { available: false, code: meet.state, reason: meet.reason ?? undefined, connectUrl: meet.fixUrl ?? undefined };
  return {
    google_conference: google,
    microsoft_teams_conference: NOT_OFFERED,
    zoom_conference: NOT_OFFERED,
    jitsi_conference: NOT_OFFERED,
    webex_conference: NOT_OFFERED,
    gotomeeting_conference: NOT_OFFERED,
  };
}
