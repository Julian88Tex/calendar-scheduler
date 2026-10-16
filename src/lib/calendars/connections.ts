// OWNER: calendar-integrations.
//
// Calendar connections and settings (SPEC CAL-01, CAL-02, CAL-06, CAL-07, CAL-08, CAL-13, CAL-14, CAL-16, CAL-17,
// CAL-22, GEN-08, GEN-17; docs/SCOPE.md: Google only).
// - connectGoogleAccount: creates or refreshes the connection of one Google account (idempotent per user, provider and
//   account under an advisory lock; a null refresh token keeps the stored one), syncs its calendar list, checks the
//   primary calendar on the first connect and makes it the destination when the user has none. Audited.
// - linkCalendarFromOAuth (sign-in, CAL-17): the same, except that an account the user explicitly disconnected stays
//   disconnected, Microsoft is ignored and grants without the calendar scopes create nothing.
// - syncCalendarList / applyCalendarList: calendarList -> calendars rows (new calendars unchecked, removed ones
//   soft-deleted and dropped as destinations). The same provider calendar under a second account of the same user is
//   listed once (CAL-06). Free/busy only calendars (Google freeBusyReader) are listed too, flagged through access.ts
//   (never writable); a calendar whose access changed between readable and free/busy only has its cache marked stale,
//   so the next busy read uses the right API.
// - disconnectConnection (CAL-16): marks the connection disconnected, deletes credentials, calendars and cached events
//   (the destination falls back to none), and revokes the Google token in a job (best effort). Audited.
// - setConflictCalendars, setDestinationCalendar, setCalendarSyncSettings: settings writes with ownership checks
//   inside the write transaction (GEN-08); selection changes invalidate the busy cache (CAL-07).
// - getDestinationCalendar: the event type override (CAL-20) or the user's destination when usable.
// - replaceImportedBusy (CAL-22): the read-only "Imported from Calendly" connection.
import "server-only";
import { and, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";
import { getDb, isUniqueViolation, type DbOrTx, type Tx } from "@/db";
import { advisoryXactLock } from "@/db/helpers";
import {
  calendarConnections,
  calendars,
  calendarSyncWindows,
  calendarWatchChannels,
  eventTypes,
  externalEvents,
  users,
} from "@/db/schema";
import { audit, type AuditActor } from "@/lib/audit";
import { assertCalendarOwnedBy, type ActorCtx } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { enqueueJob } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { now, nowMs } from "@/lib/time/now";
import { busyOnlyColumns, isBusyOnlyCalendar } from "./access";
import { invalidateCalendarCache, WINDOW_MS } from "./busy";
import { encryptedTokenColumns, withConnection } from "./credentials";
import { getProvider } from "./providers/registry";
import type { CalendarProviderId, RemoteCalendar } from "./providers/types";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
] as const;
/** CAL-01: soft hint above this many accounts. */
export const CALENDAR_ACCOUNT_SOFT_LIMIT = 6;
/** Hard cap on calendar accounts per user (our choice). */
export const CALENDAR_ACCOUNT_MAX = 20;

export const REVOKE_JOB = "calendars.revoke_token";
export const CALENDAR_LIST_JOB = "calendars.refresh_calendar_list";
export const WATCH_JOB = "calendars.watch_connection";

export type CalendarActor = Pick<ActorCtx, "user"> & Partial<Pick<ActorCtx, "orgId">>;

/** True when a grant carries the calendar scopes this module needs (Google lets users uncheck them on consent). */
export function hasGoogleCalendarScopes(scopes: readonly string[]): boolean {
  return GOOGLE_CALENDAR_SCOPES.every((s) => scopes.includes(s));
}

const accountLock = (userId: string, provider: string, accountId: string) => `calendar_account:${userId}:${provider}:${accountId}`;

// ---------------------------------------------------------------------------------------------------------------
// Calendar list

