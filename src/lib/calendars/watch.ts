// OWNER: calendar-integrations.
//
// Google Calendar push notifications (ARCHITECTURE 10.3, optional P3; owner request: host-side moves and deletes show
// up quickly). Works on Vercel: Google POSTs to {APP_URL}/api/webhooks/calendars/google, which only needs a public
// https URL with a valid certificate (no domain verification). Local development, E2E runs and http URLs skip
// channels; the periodic sync job (every 10 minutes on each cron tick) covers them.
// - ensureWatchChannels(connectionId): one events.watch channel (7 day TTL) per calendar we care about (checked for
//   conflicts, or the destination, or holding upcoming booked events), renewed a day before it expires; channels of
//   calendars no longer needed are stopped. The channel token is random and stored hashed. Free/busy only calendars
//   (access.ts) get no channel (events.watch needs read access to events): their busy times rely on the cache TTL and
//   the booking-time recheck.
// - handleGooglePush: verifies the channel id and token, marks the calendar's busy cache stale and enqueues an
//   immediate CAL-14 sync of that calendar (coalesced while one is pending).
import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarConnections, calendarLinkedEvents, calendars, calendarWatchChannels, users } from "@/db/schema";
import { hashToken, randomToken, timingSafeEqualStr } from "@/lib/crypto";
import { isE2eMode } from "@/lib/env";
import { enqueueOrReviveJob } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { now, nowMs } from "@/lib/time/now";
import { absoluteUrl, appUrl } from "@/lib/url";
import { isBusyOnlyCalendar, readableCalendarCondition } from "./access";
import { invalidateCalendarCache } from "./busy";
import { withConnection } from "./credentials";
import { stopGoogleChannel, watchGoogleEvents } from "./providers/google";

export const WATCH_TTL_SECONDS = 7 * 24 * 60 * 60;
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;
export const GOOGLE_PUSH_PATH = "/api/webhooks/calendars/google";
export const SYNC_CALENDAR_JOB = "calendars.sync_calendar";

/** True when Google can reach this deployment (public https URL, not E2E). */
export function pushNotificationsAvailable(): boolean {
  if (isE2eMode()) return false;
  try {
    const u = new URL(appUrl());
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return !(host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":"));
  } catch {
    return false;
  }
}

/** Creates, renews and stops the push channels of one Google connection (see the file header). */
export async function ensureWatchChannels(connectionId: string): Promise<{ created: number; stopped: number }> {
  const result = { created: 0, stopped: 0 };
  if (!pushNotificationsAvailable()) return result;
  const db = await getDb();
  const [conn] = await db.select().from(calendarConnections).where(eq(calendarConnections.id, connectionId)).limit(1);
  if (!conn || conn.provider !== "google" || (conn.status !== "active" && conn.status !== "error")) return result;
  const cals = await db
    .select({ id: calendars.id, externalId: calendars.externalId, checkConflicts: calendars.checkConflicts, syncChanges: calendars.syncChanges, ctag: calendars.ctag })
    .from(calendars)
    .where(and(eq(calendars.connectionId, connectionId), isNull(calendars.deletedAt)));
  if (!cals.length) return result;
  const ids = cals.map((c) => c.id);
  const [u] = await db.select({ dest: users.destinationCalendarId }).from(users).where(eq(users.id, conn.userId)).limit(1);
  const withEvents = new Set(
    (
      await db
        .selectDistinct({ calendarId: calendarLinkedEvents.calendarId })
        .from(calendarLinkedEvents)
        .where(and(inArray(calendarLinkedEvents.calendarId, ids), eq(calendarLinkedEvents.status, "synced")))
    ).map((r) => r.calendarId),
  );
  const wanted = cals.filter((c) => !isBusyOnlyCalendar(c) && (c.checkConflicts || (c.syncChanges && (c.id === u?.dest || withEvents.has(c.id)))));
  const wantedIds = new Set(wanted.map((c) => c.id));
  const channels = await db.select().from(calendarWatchChannels).where(inArray(calendarWatchChannels.calendarId, ids));
  const renewAt = new Date(nowMs() + RENEW_BEFORE_MS);

  await withConnection(connectionId, async (ctx) => {
    for (const cal of wanted) {
      const current = channels.filter((ch) => ch.calendarId === cal.id);
      if (current.some((ch) => ch.expiresAt > renewAt)) continue;
      const token = randomToken(24);
      const channelId = randomUUID();
      const res = await watchGoogleEvents(ctx, cal.externalId, { channelId, address: absoluteUrl(GOOGLE_PUSH_PATH), token, ttlSeconds: WATCH_TTL_SECONDS });
      await db.insert(calendarWatchChannels).values({
        calendarId: cal.id,
        provider: "google",
        channelId: res.channelId,
        resourceId: res.resourceId,
        tokenHash: hashToken(token),
        expiresAt: res.expiresAt,
      });
      result.created++;
      // The new channel covers this calendar now; the old ones (about to expire) are stopped.
      for (const old of current) {
        await stopGoogleChannel(ctx, { channelId: old.channelId, resourceId: old.resourceId }).catch(() => undefined);
        await db.delete(calendarWatchChannels).where(eq(calendarWatchChannels.id, old.id));
        result.stopped++;
      }
    }
    for (const ch of channels.filter((c) => !wantedIds.has(c.calendarId))) {
      await stopGoogleChannel(ctx, { channelId: ch.channelId, resourceId: ch.resourceId }).catch(() => undefined);
      await db.delete(calendarWatchChannels).where(eq(calendarWatchChannels.id, ch.id));
      result.stopped++;
    }
  });
  return result;
}

