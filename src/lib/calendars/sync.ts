// OWNER: calendar-integrations.
//
// Host-side changes of booked meetings (SPEC CAL-14, CAL-13, CR-17; ARCHITECTURE 10.3; observed in the owner's
// account: moving the Google event reschedules the booking, deleting it cancels it).
// syncBookedEvents checks the provider events this app created for active upcoming meetings (next 90 days) on
// calendars with "Automatically sync cancellations and reschedules" on, each at most every 10 minutes (a push
// notification forces an immediate check of its calendar): deleted (or cancelled) -> { type: "deleted" }, declined
// by the host -> { type: "declined" }, start or end different from what we last wrote -> { type: "moved", start,
// end } (buffer events: the buffer changed). Each change goes to lifecycle-core's applyExternalCalendarChange, which
// cancels or reschedules the meeting with the CR-17 reasons and notifies invitees. Rows are batched per connection;
// a transient provider failure stops that connection's batch until the next run.
import "server-only";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarConnections, calendarLinkedEvents, calendars, scheduledEvents } from "@/db/schema";
import { applyExternalCalendarChange, type ExternalCalendarChange } from "@/lib/lifecycle";
import { log } from "@/lib/logger";
import { now } from "@/lib/time/now";
import { invalidateCalendarCache } from "./busy";
import { withConnection } from "./credentials";
import { markConnectionHealthy, recordConnectionFailure } from "./health";
import { getProvider } from "./providers/registry";
import { isProviderAuthError, isProviderTransientError, type RemoteEvent } from "./providers/types";

/** CAL-14: each linked event is checked at most this often (push notifications bypass it). */
export const SYNC_CHECK_INTERVAL_MS = 10 * 60 * 1000;
export const SYNC_HORIZON_DAYS = 90;
const BATCH = 100;

type SyncRow = {
  id: string;
  purpose: "meeting" | "buffer_before" | "buffer_after" | "one_off_hold" | "poll_hold";
  externalId: string | null;
  syncedStartAt: Date | null;
  syncedEndAt: Date | null;
  calendarExternalId: string;
  connectionId: string;
  provider: (typeof calendarConnections.$inferSelect)["provider"];
};

/** The change a provider event shows compared with what we wrote, or null. */
export function detectChange(row: Pick<SyncRow, "syncedStartAt" | "syncedEndAt">, ev: RemoteEvent | null): ExternalCalendarChange | null {
  if (!ev || ev.status === "cancelled") return { type: "deleted" };
  if (ev.selfDeclined) return { type: "declined" };
  // A meeting turned into an all-day event has no meeting time to move to: leave it alone.
  if (ev.allDay) return null;
  if (!row.syncedStartAt || !row.syncedEndAt) return null;
  if (ev.start.getTime() !== row.syncedStartAt.getTime() || ev.end.getTime() !== row.syncedEndAt.getTime()) {
    if (!(ev.end > ev.start)) return null;
    return { type: "moved", start: ev.start, end: ev.end };
  }
  return null;
}

