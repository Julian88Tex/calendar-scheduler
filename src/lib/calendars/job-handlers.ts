// OWNER: calendar-integrations.
//
// Job handlers of this module (ARCHITECTURE section 12.2), re-exported by jobs.ts:
// - calendars.sync_booked_events (periodic, every 10 minutes, CAL-14) and calendars.sync_calendar (push notification).
// - calendars.linked_event_retry: retries provider deletes and buffer event writes after transient failures.
// - calendars.connection_problem: the CAL-15 email (at most one per user per 24 hours).
// - calendars.revoke_token: CAL-16 best effort Google token revoke and channel stop after a disconnect.
// - calendars.refresh_calendar_list (one connection) and calendars.refresh_calendar_lists (periodic, every 6 hours).
// - calendars.watch_connection and calendars.watch_renew (periodic, every 6 hours): Google push channels.
// Handlers re-read state and no-op when it no longer applies (section 12.4).
import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { calendarConnections } from "@/db/schema";
import { revokeGoogleToken } from "@/lib/auth/oauth/google";
import { decryptOrNull } from "@/lib/crypto";
import { getFeatures } from "@/lib/env";
import { isUuid } from "@/lib/ids";
import { enqueueJob, RetryLaterError, type JobHandlers, type PeriodicJob } from "@/lib/jobs";
import { CALENDAR_LIST_JOB, REVOKE_JOB, syncCalendarList, WATCH_JOB } from "./connections";
import { CONNECTION_PROBLEM_JOB, sendConnectionProblemEmail } from "./health";
import { deleteLinkedEventNow, LINKED_EVENT_RETRY_JOB, syncBufferEvents } from "./linked-events";
import { stopGoogleChannel } from "./providers/google";
import { isProviderAuthError, isProviderTransientError } from "./providers/types";
import { syncBookedEvents, syncCalendar } from "./sync";
import { ensureWatchChannels, renewWatchChannels, SYNC_CALENDAR_JOB } from "./watch";

export const SYNC_BOOKED_EVENTS_JOB = "calendars.sync_booked_events";
export const REFRESH_CALENDAR_LISTS_JOB = "calendars.refresh_calendar_lists";
export const WATCH_RENEW_JOB = "calendars.watch_renew";

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export const handlers: JobHandlers = {
  [SYNC_BOOKED_EVENTS_JOB]: async (_payload: unknown) => {
    const result = await syncBookedEvents();
    return { result };
  },

  [SYNC_CALENDAR_JOB]: async (payload: { calendarId?: unknown }) => {
    const calendarId = str(payload?.calendarId);
    if (!calendarId || !isUuid(calendarId)) return;
    return { result: await syncCalendar(calendarId) };
  },

  [LINKED_EVENT_RETRY_JOB]: async (payload: { op?: unknown; linkedEventId?: unknown; notifyAttendees?: unknown; comment?: unknown; userId?: unknown; scheduledEventId?: unknown }) => {
    if (payload?.op === "delete") {
      const linkedEventId = str(payload.linkedEventId);
      if (!linkedEventId || !isUuid(linkedEventId)) return;
      await deleteLinkedEventNow({ linkedEventId, notifyAttendees: payload.notifyAttendees === true, comment: str(payload.comment) ?? undefined });
      return;
    }
    if (payload?.op === "buffers") {
      const userId = str(payload.userId);
      const scheduledEventId = str(payload.scheduledEventId);
      if (!userId || !scheduledEventId || !isUuid(userId) || !isUuid(scheduledEventId)) return;
      await syncBufferEvents({ userId, scheduledEventId });
    }
  },

  [CONNECTION_PROBLEM_JOB]: async (payload: { userId?: unknown }) => {
    const userId = str(payload?.userId);
    if (!userId || !isUuid(userId)) return;
    return { result: await sendConnectionProblemEmail({ userId }) };
  },

  [REVOKE_JOB]: async (
    payload: { connectionId?: unknown; providerAccountId?: unknown; tokenEnc?: unknown; accessTokenEnc?: unknown; channels?: unknown },
    ctx,
  ) => {
    const access = await decryptOrNull(str(payload?.accessTokenEnc));
    const channels = Array.isArray(payload?.channels) ? (payload.channels as { channelId?: unknown; resourceId?: unknown }[]) : [];
    if (access) {
      for (const ch of channels) {
        const channelId = str(ch?.channelId);
        if (!channelId) continue;
        await stopGoogleChannel(
          { connectionId: str(payload.connectionId) ?? "", userId: "", provider: "google", accessToken: access, unavailableStatuses: [] },
          { channelId, resourceId: str(ch.resourceId) },
        ).catch(() => undefined);
      }
    }
    const token = await decryptOrNull(str(payload?.tokenEnc));
    if (!token) return;
    if (!getFeatures().googleOAuth) return { result: "google_oauth_not_configured" };
    // Revoking ends the whole grant of that Google account for this OAuth client: keep it while another live
    // connection (another account here, or a second user) still uses the same Google account.
    const accountId = str(payload?.providerAccountId);
    if (accountId) {
      const [other] = await ctx.db
        .select({ id: calendarConnections.id })
        .from(calendarConnections)
        .where(and(eq(calendarConnections.provider, "google"), eq(calendarConnections.providerAccountId, accountId), ne(calendarConnections.status, "disconnected")))
        .limit(1);
      if (other) return { result: "kept_shared_grant" };
    }
    try {
      await revokeGoogleToken(token);
    } catch (e) {
      // Best effort (CAL-16): an expired or already revoked token is fine.
      ctx.log.info("calendars.revoke_failed", { error: e });
    }
  },

  [CALENDAR_LIST_JOB]: async (payload: { connectionId?: unknown }) => {
    const connectionId = str(payload?.connectionId);
    if (!connectionId || !isUuid(connectionId)) return;
    try {
      return { result: await syncCalendarList(connectionId) };
    } catch (e) {
      if (isProviderAuthError(e)) return; // the connection status already says "Action required"
      if (isProviderTransientError(e)) throw new RetryLaterError(5 * 60_000, (e as Error).message);
      throw e;
    }
  },

  [REFRESH_CALENDAR_LISTS_JOB]: async (_payload: unknown, ctx) => {
    const rows = await ctx.db
      .select({ id: calendarConnections.id })
      .from(calendarConnections)
      .where(and(eq(calendarConnections.provider, "google"), eq(calendarConnections.status, "active")))
      .limit(500);
    const bucket = Math.floor(ctx.now.getTime() / (6 * 3_600_000));
    for (const r of rows) await enqueueJob(ctx.db, { type: CALENDAR_LIST_JOB, payload: { connectionId: r.id }, idempotencyKey: `callist:${r.id}:p${bucket}` });
    return { result: rows.length };
  },

  [WATCH_JOB]: async (payload: { connectionId?: unknown }) => {
    const connectionId = str(payload?.connectionId);
    if (!connectionId || !isUuid(connectionId)) return;
    try {
      return { result: await ensureWatchChannels(connectionId) };
    } catch (e) {
      if (isProviderAuthError(e)) return;
      throw e;
    }
  },

  [WATCH_RENEW_JOB]: async () => ({ result: await renewWatchChannels() }),
};

export const periodic: PeriodicJob[] = [
  { type: SYNC_BOOKED_EVENTS_JOB, everyMinutes: 10 },
  { type: REFRESH_CALENDAR_LISTS_JOB, everyMinutes: 360 },
  { type: WATCH_RENEW_JOB, everyMinutes: 360 },
];
