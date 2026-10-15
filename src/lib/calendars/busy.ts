// OWNER: calendar-integrations.
//
// Busy cache (ARCHITECTURE section 10.3, SPEC CAL-06, CAL-07, CAL-10, CAL-18, SCH-11, SCH-12).
//
// - external_events caches expanded provider events per calendar for fetched windows (calendar_sync_windows): windows
//   are 31-day chunks aligned to UTC days (bucket = floor(epochDay / 31)). A window is fresh when fetched within
//   maxAgeSeconds (booking pages 180 s, CALENDAR_CACHE_TTL_SECONDS; submission rechecks 60 s).
// - Stale or missing windows are fetched per connection in parallel, inside the caller's timeout (default 4 s), and
//   replaced atomically (delete the window's rows, insert the new ones, one transaction under a per-calendar advisory
//   lock). On a timeout or a failure the last cached data is used (stale), and a host whose checked calendars have no
//   data younger than 24 hours gets NOCAL (unavailable, SCH-11).
// - Single flight: a request claims a window with a 15 second lease (UPDATE ... WHERE lease is free AND the window is
//   still stale RETURNING) before calling the provider; only the holder fetches. Others use the cached rows, or wait
//   for the holder (polling every 200 ms, until their timeout) when they have no data at all or need submit
//   freshness.
// - CAL-18: rows matching our own provider events (stored provider id, kairosLinkedEventId / kairosEventId private
//   properties, iCal UID) are flagged is_own and never returned as busy; the read also anti-joins
//   calendar_linked_events by provider id, covering events written after the window was fetched.
// - calendly_import calendars (CAL-22, and the E2E fake calendar) are cache only: always fresh, never fetched.
// - Free/busy only calendars (Google freeBusyReader, access.ts) go through the same windows, leases, TTLs and
//   submission rechecks, but are read with the provider's listBusy (Google FreeBusy, one batched request per window
//   for all of a connection's free/busy only calendars) in parallel with listEvents for the readable ones; a failure of
//   one call never discards what the other returned. A FreeBusy failure other than a credential one is the failing
//   calendar's own (logged, its windows left unrefreshed and retried by the next read, the other calendars stored, the
//   connection's health untouched). Their intervals have no title, so the busy result names them "Busy ({calendar
//   name})" (troubleshoot and the owner's views; callers strip titles for anyone else, GEN-08) and flags them busyOnly:
//   that name is ours, so free/busy rules (SCH-13) never ignore them.
import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { advisoryXactLock } from "@/db/helpers";
import { calendarConnections, calendarLinkedEvents, calendars, calendarSyncWindows, externalEvents, users } from "@/db/schema";
import { calendarCacheTtlSeconds } from "@/lib/env";
import { isUuid } from "@/lib/ids";
import { enqueueJob } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { expandAllDay } from "@/lib/slots";
import { now, nowMs } from "@/lib/time/now";
import { isBusyOnlyCalendar } from "./access";
import { withConnection } from "./credentials";
import { recordConnectionFailure, markConnectionHealthy } from "./health";
import { getProvider, isCacheOnlyProvider } from "./providers/registry";
import { isProviderAuthError, isProviderPartialError, type CalendarProviderId, type RemoteEvent } from "./providers/types";

export const WINDOW_DAYS = 31;
const DAY_MS = 86_400_000;
export const WINDOW_MS = WINDOW_DAYS * DAY_MS;
/** Single-flight lease (ARCHITECTURE 10.3). */
export const FETCH_LEASE_MS = 15_000;
/** SCH-11: cached data younger than this keeps a broken connection usable. */
export const STALE_FALLBACK_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_BUSY_TIMEOUT_MS = 4_000;
/** maxAgeSeconds at or below this is a submission recheck (SCH-20): wait for a concurrent fetch instead of using stale data. */
const SUBMIT_MAX_AGE_SECONDS = 60;
const POLL_MS = 200;
/** Never fetch more than this many windows per call (about 16 months). */
const MAX_WINDOWS = 16;
const CALENDAR_LIST_REFRESH_JOB = "calendars.refresh_calendar_list";
const EPOCH = new Date(0);