/** Writes a provider calendar list into calendars rows (see the file header). */
export async function applyCalendarList(
  tx: Tx,
  p: { connectionId: string; userId: string; provider: CalendarProviderId; remote: RemoteCalendar[]; initial: boolean },
): Promise<{ added: number; removed: number }> {
  // One writer per connection: a connect and the list refresh job (or a double submitted consent) never race on the
  // calendars_conn_ext_uq index.
  await advisoryXactLock(tx, `calendar_list:${p.connectionId}`);
  const t = now();
  const existing = await tx.select().from(calendars).where(eq(calendars.connectionId, p.connectionId));
  const byExt = new Map(existing.map((c) => [c.externalId, c]));
  // CAL-06: the same provider calendar already listed under another live connection of this user is not added again.
  const others = await tx
    .select({ externalId: calendars.externalId })
    .from(calendars)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendars.connectionId))
    .where(
      and(
        eq(calendars.userId, p.userId),
        eq(calendarConnections.provider, p.provider),
        ne(calendars.connectionId, p.connectionId),
        ne(calendarConnections.status, "disconnected"),
        isNull(calendars.deletedAt),
      ),
    );
  const elsewhere = new Set(others.map((o) => o.externalId));
  let added = 0;
  const seen = new Set<string>();
  const accessChanged: string[] = [];
  for (const r of p.remote) {
    if (seen.has(r.externalId)) continue;
    seen.add(r.externalId);
    const row = byExt.get(r.externalId);
    const fields = {
      name: r.name.slice(0, 300),
      color: r.color ?? null,
      timezone: r.timeZone ?? null,
      isPrimary: r.isPrimary,
      // A free/busy only calendar can never receive events.
      canWrite: r.canWrite && !r.busyOnly,
      allowedOnlineMeetingProviders: r.allowedOnlineMeetingProviders ?? [],
      ...busyOnlyColumns(p.provider, r.busyOnly),
      updatedAt: t,
    };
    if (row) {
      await tx
        .update(calendars)
        .set({ ...fields, deletedAt: null, ...(row.deletedAt ? { checkConflicts: false } : {}) })
        .where(eq(calendars.id, row.id));
      if (p.provider === "google" && isBusyOnlyCalendar(row) !== Boolean(r.busyOnly)) accessChanged.push(row.id);
      continue;
    }
    if (elsewhere.has(r.externalId)) continue;
    await tx.insert(calendars).values({
      connectionId: p.connectionId,
      userId: p.userId,
      externalId: r.externalId,
      ...fields,
      // CAL-07: on the first connect only the primary calendar checks for conflicts.
      checkConflicts: p.initial && r.isPrimary,
      includeBuffers: false,
      syncChanges: true,
    });
    added++;
  }
  // Cached windows were read with the other API (events.list vs FreeBusy): refetch them, keeping them as fallback.
  await invalidateCalendarCache(accessChanged, tx);
  const gone = existing.filter((c) => !c.deletedAt && !seen.has(c.externalId));
  if (gone.length) {
    const ids = gone.map((c) => c.id);
    await tx.update(calendars).set({ deletedAt: t, checkConflicts: false, updatedAt: t }).where(inArray(calendars.id, ids));
    await tx.update(users).set({ destinationCalendarId: null }).where(inArray(users.destinationCalendarId, ids));
    await tx.update(eventTypes).set({ destinationCalendarId: null }).where(inArray(eventTypes.destinationCalendarId, ids));
    await tx.delete(calendarSyncWindows).where(inArray(calendarSyncWindows.calendarId, ids));
    await tx.delete(externalEvents).where(inArray(externalEvents.calendarId, ids));
  }
  if (p.initial) {
    const live = await tx
      .select({ id: calendars.id, checked: calendars.checkConflicts })
      .from(calendars)
      .where(and(eq(calendars.connectionId, p.connectionId), isNull(calendars.deletedAt)))
      .orderBy(calendars.createdAt);
    if (live.length && !live.some((c) => c.checked)) {
      await tx.update(calendars).set({ checkConflicts: true }).where(eq(calendars.id, live[0]!.id));
    }
  }
  return { added, removed: gone.length };
}

