// OWNER: calendar-integrations.
//
// Read models for the Calendar settings page and the Google Calendar integration page (SPEC CAL-01, CAL-21), plus the
// throttled calendar list refresh those pages trigger (at most every 15 minutes per connection, in a job after the
// response, never while rendering). Free/busy only calendars (access.ts) are listed with busyOnly: they can be checked
// for conflicts but never chosen as the calendar to add events to.
import "server-only";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarConnections, calendars, users } from "@/db/schema";
import { getFeatures, isE2eMode } from "@/lib/env";
import { enqueueJob, runJobsNowInBackground } from "@/lib/jobs";
import { nowMs } from "@/lib/time/now";
import { isBusyOnlyCalendar } from "./access";
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
  /** "See only free/busy" access: busy times block bookings, but no titles, no events added, no change sync. */
  busyOnly: boolean;
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
          ctag: calendars.ctag,
        })
        .from(calendars)
        .where(and(inArray(calendars.connectionId, ids), isNull(calendars.deletedAt), eq(calendars.userId, userId)))
    : [];
  const [u] = await db.select({ dest: users.destinationCalendarId }).from(users).where(eq(users.id, userId)).limit(1);
  const byConn = new Map<string, SettingsCalendar[]>();
  for (const c of cals) {
    const { connectionId, ctag, ...rest } = c;
    const busyOnly = isBusyOnlyCalendar({ ctag });
    byConn.set(connectionId, [...(byConn.get(connectionId) ?? []), { ...rest, canWrite: rest.canWrite && !busyOnly, busyOnly }]);
  }
  const sortCals = (list: SettingsCalendar[]) =>
    list.sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) ||
        Number(b.canWrite) - Number(a.canWrite) ||
        Number(a.busyOnly) - Number(b.busyOnly) ||
        a.name.localeCompare(b.name),
    );
  // The destination shown is one that can still receive events (CAL-08; getDestinationCalendar agrees).
  const visibleCalendarIds = new Set(cals.filter((c) => c.canWrite && !isBusyOnlyCalendar(c)).map((c) => c.id));
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

/** Refreshes the user's Google calendar lists (throttled per connection); call it inside after(). Never throws. */
export async function refreshCalendarListsSoon(userId: string): Promise<void> {
  try {
    await refreshLists(userId);
  } catch {
    // best effort: the periodic job refreshes every 6 hours
  }
}

async function refreshLists(userId: string): Promise<void> {
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
  if (ids.length) await runJobsNowInBackground({ ids, thenAnyDue: false, budgetMs: 6_000 });
}
