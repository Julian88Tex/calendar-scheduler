// OWNER: calendar-integrations. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Calendar integrations public API (ARCHITECTURE section 10.2). Callers pass user ids they already authorized
// (section 18.7); these functions never decide access themselves.
// Foundation stub: no calendars are connected. getExternalBusy answers { ok: true, busy: [] } per user, events [],
// destination null, upsertLinkedEvent "skipped_no_calendar", replaceImportedBusy { connectionId: "" }, others no-ops.
// Consumers must behave correctly with the stub.
import "server-only";
import type { CalendarProviderId, WriteEventInput, WriteEventResult } from "./providers/types";

export type { CalendarProviderId, WriteEventInput, WriteEventResult } from "./providers/types";

export type ExternalBusy = {
  start: Date;
  end: Date;
  allDay: boolean;
  allDayStartDate?: string;
  allDayEndDate?: string;
  title: string | null;
  calendarId: string;
  externalId: string;
};

export type ExternalBusyByUser = Record<string, { ok: boolean; stale: boolean; nocal: boolean; busy: ExternalBusy[] }>;

export async function getExternalBusy(p: {
  userIds: string[];
  start: Date;
  end: Date;
  maxAgeSeconds?: number;
  timeoutMs?: number;
}): Promise<ExternalBusyByUser> {
  const out: ExternalBusyByUser = {};
  for (const id of p.userIds) out[id] = { ok: true, stale: false, nocal: false, busy: [] };
  return out;
}

export type ExternalEventListItem = {
  id: string;
  calendarName: string;
  color: string | null;
  title: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  busy: boolean;
};

/** The caller's own events only (titles included). */
export async function listExternalEvents(p: { userId: string; start: Date; end: Date }): Promise<ExternalEventListItem[]> {
  void p;
  return [];
}

export type DestinationCalendar = {
  calendarId: string;
  connectionId: string;
  provider: CalendarProviderId;
  name: string;
  supports: { invitations: boolean; googleMeet: boolean; teams: boolean };
};

export async function getDestinationCalendar(userId: string, eventTypeId?: string): Promise<DestinationCalendar | null> {
  void userId;
  void eventTypeId;
  return null;
}

export type LinkedEventInput = {
  userId: string;
  purpose: "meeting" | "buffer_before" | "buffer_after" | "one_off_hold" | "poll_hold";
  scheduledEventId?: string;
  oneOffMeetingId?: string;
  oneOffSpotId?: string;
  pollId?: string;
  pollOptionId?: string;
  /** Default: the user's destination (or the event type override). */
  calendarId?: string;
  event: Omit<WriteEventInput, "idempotencyKey" | "privateProperties">;
  /** Update instead of create. */
  existingLinkedEventId?: string;
};

export type UpsertLinkedEventResult = {
  linkedEventId: string;
  externalId: string | null;
  icalUid?: string | null;
  htmlLink?: string | null;
  conference?: WriteEventResult["conference"];
  status: "synced" | "pending" | "failed" | "skipped_no_calendar";
};

// Group slots (CAL-11): lifecycle-core calls upsertLinkedEvent once per slot (attendees [], sendInvitations false) with
// existingLinkedEventId on every join, invitee cancellation and limit change, and deleteLinkedEvent when the slot is
// canceled.
export async function upsertLinkedEvent(input: LinkedEventInput): Promise<UpsertLinkedEventResult> {
  void input;
  return { status: "skipped_no_calendar", linkedEventId: "", externalId: null };
}

export async function deleteLinkedEvent(p: { linkedEventId: string; notifyAttendees: boolean; comment?: string }): Promise<void> {
  void p;
}

/** Reschedule continuity: re-points calendar_linked_events to the new scheduled event (provider event moved). */
export async function repointLinkedEvents(p: { fromScheduledEventId: string; toScheduledEventId: string }): Promise<void> {
  void p;
}

/** CAL-17: creates or refreshes the calendar connection of an OAuth sign-in. */
export async function linkCalendarFromOAuth(p: {
  userId: string;
  provider: "google" | "microsoft";
  providerAccountId: string;
  accountEmail: string;
  oauthAccountId: string;
  tokens: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null; scopes: string[] };
}): Promise<void> {
  void p;
}

export async function getCalendarHealth(
  userId: string,
): Promise<{ ok: boolean; brokenConnections: { id: string; email: string | null; status: string }[] }> {
  void userId;
  return { ok: true, brokenConnections: [] };
}

/**
 * CAL-22: creates or reuses the user's "Imported from Calendly" connection (provider calendly_import, one calendar,
 * check_conflicts true, never a destination), replaces its external_events with these rows and marks its sync windows
 * fresh; called by the BR-17 importer (settings-onboarding).
 */
export async function replaceImportedBusy(p: {
  userId: string;
  source: "calendly";
  events: { externalId: string; start: Date; end: Date; title: string | null }[];
}): Promise<{ connectionId: string }> {
  void p;
  return { connectionId: "" };
}