export type ExternalBusy = {
  start: Date;
  end: Date;
  allDay: boolean;
  allDayStartDate?: string;
  allDayEndDate?: string;
  title: string | null;
  calendarId: string;
  externalId: string;
  /**
   * Additive: an untitled interval of a free/busy only calendar. `title` is then our "Busy ({calendar name})" label,
   * never an event title, so free/busy rules (SCH-13) must never ignore it.
   */
  busyOnly?: boolean;
};

export type ExternalBusyByUser = Record<string, { ok: boolean; stale: boolean; nocal: boolean; busy: ExternalBusy[] }>;

export type ExternalEventListItem = {
  id: string;
  calendarName: string;
  color: string | null;
  title: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  busy: boolean;
  /** Additive: the calendar dates of an all-day event (start and end exclusive). */
  allDayStartDate?: string;
  allDayEndDate?: string;
  /** Additive: the provider's event type ("outOfOffice", "focusTime") or busy/free. */
  showAs?: string | null;
};

// ---------------------------------------------------------------------------------------------------------------
// Windows

/** Window start instants (ms) covering [start, end] padded by one day (all-day events are anchored to UTC dates). */
export function windowStartsFor(start: Date, end: Date): number[] {
  const first = Math.floor((start.getTime() - DAY_MS) / WINDOW_MS);
  const last = Math.floor((Math.max(end.getTime(), start.getTime()) + DAY_MS - 1) / WINDOW_MS);
  const out: number[] = [];
  for (let b = first; b <= last && out.length < MAX_WINDOWS; b++) out.push(b * WINDOW_MS);
  return out;
}

type CheckedCalendar = {
  calendarId: string;
  userId: string;
  externalId: string;
  name: string;
  connectionId: string;
  provider: CalendarProviderId;
  connectionStatus: string;
  /** Free/busy only (access.ts): read with listBusy, untitled. */
  busyOnly: boolean;
};

/** The title of an untitled busy interval of a free/busy only calendar (troubleshoot: "Busy (Work)"). */
function busyOnlyTitle(calendarName: string): string {
  return `Busy (${calendarName})`;
}

type WindowRow = typeof calendarSyncWindows.$inferSelect;

async function loadCheckedCalendars(db: DbOrTx, userIds: string[]): Promise<CheckedCalendar[]> {
  const rows = await db
    .select({
      calendarId: calendars.id,
      userId: calendars.userId,
      externalId: calendars.externalId,
      name: calendars.name,
      ctag: calendars.ctag,
      connectionId: calendars.connectionId,
      provider: calendarConnections.provider,
      connectionStatus: calendarConnections.status,
    })
    .from(calendars)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendars.connectionId))
    .where(
      and(
        inArray(calendars.userId, userIds),
        eq(calendars.checkConflicts, true),
        isNull(calendars.deletedAt),
        ne(calendarConnections.status, "disconnected"),
        eq(calendarConnections.userId, calendars.userId),
      ),
    );
  return rows.map(({ ctag, ...r }) => ({ ...r, busyOnly: isBusyOnlyCalendar({ ctag }) }));
}

async function loadWindows(db: DbOrTx, calendarIds: string[], starts: number[]): Promise<Map<string, WindowRow>> {
  const map = new Map<string, WindowRow>();
  if (!calendarIds.length || !starts.length) return map;
  const rows = await db
    .select()
    .from(calendarSyncWindows)
    .where(
      and(
        inArray(calendarSyncWindows.calendarId, calendarIds),
        inArray(
          calendarSyncWindows.windowStart,
          starts.map((s) => new Date(s)),
        ),
        inArray(
          calendarSyncWindows.windowEnd,
          starts.map((s) => new Date(s + WINDOW_MS)),
        ),
      ),
    );
  for (const r of rows) map.set(`${r.calendarId}:${r.windowStart.getTime()}`, r);
  return map;
}

const hasData = (w: WindowRow | undefined): w is WindowRow => Boolean(w && w.fetchedAt.getTime() > 0 && w.status === "ok");