/** Refreshes one connection's calendar list from the provider (job and connect flows). */
export async function syncCalendarList(connectionId: string): Promise<{ added: number; removed: number } | null> {
  const db = await getDb();
  const [conn] = await db.select().from(calendarConnections).where(eq(calendarConnections.id, connectionId)).limit(1);
  if (!conn || conn.status === "disconnected" || conn.status === "needs_reauth") return null;
  const impl = getProvider(conn.provider);
  if (!impl) return null;
  const remote = await withConnection(connectionId, (ctx) => impl.listCalendars(ctx));
  return db.transaction((tx) => applyCalendarList(tx, { connectionId, userId: conn.userId, provider: conn.provider, remote, initial: false }));
}

// ---------------------------------------------------------------------------------------------------------------
// Destination

/** True when the user's current destination is a live, writable calendar of a usable connection. */
async function hasUsableDestination(tx: DbOrTx, userId: string): Promise<boolean> {
  const [u] = await tx.select({ dest: users.destinationCalendarId }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u?.dest) return false;
  const [row] = await tx
    .select({ id: calendars.id })
    .from(calendars)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendars.connectionId))
    .where(
      and(
        eq(calendars.id, u.dest),
        eq(calendars.userId, userId),
        isNull(calendars.deletedAt),
        eq(calendars.canWrite, true),
        ne(calendarConnections.status, "disconnected"),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** users.preferences key: the user chose "None" as the calendar to add events to (CAL-08). */
export const DESTINATION_NONE_PREF = "calendarDestinationNone";

/** Records (or clears) an explicit "None" choice, merged into users.preferences so other preferences are kept. */
async function setDestinationNoneChoice(tx: DbOrTx, userId: string, chosen: boolean): Promise<void> {
  await tx
    .update(users)
    .set({
      preferences: chosen
        ? sql`coalesce(${users.preferences}, '{}'::jsonb) || ${JSON.stringify({ [DESTINATION_NONE_PREF]: true })}::jsonb`
        : sql`coalesce(${users.preferences}, '{}'::jsonb) - ${DESTINATION_NONE_PREF}::text`,
    })
    .where(eq(users.id, userId));
}

/**
 * CAL-08 and CAL-17: the primary writable calendar of the connection becomes the destination when there is none. A
 * routine sign-in (`respectNone`) leaves an explicit "None" choice alone.
 */
async function defaultDestination(tx: Tx, userId: string, connectionId: string, opts: { respectNone: boolean }): Promise<boolean> {
  if (await hasUsableDestination(tx, userId)) return false;
  if (opts.respectNone) {
    const [u] = await tx.select({ prefs: users.preferences }).from(users).where(eq(users.id, userId)).limit(1);
    if (u?.prefs?.[DESTINATION_NONE_PREF] === true) return false;
  }
  const rows = await tx
    .select({ id: calendars.id, isPrimary: calendars.isPrimary })
    .from(calendars)
    .where(and(eq(calendars.connectionId, connectionId), isNull(calendars.deletedAt), eq(calendars.canWrite, true)))
    .orderBy(calendars.createdAt);
  const pick = rows.find((r) => r.isPrimary) ?? rows[0];
  if (!pick) return false;
  await tx.update(users).set({ destinationCalendarId: pick.id }).where(eq(users.id, userId));
  await setDestinationNoneChoice(tx, userId, false);
  return true;
}

export type DestinationCalendar = {
  calendarId: string;
  connectionId: string;
  provider: CalendarProviderId;
  name: string;
  supports: { invitations: boolean; googleMeet: boolean; teams: boolean };
};

/** The calendar new meetings of this user (and event type) are written to, or null (email confirmations only). */
export async function getDestinationCalendar(userId: string, eventTypeId?: string): Promise<DestinationCalendar | null> {
  if (!isUuid(userId)) return null;
  const db = await getDb();
  const candidates: string[] = [];
  if (eventTypeId && isUuid(eventTypeId)) {
    const [et] = await db.select({ dest: eventTypes.destinationCalendarId }).from(eventTypes).where(eq(eventTypes.id, eventTypeId)).limit(1);
    if (et?.dest) candidates.push(et.dest);
  }
  const [u] = await db.select({ dest: users.destinationCalendarId }).from(users).where(eq(users.id, userId)).limit(1);
  if (u?.dest) candidates.push(u.dest);
  if (!candidates.length) return null;
  const rows = await db
    .select({
      id: calendars.id,
      name: calendars.name,
      userId: calendars.userId,
      canWrite: calendars.canWrite,
      deletedAt: calendars.deletedAt,
      allowed: calendars.allowedOnlineMeetingProviders,
      connectionId: calendarConnections.id,
      connectionUserId: calendarConnections.userId,
      provider: calendarConnections.provider,
      status: calendarConnections.status,
    })
    .from(calendars)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendars.connectionId))
    .where(inArray(calendars.id, candidates));
  for (const id of candidates) {
    const r = rows.find((x) => x.id === id);
    if (!r || r.deletedAt || !r.canWrite || r.userId !== userId || r.connectionUserId !== userId) continue;
    // A connection that needs a reconnect cannot write: meetings fall back to email confirmations (CAL-12).
    if (r.status === "disconnected" || r.status === "needs_reauth") continue;
    const impl = getProvider(r.provider);
    if (!impl?.capabilities.write) continue;
    return {
      calendarId: r.id,
      connectionId: r.connectionId,
      provider: r.provider,
      name: r.name,
      supports: {
        invitations: impl.capabilities.invitations,
        googleMeet: r.provider === "google" && (r.allowed.length === 0 || r.allowed.includes("hangoutsMeet")),
        teams: r.provider === "microsoft" && r.allowed.includes("teamsForBusiness"),
      },
    };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Connect

export type ConnectGoogleInput = {
  userId: string;
  providerAccountId: string;
  accountEmail: string;
  displayName?: string | null;
  oauthAccountId?: string | null;
  tokens: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null; scopes: string[] };
  via: "sign_in" | "connect";
  actor?: AuditActor | null;
  /** Calendars already known (E2E connect without a network call); default: calendarList from Google. */
  remoteCalendars?: RemoteCalendar[];
};

export type ConnectResult = { connectionId: string; created: boolean; reactivated: boolean; destinationSet: boolean; calendarsSynced: boolean };

/** Creates or refreshes a Google calendar connection (see the file header). */
export async function connectGoogleAccount(input: ConnectGoogleInput): Promise<ConnectResult> {
  const db = await getDb();
  const tokenCols = await encryptedTokenColumns(input.tokens);
  const t = now();
  const upsert = () =>
    db.transaction(async (tx) => {
      await advisoryXactLock(tx, accountLock(input.userId, "google", input.providerAccountId));
      const [existing] = await tx
        .select()
        .from(calendarConnections)
        .where(
          and(
            eq(calendarConnections.userId, input.userId),
            eq(calendarConnections.provider, "google"),
            eq(calendarConnections.providerAccountId, input.providerAccountId),
            ne(calendarConnections.status, "disconnected"),
          ),
        )
        .limit(1);
      if (existing) {
        await tx
          .update(calendarConnections)
          .set({
            ...tokenCols,
            accountEmail: input.accountEmail,
            displayName: input.displayName ?? existing.displayName ?? input.accountEmail,
            oauthAccountId: input.oauthAccountId ?? existing.oauthAccountId,
            status: "active",
            lastError: null,
            lastErrorAt: null,
            consecutiveFailures: 0,
            updatedAt: t,
          })
          .where(eq(calendarConnections.id, existing.id));
        return { id: existing.id, created: false, reactivated: existing.status !== "active" };
      }
      const live = await tx
        .select({ id: calendarConnections.id })
        .from(calendarConnections)
        .where(and(eq(calendarConnections.userId, input.userId), ne(calendarConnections.status, "disconnected")));
      if (live.length >= CALENDAR_ACCOUNT_MAX) {
        throw new AppError("conflict", `You can connect up to ${CALENDAR_ACCOUNT_MAX} calendar accounts. Disconnect one to add another.`);
      }
      const [row] = await tx
        .insert(calendarConnections)
        .values({
          userId: input.userId,
          provider: "google",
          providerAccountId: input.providerAccountId,
          accountEmail: input.accountEmail,
          displayName: input.displayName ?? input.accountEmail,
          oauthAccountId: input.oauthAccountId ?? null,
          ...tokenCols,
          status: "active",
        })
        .returning({ id: calendarConnections.id });
      return { id: row!.id, created: true, reactivated: false };
    });
  let conn: { id: string; created: boolean; reactivated: boolean };
  try {
    conn = await upsert();
  } catch (e) {
    // A concurrent first connect of the same account (partial unique index): the second one updates instead.
    if (!isUniqueViolation(e)) throw e;
    conn = await upsert();
  }

  let remote = input.remoteCalendars ?? null;
  let calendarsSynced = Boolean(remote);
  // A routine sign-in of an account that is already connected and healthy refreshes its list in the background
  // (no Google round trip on the login path); new, repaired and explicitly connected accounts list synchronously.
  const listNow = conn.created || conn.reactivated || input.via === "connect";
  if (!remote && listNow) {
    try {
      remote = await withConnection(conn.id, (ctx) => getProvider("google")!.listCalendars(ctx));
      calendarsSynced = true;
    } catch (e) {
      log.warn("calendars.connect_list_failed", { connectionId: conn.id, error: e });
    }
  }
  const destinationSet = await db.transaction(async (tx) => {
    if (remote) {
      await applyCalendarList(tx, { connectionId: conn.id, userId: input.userId, provider: "google", remote, initial: conn.created });
    } else if (conn.created) {
      // The list could not be read: Google's primary calendar id is the account email; the list job fills in the rest.
      await applyCalendarList(tx, {
        connectionId: conn.id,
        userId: input.userId,
        provider: "google",
        remote: [{ externalId: input.accountEmail, name: input.accountEmail, isPrimary: true, canWrite: true }],
        initial: true,
      });
    }
    if (!remote) {
      await enqueueJob(tx, { type: CALENDAR_LIST_JOB, payload: { connectionId: conn.id }, idempotencyKey: `callist:${conn.id}:${Math.floor(nowMs() / 60_000)}` });
    }
    const set = await defaultDestination(tx, input.userId, conn.id, { respectNone: input.via === "sign_in" });
    await enqueueJob(tx, { type: WATCH_JOB, payload: { connectionId: conn.id }, idempotencyKey: `watch:${conn.id}:${Math.floor(nowMs() / 3_600_000)}` });
    if (conn.created || conn.reactivated) {
      await audit(
        {
          action: conn.created ? "calendar.connected" : "calendar.reconnected",
          namespace: "calendars",
          targetType: "calendar_connection",
          targetId: conn.id,
          details: { provider: "google", email: input.accountEmail, via: input.via },
          actor: input.actor ?? { type: "user", userId: input.userId },
        },
        tx,
      );
    }
    return set;
  });
  // Cached windows of a reconnected account may predate the outage.
  if (conn.reactivated) {
    const ids = (await db.select({ id: calendars.id }).from(calendars).where(eq(calendars.connectionId, conn.id))).map((c) => c.id);
    await invalidateCalendarCache(ids, db);
  }
  return { connectionId: conn.id, created: conn.created, reactivated: conn.reactivated, destinationSet, calendarsSynced };
}

/** CAL-17: creates or refreshes the calendar connection of an OAuth sign-in (see the file header). */
export async function linkCalendarFromOAuth(p: {
  userId: string;
  provider: "google" | "microsoft";
  providerAccountId: string;
  accountEmail: string;
  oauthAccountId: string;
  tokens: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null; scopes: string[] };
}): Promise<void> {
  if (p.provider !== "google") return; // docs/SCOPE.md: Google Calendar only
  if (!hasGoogleCalendarScopes(p.tokens.scopes)) {
    log.info("calendars.sign_in_without_calendar_scopes", { userId: p.userId });
    return;
  }
  const db = await getDb();
  const rows = await db
    .select({ status: calendarConnections.status })
    .from(calendarConnections)
    .where(
      and(
        eq(calendarConnections.userId, p.userId),
        eq(calendarConnections.provider, "google"),
        eq(calendarConnections.providerAccountId, p.providerAccountId),
      ),
    );
  // The user disconnected this account on purpose: signing in again must not reconnect it (CAL-16, AU-10).
  if (rows.length && rows.every((r) => r.status === "disconnected")) return;
  await connectGoogleAccount({
    userId: p.userId,
    providerAccountId: p.providerAccountId,
    accountEmail: p.accountEmail,
    oauthAccountId: p.oauthAccountId,
    tokens: p.tokens,
    via: "sign_in",
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Disconnect

/** CAL-16 (see the file header). Returns whether the user's destination calendar was on this connection. */
export async function disconnectConnection(actor: CalendarActor, connectionId: string): Promise<{ destinationCleared: boolean; revokeJobId: string | null; email: string | null }> {
  if (!isUuid(connectionId)) throw new AppError("not_found", "This calendar connection no longer exists.");
  const db = await getDb();
  const t = now();
  return db.transaction(async (tx) => {
    const [conn] = await tx
      .select()
      .from(calendarConnections)
      .where(and(eq(calendarConnections.id, connectionId), eq(calendarConnections.userId, actor.user.id)))
      .for("update")
      .limit(1);
    if (!conn || conn.status === "disconnected") throw new AppError("not_found", "This calendar connection no longer exists.");
    const cals = await tx.select({ id: calendars.id }).from(calendars).where(eq(calendars.connectionId, conn.id));
    const calIds = cals.map((c) => c.id);
    const [u] = await tx.select({ dest: users.destinationCalendarId }).from(users).where(eq(users.id, actor.user.id)).limit(1);
    const destinationCleared = Boolean(u?.dest && calIds.includes(u.dest));
    const channels = calIds.length
      ? await tx
          .select({ channelId: calendarWatchChannels.channelId, resourceId: calendarWatchChannels.resourceId })
          .from(calendarWatchChannels)
          .where(inArray(calendarWatchChannels.calendarId, calIds))
      : [];
    const tokenEnc = conn.refreshTokenEnc ?? conn.accessTokenEnc;
    await tx
      .update(calendarConnections)
      .set({
        status: "disconnected",
        accessTokenEnc: null,
        refreshTokenEnc: null,
        tokenExpiresAt: null,
        caldavPasswordEnc: null,
        icsUrlEnc: null,
        lastError: null,
        consecutiveFailures: 0,
        updatedAt: t,
      })
      .where(eq(calendarConnections.id, conn.id));
    // Cascades: sync windows, cached events and watch channels; destinations (users, event types) fall back to none;
    // calendar_linked_events keep their provider ids for history with calendar_id set null.
    if (calIds.length) await tx.delete(calendars).where(inArray(calendars.id, calIds));
    let revokeJobId: string | null = null;
    if (conn.provider === "google" && (tokenEnc || channels.length)) {
      revokeJobId = await enqueueJob(tx, {
        type: REVOKE_JOB,
        payload: {
          connectionId: conn.id,
          providerAccountId: conn.providerAccountId,
          tokenEnc,
          accessTokenEnc: conn.accessTokenEnc,
          channels,
        },
        maxAttempts: 3,
      });
    }
    // A calendar listed only once across two accounts of the user (CAL-06) reappears under the other account.
    const siblings = await tx
      .select({ id: calendarConnections.id })
      .from(calendarConnections)
      .where(and(eq(calendarConnections.userId, actor.user.id), eq(calendarConnections.provider, conn.provider), notInArray(calendarConnections.status, ["disconnected", "needs_reauth"])));
    for (const s of siblings) {
      await enqueueJob(tx, { type: CALENDAR_LIST_JOB, payload: { connectionId: s.id }, idempotencyKey: `callist:${s.id}:${Math.floor(nowMs() / 60_000)}` });
    }
    await audit(
      {
        action: "calendar.disconnected",
        namespace: "calendars",
        targetType: "calendar_connection",
        targetId: conn.id,
        details: { provider: conn.provider, email: conn.accountEmail, destinationCleared },
        actor: "orgId" in actor && actor.orgId ? (actor as ActorCtx) : { type: "user", userId: actor.user.id },
      },
      tx,
    );
    return { destinationCleared, revokeJobId, email: conn.accountEmail ?? conn.displayName ?? null };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Settings writes

/** CAL-07: checks or unchecks calendars of the user's connections; changed calendars' cache is invalidated. */
export async function setConflictCalendars(actor: CalendarActor, changes: { calendarId: string; checked: boolean }[]): Promise<{ changed: number }> {
  if (!changes.length) return { changed: 0 };
  const ids = [...new Set(changes.map((c) => c.calendarId))];
  if (!ids.every(isUuid)) throw new AppError("forbidden", "You don't have access to one of the selected items.");
  const db = await getDb();
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: calendars.id, userId: calendars.userId, deletedAt: calendars.deletedAt, checked: calendars.checkConflicts, status: calendarConnections.status, connUser: calendarConnections.userId })
      .from(calendars)
      .innerJoin(calendarConnections, eq(calendarConnections.id, calendars.connectionId))
      .where(inArray(calendars.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const r = byId.get(id);
      if (!r || r.deletedAt || r.userId !== actor.user.id || r.connUser !== actor.user.id || r.status === "disconnected") {
        throw new AppError("forbidden", "You don't have access to one of the selected items.");
      }
    }
    const changed: string[] = [];
    for (const c of changes) {
      if (byId.get(c.calendarId)?.checked === c.checked) continue;
      await tx.update(calendars).set({ checkConflicts: c.checked, updatedAt: now() }).where(eq(calendars.id, c.calendarId));
      changed.push(c.calendarId);
    }
    await invalidateCalendarCache(changed, tx);
    if (changed.length) {
      const conns = await tx.select({ connectionId: calendars.connectionId }).from(calendars).where(inArray(calendars.id, changed));
      for (const connectionId of new Set(conns.map((c) => c.connectionId))) {
        await enqueueJob(tx, { type: WATCH_JOB, payload: { connectionId }, idempotencyKey: `watch:${connectionId}:${Math.floor(nowMs() / 60_000)}` });
      }
    }
    return { changed: changed.length };
  });
}

/** CAL-08: the single destination calendar, or null for none. Another user's calendar answers forbidden (403). */
export async function setDestinationCalendar(actor: CalendarActor, calendarId: string | null): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    if (calendarId) await assertCalendarOwnedBy(tx, calendarId, actor.user.id, { purpose: "destination" });
    await tx.update(users).set({ destinationCalendarId: calendarId }).where(eq(users.id, actor.user.id));
    // "None" is a choice to keep: a later Google sign-in must not pick a calendar again (CAL-08, CAL-17).
    await setDestinationNoneChoice(tx, actor.user.id, calendarId === null);
    if (calendarId) {
      const [c] = await tx.select({ connectionId: calendars.connectionId }).from(calendars).where(eq(calendars.id, calendarId)).limit(1);
      if (c) await enqueueJob(tx, { type: WATCH_JOB, payload: { connectionId: c.connectionId }, idempotencyKey: `watch:${c.connectionId}:${Math.floor(nowMs() / 60_000)}` });
    }
  });
}