/** Periodic renewal: connections with a channel expiring within a day, or none yet. */
export async function renewWatchChannels(limit = 25): Promise<number> {
  if (!pushNotificationsAvailable()) return 0;
  const db = await getDb();
  const soon = new Date(nowMs() + RENEW_BEFORE_MS);
  const expiring = await db
    .selectDistinct({ connectionId: calendars.connectionId })
    .from(calendarWatchChannels)
    .innerJoin(calendars, eq(calendars.id, calendarWatchChannels.calendarId))
    .where(lt(calendarWatchChannels.expiresAt, soon))
    .limit(limit);
  const unwatched = await db
    .selectDistinct({ connectionId: calendars.connectionId })
    .from(calendars)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendars.connectionId))
    .leftJoin(calendarWatchChannels, and(eq(calendarWatchChannels.calendarId, calendars.id), gt(calendarWatchChannels.expiresAt, soon)))
    .where(
      and(
        eq(calendarConnections.provider, "google"),
        or(eq(calendarConnections.status, "active"), eq(calendarConnections.status, "error")),
        isNull(calendars.deletedAt),
        eq(calendars.checkConflicts, true),
        readableCalendarCondition(),
        isNull(calendarWatchChannels.id),
      ),
    )
    .limit(limit);
  const ids = [...new Set([...expiring, ...unwatched].map((r) => r.connectionId))].slice(0, limit);
  let n = 0;
  for (const id of ids) {
    try {
      const r = await ensureWatchChannels(id);
      n += r.created;
    } catch (e) {
      log.warn("calendars.watch_renew_failed", { connectionId: id, error: e });
    }
  }
  return n;
}

export type PushOutcome = { status: number; jobId?: string | null };

/** POST /api/webhooks/calendars/google (see the file header). */
export async function handleGooglePush(headers: Headers): Promise<PushOutcome> {
  const channelId = headers.get("x-goog-channel-id");
  const token = headers.get("x-goog-channel-token") ?? "";
  const state = headers.get("x-goog-resource-state");
  if (!channelId || channelId.length > 200) return { status: 400 };
  const db = await getDb();
  const [ch] = await db
    .select({ id: calendarWatchChannels.id, calendarId: calendarWatchChannels.calendarId, tokenHash: calendarWatchChannels.tokenHash, expiresAt: calendarWatchChannels.expiresAt })
    .from(calendarWatchChannels)
    .where(eq(calendarWatchChannels.channelId, channelId))
    .limit(1);
  // Unknown or expired channel (calendar disconnected): acknowledge so Google stops retrying.
  if (!ch) return { status: 200 };
  if (!timingSafeEqualStr(hashToken(token), ch.tokenHash)) return { status: 403 };
  if (state === "sync") return { status: 200 }; // the handshake right after events.watch
  const [cal] = await db
    .select({ id: calendars.id })
    .from(calendars)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendars.connectionId))
    .where(and(eq(calendars.id, ch.calendarId), isNull(calendars.deletedAt), ne(calendarConnections.status, "disconnected")))
    .limit(1);
  if (!cal) return { status: 200 };
  await invalidateCalendarCache([cal.id], db);
  const jobId = await enqueueOrReviveJob(db, {
    type: SYNC_CALENDAR_JOB,
    payload: { calendarId: cal.id },
    idempotencyKey: `push:${cal.id}`,
    runAt: now(),
    maxAttempts: 3,
  });
  return { status: 200, jobId };
}
