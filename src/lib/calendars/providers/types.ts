// OWNER: calendar-integrations. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Calendar provider interface, verbatim from ARCHITECTURE section 10.1 (the error classes use plain fields because the
// project enables erasableSyntaxOnly). Implementations live next to this file (google.ts, microsoft.ts, caldav.ts,
// ics.ts, calendly-import.ts), written by calendar-integrations.
export type CalendarProviderId = "google" | "microsoft" | "caldav" | "ics" | "calendly_import";
export interface ConnectionContext {           // decrypted, refreshed credentials for one connection
  connectionId: string; userId: string; provider: CalendarProviderId;
  accessToken?: string; caldav?: { serverUrl: string; username: string; password: string; principalUrl?: string };
  icsUrl?: string; unavailableStatuses: string[];
}
export interface RemoteCalendar { externalId: string; name: string; color?: string | null; timeZone?: string | null;
  isPrimary: boolean; canWrite: boolean; allowedOnlineMeetingProviders?: string[] }
export interface RemoteEvent {                 // one expanded instance
  externalId: string; icalUid?: string | null; recurringEventId?: string | null;
  start: Date; end: Date; allDay: boolean; allDayStartDate?: string; allDayEndDate?: string;   // all-day dates in calendar terms
  title: string | null; busy: boolean; showAs?: string | null; status?: "confirmed" | "tentative" | "cancelled" | null;
  selfDeclined?: boolean; extendedPrivate?: Record<string, string>; updatedAt?: Date | null; etag?: string | null;
}
export interface WriteEventInput {
  title: string; descriptionText: string; descriptionHtml?: string; location?: string | null;
  start: Date; end: Date; allDay?: boolean; allDayDate?: string;
  attendees: { email: string; name?: string | null; optional?: boolean }[];
  sendInvitations: boolean;                    // Google sendUpdates=all|none; Graph: attendees only when true
  conference?: "google_meet" | "microsoft_teams" | null;
  transparency: "busy" | "free"; visibility?: "default" | "private";
  icalUid: string;                             // our UID (CalDAV object name, Google iCalUID best effort)
  idempotencyKey: string;                      // Google event id (base32hex), Graph transactionId
  privateProperties: Record<string, string>;   // kairosEventId, kairosPurpose
}
export interface WriteEventResult { externalId: string; etag?: string | null;
  icalUid?: string | null;                     // provider iCal UID (Google iCalUID, Graph iCalUId): stored as scheduled_events.provider_ical_uid
  htmlLink?: string | null;                    // Google htmlLink, Graph webLink: scheduled_events.invitation_url ("Open Invitation")
  conference?: { joinUrl: string | null; status: "pushed" | "processing" | "failed"; data?: Record<string, unknown> } }
export interface CalendarProvider {
  id: CalendarProviderId;
  capabilities: { write: boolean; invitations: boolean; conferences: ("google_meet" | "microsoft_teams")[]; changeSync: boolean };
  listCalendars(ctx: ConnectionContext): Promise<RemoteCalendar[]>;
  listEvents(ctx: ConnectionContext, calendarExternalIds: string[], range: { start: Date; end: Date }): Promise<Record<string, RemoteEvent[]>>;
  getEvent(ctx: ConnectionContext, calendarExternalId: string, externalId: string): Promise<RemoteEvent | null>;   // null = deleted
  createEvent(ctx: ConnectionContext, calendarExternalId: string, input: WriteEventInput): Promise<WriteEventResult>;
  updateEvent(ctx: ConnectionContext, calendarExternalId: string, externalId: string, input: WriteEventInput, etag?: string | null): Promise<WriteEventResult>;
  deleteEvent(ctx: ConnectionContext, calendarExternalId: string, externalId: string, opts: { notifyAttendees: boolean; comment?: string }): Promise<void>;
}
/** -> connection needs_reauth */
export class ProviderAuthError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "ProviderAuthError";
  }
}
/** -> retry with backoff */
export class ProviderTransientError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "ProviderTransientError";
  }
}
