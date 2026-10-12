// OWNER: calendar-integrations.
//
// Read models for the Calendar settings page and the Google Calendar integration page (SPEC CAL-01, CAL-21), plus the
// throttled calendar list refresh those pages trigger (at most every 15 minutes per connection, in a job after the
// response, never while rendering).
import "server-only";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarConnections, calendars, users } from "@/db/schema";
import { getFeatures, isE2eMode } from "@/lib/env";
import { enqueueJob, runJobsAfterResponse } from "@/lib/jobs";
import { nowMs } from "@/lib/time/now";
import { CALENDAR_ACCOUNT_MAX, CALENDAR_ACCOUNT_SOFT_LIMIT, CALENDAR_LIST_JOB } from "./connections";
import type { CalendarProviderId } from "./providers/types";
import { pushNotificationsAvailable } from "./watch";

export type SettingsCalendar = {
  id: string;
  name: string;
  color: string | null;
  isPrimary: boolean;
  canWrite: boolean;
  checkConflicts: boolean;
  includeBuffers: boolean;
  syncChanges: boolean;
};

export type SettingsConnection = {
  id: string;
  provider: CalendarProviderId;
  email: string | null;
  displayName: string | null;
  status: "active" | "needs_reauth" | "error";
  lastError: string | null;
  createdAt: string;
  calendars: SettingsCalendar[];
};

export type CalendarSettingsView = {
  connections: SettingsConnection[];
  destinationCalendarId: string | null;
  googleConfigured: boolean;
  pushNotifications: boolean;
  softLimit: number;
  maxAccounts: number;
};

/** Everything the Calendar settings page renders (the user's own connections only). */
export async function getCalendarSettingsView(userId: string): Promise<CalendarSettingsView> {
  const db = await getDb();
  const conns = await db
    .select({
      id: calendarConnections.id,
      provider: calendarConnections.provider,
      email: calendarConnections.accountEmail,
      displayName: calendarConnections.displayName,
      status: calendarConnections.status,
      lastError: calendarConnections.lastError,
      createdAt: calendarConnections.createdAt,
    })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.userId, userId), ne(calendarConnections.status, "disconnected")))
    .orderBy(asc(calendarConnections.createdAt), asc(calendarConnections.id));
  const ids = conns.map((c) => c.id);
  const cals = ids.length
    ? await db
        .select({
          id: calendars.id,
          connectionId: calendars.connectionId,
          name: calendars.name,
          color: calendars.color,
          isPrimary: calendars.isPrimary,
          canWrite: calendars.canWrite,
          checkConflicts: calendars.checkConflicts,
          includeBuffers: calendars.includeBuffers,
          syncChanges: calendars.syncChanges,
        })
        .from(calendars)
        .where(and(inArray(calendars.connectionId, ids), isNull(calendars.deletedAt), eq(calendars.userId, userId)))
    : [];
  const [u] = await db.select({ dest: users.destinationCalendarId }).from(users).where(eq(users.id, userId)).limit(1);
  const byConn = new Map<string, SettingsCalendar[]>();
  for (const c of cals) {
    const { connectionId, ...rest } = c;
    byConn.set(connectionId, [...(byConn.get(connectionId) ?? []), rest]);
  }
  const sortCals = (list: SettingsCalendar[]) =>
    list.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || Number(b.canWrite) - Number(a.canWrite) || a.name.localeCompare(b.name));
  const visibleCalendarIds = new Set(cals.map((c) => c.id));
  return {
    connections: conns.map((c) => ({
      id: c.id,
      provider: c.provider,
      email: c.email,
      displayName: c.displayName,
      status: c.status === "needs_reauth" || c.status === "error" ? c.status : "active",
      lastError: c.lastError,
      createdAt: c.createdAt.toISOString(),
      calendars: sortCals(byConn.get(c.id) ?? []),
    })),
    destinationCalendarId: u?.dest && visibleCalendarIds.has(u.dest) ? u.dest : null,
    googleConfigured: getFeatures().googleOAuth,
    pushNotifications: pushNotificationsAvailable(),
    softLimit: CALENDAR_ACCOUNT_SOFT_LIMIT,
    maxAccounts: CALENDAR_ACCOUNT_MAX,
  };
}

/** Refreshes the user's Google calendar lists in the background (throttled per connection). */
export async function refreshCalendarListsSoon(userId: string): Promise<void> {
  if (isE2eMode()) return; // E2E runs jobs explicitly (/api/test/run-jobs)
  const db = await getDb();
  const rows = await db
    .select({ id: calendarConnections.id })
    .from(calendarConnections)
    .where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.provider, "google"), eq(calendarConnections.status, "active")));
  if (!rows.length) return;
  const bucket = Math.floor(nowMs() / (15 * 60_000));
  const ids: string[] = [];
  for (const r of rows) {
    const id = await enqueueJob(db, { type: CALENDAR_LIST_JOB, payload: { connectionId: r.id }, idempotencyKey: `callist:${r.id}:v${bucket}` });
    if (id) ids.push(id);
  }
  if (ids.length) runJobsAfterResponse({ ids, thenAnyDue: false });
}