/** CAL-13 and CAL-14 checkboxes of one calendar. */
export async function setCalendarSyncSettings(actor: CalendarActor, p: { calendarId: string; includeBuffers?: boolean; syncChanges?: boolean }): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await assertCalendarOwnedBy(tx, p.calendarId, actor.user.id, { purpose: "read" });
    const set: Partial<typeof calendars.$inferInsert> = { updatedAt: now() };
    if (p.includeBuffers !== undefined) set.includeBuffers = p.includeBuffers;
    if (p.syncChanges !== undefined) set.syncChanges = p.syncChanges;
    await tx.update(calendars).set(set).where(eq(calendars.id, p.calendarId));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// CAL-22 imported busy blocks

const IMPORT_ACCOUNT_ID = "calendly-import";
const IMPORT_CALENDAR_ID = "calendly-import";

/** CAL-22 (see the file header). */
export async function replaceImportedBusy(p: {
  userId: string;
  source: "calendly";
  events: { externalId: string; start: Date; end: Date; title: string | null }[];
}): Promise<{ connectionId: string }> {
  if (!isUuid(p.userId)) throw new AppError("validation", "Invalid user.");
  const db = await getDb();
  const t = now();
  return db.transaction(async (tx) => {
    await advisoryXactLock(tx, accountLock(p.userId, "calendly_import", IMPORT_ACCOUNT_ID));
    let [conn] = await tx
      .select({ id: calendarConnections.id })
      .from(calendarConnections)
      .where(
        and(
          eq(calendarConnections.userId, p.userId),
          eq(calendarConnections.provider, "calendly_import"),
          eq(calendarConnections.providerAccountId, IMPORT_ACCOUNT_ID),
          ne(calendarConnections.status, "disconnected"),
        ),
      )
      .limit(1);
    conn ??= (
      await tx
        .insert(calendarConnections)
        .values({ userId: p.userId, provider: "calendly_import", providerAccountId: IMPORT_ACCOUNT_ID, displayName: "Imported from Calendly", status: "active", lastSyncedAt: t })
        .returning({ id: calendarConnections.id })
    )[0]!;
    let [cal] = await tx.select({ id: calendars.id }).from(calendars).where(and(eq(calendars.connectionId, conn.id), eq(calendars.externalId, IMPORT_CALENDAR_ID))).limit(1);
    cal ??= (
      await tx
        .insert(calendars)
        .values({ connectionId: conn.id, userId: p.userId, externalId: IMPORT_CALENDAR_ID, name: "Imported from Calendly", isPrimary: true, canWrite: false, checkConflicts: true, syncChanges: false })
        .returning({ id: calendars.id })
    )[0]!;
    await tx.update(calendars).set({ checkConflicts: true, deletedAt: null }).where(eq(calendars.id, cal.id));
    await tx.delete(externalEvents).where(eq(externalEvents.calendarId, cal.id));
    const seen = new Set<string>();
    const rows = p.events
      .filter((e) => e.end > e.start && !Number.isNaN(e.start.getTime()))
      .filter((e) => {
        const key = `${e.externalId}|${e.start.getTime()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((e) => ({
        calendarId: cal!.id,
        userId: p.userId,
        externalId: e.externalId.slice(0, 500),
        startAt: e.start,
        endAt: e.end,
        allDay: false,
        title: e.title?.slice(0, 500) ?? null,
        busy: true,
        isOwn: false,
        fetchedAt: t,
      }));
    for (let i = 0; i < rows.length; i += 400) await tx.insert(externalEvents).values(rows.slice(i, i + 400));
    // Cache only: one wide window marked fresh (the busy cache never refetches this provider).
    await tx.delete(calendarSyncWindows).where(eq(calendarSyncWindows.calendarId, cal.id));
    const first = Math.floor((t.getTime() - 365 * 86_400_000) / WINDOW_MS) * WINDOW_MS;
    await tx.insert(calendarSyncWindows).values({ calendarId: cal.id, windowStart: new Date(first), windowEnd: new Date(first + WINDOW_MS), fetchedAt: t, status: "ok" });
    await tx.update(calendarConnections).set({ lastSyncedAt: t }).where(eq(calendarConnections.id, conn.id));
    return { connectionId: conn.id };
  });
}

/** Ownership of a connection (settings actions). */
export async function assertConnectionOwnedBy(db: DbOrTx, connectionId: string, userId: string): Promise<typeof calendarConnections.$inferSelect> {
  if (!isUuid(connectionId)) throw new AppError("not_found", "This calendar connection no longer exists.");
  const [conn] = await db
    .select()
    .from(calendarConnections)
    .where(and(eq(calendarConnections.id, connectionId), eq(calendarConnections.userId, userId), ne(calendarConnections.status, "disconnected")))
    .limit(1);
  if (!conn) throw new AppError("not_found", "This calendar connection no longer exists.");
  return conn;
}
