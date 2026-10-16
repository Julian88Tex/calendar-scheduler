// OWNER: calendar-integrations.
//
// Calendar provider interface, verbatim from ARCHITECTURE section 10.1 (the error classes use plain fields because the
// project enables erasableSyntaxOnly). docs/SCOPE.md keeps Google Calendar only: google.ts implements it; the
// calendly_import provider is cache only (its rows are written by an importer and never refetched, section 10.1), so
// the busy cache serves it without a provider object.
//
// Additive to section 10.1: ProviderAuthError and ProviderRequestError carry an optional machine reason and HTTP
// status, and ProviderRequestError marks permanent per request failures (404, 409, 400, a calendar that is no longer
// writable) that must neither mark the connection broken nor be retried.
// Also additive: RemoteCalendar.busyOnly (a calendar shared with "See only free/busy": Google freeBusyReader) and the
// optional CalendarProvider.listBusy, which reads such calendars as untitled busy intervals (Google FreeBusy API).
export type CalendarProviderId = "google" | "microsoft" | "caldav" | "ics" | "calendly_import";
export interface ConnectionContext {           // decrypted, refreshed credentials for one connection
  connectionId: string; userId: string; provider: CalendarProviderId;
  accessToken?: string; caldav?: { serverUrl: string; username: string; password: string; principalUrl?: string };
  icsUrl?: string; unavailableStatuses: string[];
}
export interface RemoteCalendar { externalId: string; name: string; color?: string | null; timeZone?: string | null;
  isPrimary: boolean; canWrite: boolean; allowedOnlineMeetingProviders?: string[];
  /** Free/busy access only (no event details): never writable, read with listBusy, no push channels or change sync. */
  busyOnly?: boolean }
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
  /**
   * Busy intervals of calendars the account sees as free/busy only (RemoteCalendar.busyOnly): untitled, always busy,
   * never all-day. Same result contract as listEvents (a calendar missing from the result is gone). Some calendars
   * unreadable while others answered: rejects with ProviderPartialError. Providers without it read those calendars
   * with listEvents.
   */
  listBusy?(ctx: ConnectionContext, calendarExternalIds: string[], range: { start: Date; end: Date }): Promise<Record<string, RemoteEvent[]>>;
  getEvent(ctx: ConnectionContext, calendarExternalId: string, externalId: string): Promise<RemoteEvent | null>;   // null = deleted
  createEvent(ctx: ConnectionContext, calendarExternalId: string, input: WriteEventInput): Promise<WriteEventResult>;
  updateEvent(ctx: ConnectionContext, calendarExternalId: string, externalId: string, input: WriteEventInput, etag?: string | null): Promise<WriteEventResult>;
  deleteEvent(ctx: ConnectionContext, calendarExternalId: string, externalId: string, opts: { notifyAttendees: boolean; comment?: string }): Promise<void>;
}

/** Why a provider refused the credentials. */
export type ProviderAuthReason = "unauthorized" | "invalid_grant" | "insufficient_scope" | "api_disabled" | "no_credentials" | "unsupported";

/** -> connection needs_reauth */
export class ProviderAuthError extends Error {
  reason?: ProviderAuthReason;
  constructor(message?: string, reason?: ProviderAuthReason) {
    super(message);
    this.name = "ProviderAuthError";
    this.reason = reason;
  }
}
/** -> retry with backoff */
export class ProviderTransientError extends Error {
  /** HTTP status when the provider answered (429, 5xx), else undefined (network, timeout). */
  status?: number;
  constructor(message?: string, status?: number) {
    super(message);
    this.name = "ProviderTransientError";
    this.status = status;
  }
}
/** A permanent failure of one request (not found, conflict, bad request, calendar not writable): no retry, no reauth. */
export class ProviderRequestError extends Error {
  status: number;
  /** Provider reason ("notFound", "duplicate", "forbidden", "requiredAccessLevel", ...). */
  reason: string | null;
  constructor(status: number, message?: string, reason?: string | null) {
    super(message ?? `Provider request failed with ${status}`);
    this.name = "ProviderRequestError";
    this.status = status;
    this.reason = reason ?? null;
  }
}

/**
 * listBusy only: some calendars of the request could not be read (Google FreeBusy per calendar errors such as
 * internalError or backendError). `results` holds the other calendars with the usual contract (a calendar missing from
 * it is gone); `failedIds` are the unreadable ones, each a failure of that calendar alone, never of the connection.
 */
export class ProviderPartialError extends ProviderTransientError {
  results: Record<string, RemoteEvent[]>;
  failedIds: string[];
  constructor(message: string, results: Record<string, RemoteEvent[]>, failedIds: string[]) {
    super(message);
    this.name = "ProviderPartialError";
    this.results = results;
    this.failedIds = failedIds;
  }
}

/** Error kinds by name too, so fakes (tests/helpers/fake-providers.ts sets err.name) map like the real classes. */
export function isProviderAuthError(e: unknown): e is ProviderAuthError {
  return e instanceof ProviderAuthError || (e as { name?: unknown } | null)?.name === "ProviderAuthError";
}
export function isProviderTransientError(e: unknown): e is ProviderTransientError {
  return e instanceof ProviderTransientError || (e as { name?: unknown } | null)?.name === "ProviderTransientError";
}
export function isProviderPartialError(e: unknown): e is ProviderPartialError {
  return e instanceof ProviderPartialError || ((e as { name?: unknown } | null)?.name === "ProviderPartialError" && Array.isArray((e as { failedIds?: unknown }).failedIds));
}
export function isProviderRequestError(e: unknown): e is ProviderRequestError {
  return e instanceof ProviderRequestError || (e as { name?: unknown } | null)?.name === "ProviderRequestError";
}
/** 404 or 410 from the provider (the event or calendar is gone). */
export function isProviderGone(e: unknown): boolean {
  return isProviderRequestError(e) && (e.status === 404 || e.status === 410);
}