// ---------------------------------------------------------------------------------------------------------------
// Own events (CAL-18)

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/** Which fetched events this app created (matched by provider id, private properties or iCal UID). */
async function ownMatcher(db: DbOrTx, userId: string, events: RemoteEvent[]): Promise<(e: RemoteEvent) => boolean> {
  if (!events.length) return () => false;
  const extIds = [...new Set(events.map((e) => e.externalId))];
  const linkIds = [...new Set(events.map((e) => e.extendedPrivate?.kairosLinkedEventId).filter(isUuid))];
  const entityIds = [...new Set(events.map((e) => e.extendedPrivate?.kairosEventId).filter(isUuid))];
  const icals = [...new Set(events.map((e) => e.icalUid).filter((v): v is string => Boolean(v)))];
  const ownExt = new Set<string>();
  const ownLinks = new Set<string>();
  const ownEntities = new Set<string>();
  const ownIcals = new Set<string>();
  const select = (cond: ReturnType<typeof or>) =>
    db
      .select({
        id: calendarLinkedEvents.id,
        externalId: calendarLinkedEvents.externalId,
        icalUid: calendarLinkedEvents.icalUid,
        scheduledEventId: calendarLinkedEvents.scheduledEventId,
        pollId: calendarLinkedEvents.pollId,
        oneOffMeetingId: calendarLinkedEvents.oneOffMeetingId,
      })
      .from(calendarLinkedEvents)
      .where(and(eq(calendarLinkedEvents.userId, userId), cond));
  const collect = (rows: Awaited<ReturnType<typeof select>>) => {
    for (const r of rows) {
      // Provider ids are shared by every copy of an event, so a copy on another calendar of the user is ours too.
      if (r.externalId) ownExt.add(r.externalId);
      ownLinks.add(r.id);
      if (r.icalUid) ownIcals.add(r.icalUid);
      for (const id of [r.scheduledEventId, r.pollId, r.oneOffMeetingId]) if (id) ownEntities.add(id);
    }
  };
  for (const part of chunk(extIds, 1000)) collect(await select(or(inArray(calendarLinkedEvents.externalId, part))));
  if (linkIds.length) for (const part of chunk(linkIds, 1000)) collect(await select(or(inArray(calendarLinkedEvents.id, part))));
  if (icals.length) for (const part of chunk(icals, 1000)) collect(await select(or(inArray(calendarLinkedEvents.icalUid, part))));
  if (entityIds.length) {
    for (const part of chunk(entityIds, 1000)) {
      collect(
        await select(
          or(inArray(calendarLinkedEvents.scheduledEventId, part), inArray(calendarLinkedEvents.pollId, part), inArray(calendarLinkedEvents.oneOffMeetingId, part)),
        ),
      );
    }
  }
  return (e) =>
    ownExt.has(e.externalId) ||
    (isUuid(e.extendedPrivate?.kairosLinkedEventId) && ownLinks.has(e.extendedPrivate.kairosLinkedEventId)) ||
    (isUuid(e.extendedPrivate?.kairosEventId) && ownEntities.has(e.extendedPrivate.kairosEventId)) ||
    Boolean(e.icalUid && ownIcals.has(e.icalUid));
}

// ---------------------------------------------------------------------------------------------------------------
// Replacing a window

const clip = (s: string | null, n: number) => (s && s.length > n ? s.slice(0, n) : s);