/** CAL-14 sync run (see the file header). `calendarId` limits it to one calendar and ignores the 10 minute spacing. */
export async function syncBookedEvents(opts: { calendarId?: string; limit?: number } = {}): Promise<{ checked: number; changes: number }> {
  const db = await getDb();
  const t = now();
  const horizon = new Date(t.getTime() + SYNC_HORIZON_DAYS * 86_400_000);
  const checkedBefore = new Date(t.getTime() - SYNC_CHECK_INTERVAL_MS);
  const rows: SyncRow[] = await db
    .select({
      id: calendarLinkedEvents.id,
      purpose: calendarLinkedEvents.purpose,
      externalId: calendarLinkedEvents.externalId,
      syncedStartAt: calendarLinkedEvents.syncedStartAt,
      syncedEndAt: calendarLinkedEvents.syncedEndAt,
      calendarExternalId: calendars.externalId,
      connectionId: calendars.connectionId,
      provider: calendarConnections.provider,
    })
    .from(calendarLinkedEvents)
    .innerJoin(calendars, eq(calendars.id, calendarLinkedEvents.calendarId))
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendars.connectionId))
    .innerJoin(scheduledEvents, eq(scheduledEvents.id, calendarLinkedEvents.scheduledEventId))
    .where(
      and(
        inArray(calendarLinkedEvents.purpose, ["meeting", "buffer_before", "buffer_after"]),
        eq(calendarLinkedEvents.status, "synced"),
        isNotNull(calendarLinkedEvents.externalId),
        eq(calendars.syncChanges, true),
        isNull(calendars.deletedAt),
        inArray(calendarConnections.status, ["active", "error"]),
        eq(scheduledEvents.status, "active"),
        gt(scheduledEvents.endAt, t),
        lt(scheduledEvents.startAt, horizon),
        opts.calendarId ? eq(calendarLinkedEvents.calendarId, opts.calendarId) : or(isNull(calendarLinkedEvents.lastCheckedAt), lt(calendarLinkedEvents.lastCheckedAt, checkedBefore)),
      ),
    )
    .orderBy(sql`${calendarLinkedEvents.lastCheckedAt} asc nulls first`, asc(calendarLinkedEvents.id))
    .limit(opts.limit ?? BATCH);

  const byConnection = new Map<string, SyncRow[]>();
  for (const r of rows) byConnection.set(r.connectionId, [...(byConnection.get(r.connectionId) ?? []), r]);
  let checked = 0;
  let changes = 0;
  for (const [connectionId, list] of byConnection) {
    const impl = getProvider(list[0]!.provider);
    if (!impl?.capabilities.changeSync) continue;
    try {
      await withConnection(connectionId, async (ctx) => {
        for (const row of list) {
          const ev = await impl.getEvent(ctx, row.calendarExternalId, row.externalId!);
          checked++;
          const change = detectChange(row, ev);
          const stamp = now();
          if (!change) {
            await db.update(calendarLinkedEvents).set({ lastCheckedAt: stamp }).where(eq(calendarLinkedEvents.id, row.id));
            continue;
          }
          changes++;
          log.info("calendars.external_change", { linkedEventId: row.id, purpose: row.purpose, change: change.type });
          try {
            await applyExternalCalendarChange({ linkedEventId: row.id, change });
          } catch (e) {
            // Leave the row as is so the next run (10 minutes) retries the change.
            log.error("calendars.apply_external_change_failed", { linkedEventId: row.id, change: change.type, error: e });
            await db.update(calendarLinkedEvents).set({ lastCheckedAt: stamp }).where(eq(calendarLinkedEvents.id, row.id));
            continue;
          }
          await db
            .update(calendarLinkedEvents)
            .set(
              change.type === "moved"
                ? { lastCheckedAt: stamp, syncedStartAt: change.start, syncedEndAt: change.end, updatedAt: stamp }
                : change.type === "deleted"
                  ? { lastCheckedAt: stamp, status: "deleted", updatedAt: stamp }
                  : { lastCheckedAt: stamp, updatedAt: stamp },
            )
            .where(eq(calendarLinkedEvents.id, row.id));
        }
      });
      await markConnectionHealthy(connectionId, db);
    } catch (e) {
      log.warn("calendars.sync_booked_events_failed", { connectionId, error: e });
      if (isProviderTransientError(e)) await recordConnectionFailure(connectionId, (e as Error).message);
      else if (!isProviderAuthError(e)) throw e;
    }
  }
  return { checked, changes };
}

/** A push notification for one calendar: its busy cache is stale and its booked events are checked now. */
export async function syncCalendar(calendarId: string): Promise<{ checked: number; changes: number }> {
  await invalidateCalendarCache([calendarId]);
  return syncBookedEvents({ calendarId });
}