/** Replaces the cached events of one calendar window with a fresh provider result (one transaction). */
export async function replaceWindowEvents(
  db: DbOrTx,
  p: { calendarId: string; userId: string; windowStart: number; events: RemoteEvent[]; fetchedAt: Date; holder?: string | null },
): Promise<void> {
  const ws = new Date(p.windowStart);
  const we = new Date(p.windowStart + WINDOW_MS);
  await db.transaction(async (tx) => {
    await advisoryXactLock(tx, `calendar_cache:${p.calendarId}`);
    const isOwn = await ownMatcher(tx, p.userId, p.events);
    await tx
      .delete(externalEvents)
      .where(and(eq(externalEvents.calendarId, p.calendarId), lt(externalEvents.startAt, we), gt(externalEvents.endAt, ws)));
    const unique = new Map<string, RemoteEvent>();
    for (const e of p.events) unique.set(`${e.externalId}|${e.start.getTime()}`, e);
    const rows = [...unique.values()].map((e) => ({
      calendarId: p.calendarId,
      userId: p.userId,
      externalId: e.externalId,
      icalUid: e.icalUid ?? null,
      recurringEventId: e.recurringEventId ?? null,
      startAt: e.start,
      endAt: e.end,
      allDay: e.allDay,
      allDayStartDate: e.allDay ? (e.allDayStartDate ?? e.start.toISOString().slice(0, 10)) : null,
      allDayEndDate: e.allDay ? (e.allDayEndDate ?? e.end.toISOString().slice(0, 10)) : null,
      title: clip(e.title, 500),
      busy: e.busy,
      showAs: e.showAs ?? null,
      status: e.status ?? null,
      isOwn: isOwn(e),
      remoteUpdatedAt: e.updatedAt ?? null,
      fetchedAt: p.fetchedAt,
    }));
    for (const part of chunk(rows, 400)) {
      await tx
        .insert(externalEvents)
        .values(part)
        .onConflictDoUpdate({
          target: [externalEvents.calendarId, externalEvents.externalId, externalEvents.startAt],
          set: {
            endAt: sql`excluded.end_at`,
            icalUid: sql`excluded.ical_uid`,
            recurringEventId: sql`excluded.recurring_event_id`,
            allDay: sql`excluded.all_day`,
            allDayStartDate: sql`excluded.all_day_start_date`,
            allDayEndDate: sql`excluded.all_day_end_date`,
            title: sql`excluded.title`,
            busy: sql`excluded.busy`,
            showAs: sql`excluded.show_as`,
            status: sql`excluded.status`,
            isOwn: sql`excluded.is_own`,
            remoteUpdatedAt: sql`excluded.remote_updated_at`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    }
    await tx
      .insert(calendarSyncWindows)
      .values({ calendarId: p.calendarId, windowStart: ws, windowEnd: we, fetchedAt: p.fetchedAt, status: "ok" })
      .onConflictDoUpdate({
        target: [calendarSyncWindows.calendarId, calendarSyncWindows.windowStart, calendarSyncWindows.windowEnd],
        set: { fetchedAt: p.fetchedAt, status: "ok", error: null, fetchLeaseUntil: null, fetchLeaseHolder: null },
      });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Fetching (lease holder only)

type FetchItem = { cal: CheckedCalendar; ws: number };

async function ensurePlaceholders(db: DbOrTx, items: FetchItem[]): Promise<void> {
  if (!items.length) return;
  await db
    .insert(calendarSyncWindows)
    .values(items.map((i) => ({ calendarId: i.cal.calendarId, windowStart: new Date(i.ws), windowEnd: new Date(i.ws + WINDOW_MS), fetchedAt: EPOCH, status: "pending" })))
    .onConflictDoNothing();
}

/** Claims the stale windows of `items` for `holder`; returns the claimed ones. */
async function claimWindows(db: DbOrTx, items: FetchItem[], holder: string, freshCutoff: Date): Promise<FetchItem[]> {
  const t = now();
  const leaseUntil = new Date(t.getTime() + FETCH_LEASE_MS);
  const byWindow = new Map<number, FetchItem[]>();
  for (const i of items) byWindow.set(i.ws, [...(byWindow.get(i.ws) ?? []), i]);
  const claimed: FetchItem[] = [];
  for (const [ws, group] of byWindow) {
    const rows = await db
      .update(calendarSyncWindows)
      .set({ fetchLeaseUntil: leaseUntil, fetchLeaseHolder: holder })
      .where(
        and(
          inArray(
            calendarSyncWindows.calendarId,
            group.map((g) => g.cal.calendarId),
          ),
          eq(calendarSyncWindows.windowStart, new Date(ws)),
          eq(calendarSyncWindows.windowEnd, new Date(ws + WINDOW_MS)),
          or(isNull(calendarSyncWindows.fetchLeaseUntil), lt(calendarSyncWindows.fetchLeaseUntil, t)),
          or(lt(calendarSyncWindows.fetchedAt, freshCutoff), ne(calendarSyncWindows.status, "ok")),
        ),
      )
      .returning({ calendarId: calendarSyncWindows.calendarId });
    const ids = new Set(rows.map((r) => r.calendarId));
    claimed.push(...group.filter((g) => ids.has(g.cal.calendarId)));
  }
  return claimed;
}

async function releaseWindows(db: DbOrTx, items: FetchItem[], holder: string, error: string): Promise<void> {
  for (const i of items) {
    await db
      .update(calendarSyncWindows)
      .set({ fetchLeaseUntil: null, fetchLeaseHolder: null, error: error.slice(0, 500) })
      .where(
        and(
          eq(calendarSyncWindows.calendarId, i.cal.calendarId),
          eq(calendarSyncWindows.windowStart, new Date(i.ws)),
          eq(calendarSyncWindows.windowEnd, new Date(i.ws + WINDOW_MS)),
          eq(calendarSyncWindows.fetchLeaseHolder, holder),
        ),
      );
  }
}

/** Fetches the claimed windows of one connection and stores them. Never throws. */
async function refreshConnection(connectionId: string, provider: CalendarProviderId, items: FetchItem[], freshCutoff: Date): Promise<void> {
  const impl = getProvider(provider);
  if (!impl || !items.length) return;
  const db = await getDb();
  const holder = randomUUID();
  let claimed: FetchItem[] = [];
  try {
    await ensurePlaceholders(db, items);
    claimed = await claimWindows(db, items, holder, freshCutoff);
    if (!claimed.length) return;
    const fetchedAt = now();
    const byWindow = new Map<number, FetchItem[]>();
    for (const i of claimed) byWindow.set(i.ws, [...(byWindow.get(i.ws) ?? []), i]);
    let gone = false;
    /** Free/busy only calendars FreeBusy could not read: their windows stay unrefreshed (released below). */
    let busyOnlyFailed: { item: FetchItem; error: string }[] = [];
    await withConnection(connectionId, async (ctx) => {
      // withConnection runs this again after a 401 and a token refresh: start clean, so an error of the first attempt
      // is never rethrown after a successful retry (that would mark a healthy connection needs_reauth).
      gone = false;
      busyOnlyFailed = [];
      const failures: unknown[] = [];
      await Promise.all(
        [...byWindow].map(async ([ws, group]) => {
          const range = { start: new Date(ws), end: new Date(ws + WINDOW_MS) };
          // Readable calendars through events.list, free/busy only ones through FreeBusy (batched by the provider).
          const parts = [group.filter((g) => !g.cal.busyOnly), group.filter((g) => g.cal.busyOnly)].filter((part) => part.length);
          const results = await Promise.allSettled(
            parts.map((part) => {
              const ids = part.map((g) => g.cal.externalId);
              return part[0]!.cal.busyOnly && impl.listBusy ? impl.listBusy(ctx, ids, range) : impl.listEvents(ctx, ids, range);
            }),
          );
          for (const [i, part] of parts.entries()) {
            const settled = results[i]!;
            let answer: Record<string, RemoteEvent[]>;
            let unread = new Set<string>();
            if (settled.status === "fulfilled") {
              answer = settled.value;
            } else if (part[0]!.cal.busyOnly && impl.listBusy && !isProviderAuthError(settled.reason)) {
              // A FreeBusy failure (internalError, backendError, a 5xx) is the failing calendars' own: logged, their
              // windows left unrefreshed (the stale fallback or NOCAL applies, the next read retries), never counted
              // against the connection, and the other calendars are still stored.
              const partial = isProviderPartialError(settled.reason) ? settled.reason : null;
              answer = partial?.results ?? {};
              unread = new Set(partial?.failedIds ?? part.map((g) => g.cal.externalId));
              const error = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
              const failing = part.filter((g) => unread.has(g.cal.externalId));
              busyOnlyFailed.push(...failing.map((item) => ({ item, error })));
              log.warn("calendars.busy_freebusy_failed", { connectionId, calendarIds: [...new Set(failing.map((g) => g.cal.calendarId))], error: settled.reason });
            } else {
              // Leave these windows to the stale fallback; the other part is still stored.
              failures.push(settled.reason);
              continue;
            }
            for (const g of part) {
              if (unread.has(g.cal.externalId)) continue;
              const events = answer[g.cal.externalId];
              if (!events) {
                // Calendar deleted or unshared: it has no events for us (the list refresh below drops it).
                gone = true;
                log.warn("calendars.busy_calendar_unreadable", { connectionId, calendarId: g.cal.calendarId, busyOnly: g.cal.busyOnly });
              }
              await replaceWindowEvents(db, { calendarId: g.cal.calendarId, userId: g.cal.userId, windowStart: ws, events: events ?? [], fetchedAt });
            }
          }
        }),
      );
      // A credential failure wins over a transient one, so withConnection still refreshes the token or flags the
      // connection.
      if (failures.length) throw failures.find(isProviderAuthError) ?? failures[0] ?? new Error("Calendar busy fetch failed");
    });
    for (const f of busyOnlyFailed) await releaseWindows(db, [f.item], holder, f.error).catch(() => undefined);
    // Only failing free/busy only calendars: nothing was read, so the connection's health is left as it is.
    if (busyOnlyFailed.length < claimed.length) await markConnectionHealthy(connectionId, db);
    if (gone) {
      await enqueueJob(db, {
        type: CALENDAR_LIST_REFRESH_JOB,
        payload: { connectionId },
        idempotencyKey: `callist:${connectionId}:${Math.floor(nowMs() / (15 * 60_000))}`,
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.warn("calendars.busy_fetch_failed", { connectionId, error: e });
    await releaseWindows(db, claimed, holder, message).catch(() => undefined);
    // Credential failures already updated the connection status (withConnection); count the rest.
    if (!isProviderAuthError(e)) await recordConnectionFailure(connectionId, message).catch(() => undefined);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function raceTimeout<T>(p: Promise<T>, ms: number): Promise<"timeout" | T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve("timeout"), Math.max(0, ms));
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve("timeout");
      },
    );
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Public: busy and events

/**
 * External busy intervals per user (ARCHITECTURE 10.2). User ids must already be authorized by the caller; titles
 * are included (callers strip them for anyone but the calendar owner, GEN-08).
 */
export async function getExternalBusy(p: {
  userIds: string[];
  start: Date;
  end: Date;
  maxAgeSeconds?: number;
  timeoutMs?: number;
}): Promise<ExternalBusyByUser> {
  const userIds = [...new Set(p.userIds.filter(isUuid))];
  const out: ExternalBusyByUser = {};
  for (const id of p.userIds) out[id] = { ok: true, stale: false, nocal: false, busy: [] };
  if (!userIds.length) return out;
  const maxAgeSeconds = p.maxAgeSeconds ?? calendarCacheTtlSeconds();
  const timeoutMs = p.timeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  const submit = maxAgeSeconds <= SUBMIT_MAX_AGE_SECONDS;
  const startedAt = nowMs();
  const deadline = startedAt + timeoutMs;
  const freshCutoff = new Date(startedAt - maxAgeSeconds * 1000);

  const db = await getDb();
  const cals = await loadCheckedCalendars(db, userIds);
  if (!cals.length) return out;
  const starts = windowStartsFor(p.start, p.end);
  let windows = await loadWindows(db, cals.map((c) => c.calendarId), starts);

  const fetchable = (c: CheckedCalendar) => !isCacheOnlyProvider(c.provider) && c.connectionStatus !== "needs_reauth" && getProvider(c.provider) !== null;
  const isFresh = (c: CheckedCalendar, ws: number) => {
    if (isCacheOnlyProvider(c.provider)) return true;
    const w = windows.get(`${c.calendarId}:${ws}`);
    return hasData(w) && w.fetchedAt >= freshCutoff;
  };

  // 1. Fetch what is stale, per connection, inside the timeout.
  const work = new Map<string, { provider: CalendarProviderId; items: FetchItem[] }>();
  for (const c of cals) {
    if (!fetchable(c)) continue;
    for (const ws of starts) {
      if (isFresh(c, ws)) continue;
      const entry = work.get(c.connectionId) ?? { provider: c.provider, items: [] };
      entry.items.push({ cal: c, ws });
      work.set(c.connectionId, entry);
    }
  }
  if (work.size) {
    const tasks = Promise.all([...work].map(([connectionId, w]) => refreshConnection(connectionId, w.provider, w.items, freshCutoff)));
    await raceTimeout(tasks, deadline - nowMs());
    windows = await loadWindows(db, cals.map((c) => c.calendarId), starts);

    // 2. Windows another request is fetching: wait for it when we have nothing usable or need submit freshness.
    const waiting = () =>
      [...work.values()].flatMap((w) => w.items).filter((i) => {
        if (isFresh(i.cal, i.ws)) return false;
        const row = windows.get(`${i.cal.calendarId}:${i.ws}`);
        const leased = Boolean(row?.fetchLeaseUntil && row.fetchLeaseUntil.getTime() > nowMs());
        return leased && (submit || !hasData(row));
      });
    while (waiting().length && nowMs() + POLL_MS <= deadline) {
      await sleep(POLL_MS);
      windows = await loadWindows(db, cals.map((c) => c.calendarId), starts);
    }
  }

  // 3. Per user flags.
  const at = nowMs();
  for (const c of cals) {
    const r = out[c.userId];
    if (!r) continue;
    for (const ws of starts) {
      if (isFresh(c, ws)) continue;
      r.ok = false;
      const w = windows.get(`${c.calendarId}:${ws}`);
      if (hasData(w) && at - w.fetchedAt.getTime() < STALE_FALLBACK_MS) r.stale = true;
      else r.nocal = true;
    }
  }
  for (const id of userIds) {
    const r = out[id];
    if (r?.ok === false) log.info("calendars.busy_degraded", { userId: id, stale: r.stale, nocal: r.nocal });
  }

  // 4. Busy rows (busy, not ours). Free/busy only calendars have no titles: name the calendar instead.
  const calById = new Map(cals.map((c) => [c.calendarId, c]));
  const busy = await readEvents(db, {
    calendarIds: cals.map((c) => c.calendarId),
    start: p.start,
    end: p.end,
    busyOnly: true,
  });
  for (const e of busy) {
    const cal = calById.get(e.calendarId);
    const labelled = e.title === null && cal?.busyOnly === true;
    out[e.userId]?.busy.push({
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      ...(e.allDay ? { allDayStartDate: e.allDayStartDate ?? undefined, allDayEndDate: e.allDayEndDate ?? undefined } : {}),
      title: labelled ? busyOnlyTitle(cal.name) : e.title,
      calendarId: e.calendarId,
      externalId: e.externalId,
      ...(labelled ? { busyOnly: true } : {}),
    });
  }
  return out;
}

type EventRow = {
  id: string;
  userId: string;
  calendarId: string;
  externalId: string;
  start: Date;
  end: Date;
  allDay: boolean;
  allDayStartDate: string | null;
  allDayEndDate: string | null;
  title: string | null;
  busy: boolean;
  showAs: string | null;
};

/** Cached events of the given calendars overlapping [start, end] (all-day ones with a day of slack), never our own. */
async function readEvents(db: DbOrTx, p: { calendarIds: string[]; start: Date; end: Date; busyOnly: boolean }): Promise<EventRow[]> {
  if (!p.calendarIds.length) return [];
  const padStart = new Date(p.start.getTime() - DAY_MS);
  const padEnd = new Date(p.end.getTime() + DAY_MS);
  const rows = await db
    .select({
      id: externalEvents.id,
      userId: externalEvents.userId,
      calendarId: externalEvents.calendarId,
      externalId: externalEvents.externalId,
      start: externalEvents.startAt,
      end: externalEvents.endAt,
      allDay: externalEvents.allDay,
      allDayStartDate: externalEvents.allDayStartDate,
      allDayEndDate: externalEvents.allDayEndDate,
      title: externalEvents.title,
      busy: externalEvents.busy,
      showAs: externalEvents.showAs,
    })
    .from(externalEvents)
    .where(
      and(
        inArray(externalEvents.calendarId, p.calendarIds),
        eq(externalEvents.isOwn, false),
        p.busyOnly ? eq(externalEvents.busy, true) : undefined,
        or(
          and(eq(externalEvents.allDay, false), lt(externalEvents.startAt, p.end), gt(externalEvents.endAt, p.start)),
          and(eq(externalEvents.allDay, true), lt(externalEvents.startAt, padEnd), gt(externalEvents.endAt, padStart)),
        ),
      ),
    )
    .orderBy(externalEvents.startAt, externalEvents.id);
  if (!rows.length) return rows;
  // Anti-join with our own provider events (written after the window was fetched).
  const own = new Set<string>();
  for (const part of chunk([...new Set(rows.map((r) => r.externalId))], 1000)) {
    const linked = await db
      .select({ calendarId: calendarLinkedEvents.calendarId, externalId: calendarLinkedEvents.externalId })
      .from(calendarLinkedEvents)
      .where(and(inArray(calendarLinkedEvents.calendarId, p.calendarIds), inArray(calendarLinkedEvents.externalId, part)));
    for (const l of linked) own.add(`${l.calendarId}:${l.externalId}`);
  }
  return own.size ? rows.filter((r) => !own.has(`${r.calendarId}:${r.externalId}`)) : rows;
}

/** CAL-19: the caller's own external events (titles included) for read-only display. */
export async function listExternalEvents(p: { userId: string; start: Date; end: Date }): Promise<ExternalEventListItem[]> {
  if (!isUuid(p.userId)) return [];
  await getExternalBusy({ userIds: [p.userId], start: p.start, end: p.end });
  const db = await getDb();
  const [user] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, p.userId)).limit(1);
  const zone = user?.timezone || "UTC";
  const cals = await db
    .select({ id: calendars.id, name: calendars.name, color: calendars.color })
    .from(calendars)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendars.connectionId))
    .where(
      and(
        eq(calendars.userId, p.userId),
        eq(calendars.checkConflicts, true),
        isNull(calendars.deletedAt),
        ne(calendarConnections.status, "disconnected"),
      ),
    );
  const byId = new Map(cals.map((c) => [c.id, c]));
  const rows = await readEvents(db, { calendarIds: cals.map((c) => c.id), start: p.start, end: p.end, busyOnly: false });
  const out: ExternalEventListItem[] = [];
  for (const r of rows) {
    const cal = byId.get(r.calendarId);
    if (!cal) continue;
    let start = r.start;
    let end = r.end;
    if (r.allDay && r.allDayStartDate) {
      const iv = expandAllDay(r.allDayStartDate, r.allDayEndDate ?? "", zone);
      start = new Date(iv.start);
      end = new Date(iv.end);
      if (!(start < p.end && end > p.start)) continue;
    }
    out.push({
      id: r.id,
      calendarName: cal.name,
      color: cal.color,
      title: r.title,
      start,
      end,
      allDay: r.allDay,
      busy: r.busy,
      ...(r.allDay ? { allDayStartDate: r.allDayStartDate ?? undefined, allDayEndDate: r.allDayEndDate ?? undefined } : {}),
      showAs: r.showAs,
    });
  }
  return out;
}

/** Marks the cached windows of calendars stale (CAL-07, CAL-10: selection changes, push notifications). */
export async function invalidateCalendarCache(calendarIds: string[], dbOrTx?: DbOrTx): Promise<void> {
  const ids = calendarIds.filter(isUuid);
  if (!ids.length) return;
  const db = dbOrTx ?? (await getDb());
  // Older than any TTL but still "usable" (SCH-11 fallback) if the next fetch fails.
  const staleAt = new Date(nowMs() - 60 * 60 * 1000);
  await db
    .update(calendarSyncWindows)
    .set({ fetchedAt: sql`least(${calendarSyncWindows.fetchedAt}, ${staleAt.toISOString()}::timestamptz)` })
    .where(inArray(calendarSyncWindows.calendarId, ids));
}
