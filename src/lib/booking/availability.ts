// Availability service (ARCHITECTURE section 8; SPEC SCH-11, SCH-12, SCH-14, SCH-19, SCH-22, SCH-24, BK-31):
// assembles slot engine inputs from the database and external calendars, then calls the pure engine.
//
// Steps (section 8): 0. booking window short circuit (no busy loaded, no provider called); 1. hosts and schedules
// (per host, shared or single-use override schedule; overrides and holidays, the whole future for "days with
// availability"); 2. external busy (calendars.getExternalBusy with page or submit freshness; NOCAL; all-day events
// expanded by their calendar dates in the host's schedule zone); 3. app meetings (buffered, with core and title);
// 4. reserved holds (booking reservations for exactly their hosts, group seat holds as seat counts, one-off and poll
// holds); 5. whole-period meeting counts (event type and host level), round robin state, group slots; 6. computeSlots
// with the reschedule exclusion (SCH-24), own reservation keys and ignoreLimits.
//
// The same assembly runs inside the booking transaction (createBooking, createReservation, completeReservation) with
// the transaction handle and pre-fetched external busy, so the recheck reads meetings and holds under the host locks.
import "server-only";
import { and, arrayOverlaps, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import {
  availabilitySchedules,
  bookingReservations,
  invitees,
  organizationMemberships,
  scheduledEventHosts,
  scheduledEvents,
  users,
} from "@/db/schema";
import { loadScheduleInput } from "@/lib/availability";
import { getExternalBusy, type ExternalBusy, type ExternalBusyByUser } from "@/lib/calendars";
import { AppError } from "@/lib/errors";
import { fileUrl } from "@/lib/files";
import { getReservedIntervals } from "@/lib/links";
import { log } from "@/lib/logger";
import { getPollReservedIntervals } from "@/lib/polls";
import { bookingWindow, computeSlots, expandAllDay, isValidTimeZone, limitCountSpan } from "@/lib/slots";
import type {
  BusyInterval,
  EventTypeRules,
  HostInput,
  Interval,
  MeetingStart,
  ScheduleInput,
  SlotEngineInput,
  SlotEngineResult,
} from "@/lib/slots/types";
import { isIsoDate } from "@/lib/slots/zone";
import { now as clockNow } from "@/lib/time/now";
import { buildRules, dateRangeRuleOf, needsWholeFuture, rangeOutsideWindow, resolveDuration } from "./rules";
import type { AvailabilityResult, BookingTarget, EventTypeRow, GetAvailabilityParams } from "./types";

const MIN = 60_000;
const DAY = 86_400_000;
/** Cache ages for external busy (CAL-10, SCH-20). */
export const FRESHNESS_MAX_AGE_SECONDS = { page: 180, submit: 60 } as const;
/** Timeout of a fresh provider fetch (SCH-20: 4 seconds, then the cache). */
export const EXTERNAL_BUSY_TIMEOUT_MS = 4_000;
/** Slots requests cover at most 62 days (SCH-05, BK-31). */
export const MAX_RANGE_DAYS = 62;
const WHOLE_FUTURE_DAYS = 3_650;

/** Availability evaluation modes of the internal callers. */
export type AvailabilityMode =
  /** Booking pages, reschedules, single-use links, API: every rule. */
  | { type: "standard" }
  /**
   * Meeting poll bookings (MP-18): the chosen option only, no working hours, no limits, 0/0 buffers; app meetings block
   * by their own times (booking over buffers is allowed), external events and poll or one-off holds only warn.
   */
  | { type: "poll"; start: number; end: number }
  /**
   * Host bookings with "Override available times" (OO-14): the chosen time only, no working hours, notice, range or
   * limits; the acting host's own busy only warns, other hosts' busy still blocks.
   */
  | { type: "override"; start: number; end: number; hostUserId: string };

export type AvailabilityInternals = {
  db?: DbOrTx;
  mode?: AvailabilityMode;
  /** External busy fetched before the transaction (SCH-20). */
  externalBusy?: ExternalBusyByUser;
  /** Shared cache across several event types (troubleshoot: one provider fetch per host). */
  externalBusyCache?: Map<string, Promise<ExternalBusyByUser>>;
  /** Any duration from 1 to 720 minutes (host "Customize this meeting" bookings, OO-13). */
  allowAnyDuration?: boolean;
};

export type HostContext = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  timezone: string;
  weekStart: 0 | 1;
  poolId: string | null;
  priority: 1 | 2 | 3 | 4 | 5;
  scheduleId: string | null;
  scheduleName: string | null;
  /** Zone of the schedule this target uses for the host (all-day expansion zone). */
  scheduleZone: string;
  /** Host limit zone: the host's default schedule zone (SCH-09). */
  defaultZone: string;
  limits: { day: number | null; week: number | null; month: number | null };
  schedule: ScheduleInput | null;
};

export type PreparedAvailability = {
  rules: EventTypeRules;
  hosts: HostInput[];
  hostContexts: HostContext[];
  query: SlotEngineInput["query"];
  rangeZone: string;
  durationMinutes: number;
  /** The rescheduled meeting (SCH-24), when any. */
  ignoredMeetingId: string | null;
  externalStale: boolean;
};

export type ComputedAvailability = AvailabilityResult & { prepared: PreparedAvailability | null };

const emptyResult = (troubleshoot: boolean, windowEnd: number | null = null): SlotEngineResult =>
  troubleshoot ? { slots: [], diagnostics: [], windowEnd } : { slots: [], windowEnd };

const toPriority = (p: number): 1 | 2 | 3 | 4 | 5 => (p <= 1 ? 1 : p >= 5 ? 5 : (Math.round(p) as 2 | 3 | 4));
const zoneOr = (...zones: (string | null | undefined)[]): string => zones.find((z) => isValidTimeZone(z)) ?? "UTC";

// ---------------------------------------------------------------------------------------------------------------
// Step 1: hosts and schedules

type HostSpec = { userId: string; poolId: string | null; priority: number; scheduleId: string | null };

/** Host specs of an event type (personal solo without rows: the owner). */
export function hostSpecsOf(et: EventTypeRow): HostSpec[] {
  if (et.hosts.length > 0) {
    return et.hosts.map((h) => ({ userId: h.userId, poolId: h.poolId, priority: h.priority, scheduleId: h.scheduleId }));
  }
  return et.ownerUserId ? [{ userId: et.ownerUserId, poolId: null, priority: 3, scheduleId: null }] : [];
}

/** Every user id that could attend a meeting of the event type (lock order step 1 candidates). */
export function candidateHostIds(et: EventTypeRow): string[] {
  return [...new Set(hostSpecsOf(et).map((h) => h.userId))].sort();
}

async function loadHostContexts(
  db: DbOrTx,
  target: BookingTarget,
  scheduleRange: { start: Date; end: Date },
): Promise<HostContext[]> {
  const et = target.eventType;
  const specs = hostSpecsOf(et);
  if (specs.length === 0) return [];
  const ids = [...new Set(specs.map((s) => s.userId))];
  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      timezone: users.timezone,
      weekStart: users.weekStart,
      avatarFileId: users.avatarFileId,
      avatarUrl: users.avatarUrl,
      meetingLimitDay: users.meetingLimitDay,
      meetingLimitWeek: users.meetingLimitWeek,
      meetingLimitMonth: users.meetingLimitMonth,
    })
    .from(users)
    .where(and(inArray(users.id, ids), isNull(users.deletedAt)));
  const userById = new Map(userRows.map((u) => [u.id, u]));

  // Personal schedules of every host (default first, else the oldest) and every explicitly referenced schedule.
  const scheduleColumns = {
    id: availabilitySchedules.id,
    userId: availabilitySchedules.userId,
    name: availabilitySchedules.name,
    timezone: availabilitySchedules.timezone,
    eventTypeId: availabilitySchedules.eventTypeId,
    singleUseLinkId: availabilitySchedules.singleUseLinkId,
  };
  const personal = await db
    .select(scheduleColumns)
    .from(availabilitySchedules)
    .where(
      and(
        inArray(availabilitySchedules.userId, ids),
        isNull(availabilitySchedules.eventTypeId),
        isNull(availabilitySchedules.singleUseLinkId),
        isNull(availabilitySchedules.deletedAt),
      ),
    )
    .orderBy(desc(availabilitySchedules.isDefault), asc(availabilitySchedules.createdAt));
  const defaultByUser = new Map<string, (typeof personal)[number]>();
  for (const s of personal) if (!defaultByUser.has(s.userId)) defaultByUser.set(s.userId, s);

  const explicitIds = [
    target.overrides?.scheduleId ?? null,
    et.scheduleId,
    ...specs.map((s) => s.scheduleId),
  ].filter((id): id is string => typeof id === "string");
  const explicitRows = explicitIds.length
    ? await db
        .select(scheduleColumns)
        .from(availabilitySchedules)
        .where(and(inArray(availabilitySchedules.id, [...new Set(explicitIds)]), isNull(availabilitySchedules.deletedAt)))
    : [];
  const scheduleById = new Map([...personal, ...explicitRows].map((s) => [s.id, s]));

  // A referenced schedule counts only when it belongs to the expected person (GEN-08: a foreign key never proves
  // ownership) and, like the availability pages show it (AV-09, AV-11), is a named schedule or this event type's own
  // custom hours; single-use link schedules only apply through the link's override. Anything else falls back to the
  // host's default schedule, so the booking page and the Troubleshoot view agree with the Availability page.
  const hostIds = new Set([...ids, ...(et.ownerUserId ? [et.ownerUserId] : [])]);
  const usable = (id: string | null | undefined, ownedBy: (userId: string) => boolean) => {
    const row = id ? scheduleById.get(id) : undefined;
    if (!row || !ownedBy(row.userId) || row.singleUseLinkId) return null;
    if (row.eventTypeId && row.eventTypeId !== et.id) return null;
    return row;
  };
  const overrideRow = (() => {
    const row = target.overrides?.scheduleId ? scheduleById.get(target.overrides.scheduleId) : undefined;
    return row && hostIds.has(row.userId) ? row : null;
  })();

  const pick = (spec: HostSpec) => {
    // Single-use override schedule replaces all (OO-02); a shared schedule applies to every host; then the host's own
    // custom hours; then the event type's schedule when it belongs to this host (solo "Block Off Work"); then the
    // host's default schedule.
    return (
      overrideRow ??
      (et.availabilitySetting === "shared" ? usable(et.scheduleId, (u) => hostIds.has(u)) : null) ??
      usable(spec.scheduleId, (u) => u === spec.userId) ??
      usable(et.scheduleId, (u) => u === spec.userId) ??
      defaultByUser.get(spec.userId) ??
      null
    );
  };

  const loaded = new Map<string, Promise<ScheduleInput | null>>();
  const out: HostContext[] = [];
  for (const spec of specs) {
    const user = userById.get(spec.userId);
    if (!user) continue; // a deleted host cannot attend
    const scheduleRow = pick(spec);
    if (scheduleRow && !loaded.has(scheduleRow.id)) {
      loaded.set(scheduleRow.id, loadScheduleInput(scheduleRow.id, scheduleRange, { db }));
    }
    const defaultRow = defaultByUser.get(spec.userId);
    out.push({
      userId: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarFileId ? fileUrl(user.avatarFileId) : (user.avatarUrl ?? null),
      timezone: zoneOr(user.timezone),
      weekStart: user.weekStart === 1 ? 1 : 0,
      poolId: spec.poolId,
      priority: toPriority(spec.priority),
      scheduleId: scheduleRow?.id ?? null,
      scheduleName: scheduleRow?.name ?? null,
      scheduleZone: zoneOr(scheduleRow?.timezone, defaultRow?.timezone, user.timezone),
      defaultZone: zoneOr(defaultRow?.timezone, user.timezone),
      limits: { day: user.meetingLimitDay, week: user.meetingLimitWeek, month: user.meetingLimitMonth },
      schedule: null,
    });
  }
  for (const h of out) {
    if (h.scheduleId) h.schedule = (await loaded.get(h.scheduleId)) ?? null;
  }
  return out;
}

/** Zone of the event type's limits and date range (SCH-08: solo: the schedule zone; multi-host: shared or organizer). */
function rangeZoneOf(et: EventTypeRow, hosts: HostContext[]): string {
  const required = hosts.filter((h) => h.poolId === null);
  if (hosts.length === 1) return hosts[0]!.scheduleZone;
  if (et.availabilitySetting === "shared" && et.scheduleId) {
    const shared = hosts.find((h) => h.scheduleId === et.scheduleId);
    if (shared) return shared.scheduleZone;
  }
  const organizerId = et.organizerUserId ?? et.ownerUserId;
  const organizer = hosts.find((h) => h.userId === organizerId);
  return (organizer ?? required[0] ?? hosts[0])?.scheduleZone ?? "UTC";
}

function weekStartOf(et: EventTypeRow, hosts: HostContext[]): 0 | 1 {
  const owner = hosts.find((h) => h.userId === (et.ownerUserId ?? et.organizerUserId));
  return (owner ?? hosts[0])?.weekStart ?? 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Step 2: external busy

/** Busy intervals of one user's external events (SCH-12: all-day events by their calendar dates in `zone`). */
export function externalToBusy(events: readonly ExternalBusy[], zone: string, opts: { titles: boolean }): BusyInterval[] {
  const out: BusyInterval[] = [];
  for (const e of events) {
    let start = e.start.getTime();
    let end = e.end.getTime();
    if (e.allDay) {
      const startDate = isIsoDate(e.allDayStartDate) ? e.allDayStartDate : e.start.toISOString().slice(0, 10);
      const endDate = isIsoDate(e.allDayEndDate) ? e.allDayEndDate : e.end.toISOString().slice(0, 10);
      const iv = expandAllDay(startDate, endDate, zone);
      start = iv.start;
      end = iv.end;
    }
    if (!(end > start)) continue;
    out.push({
      start,
      end,
      source: "calendar",
      title: opts.titles ? (e.title ?? null) : null,
      calendarId: e.calendarId,
    });
  }
  return out;
}

async function fetchExternal(
  userIds: string[],
  start: Date,
  end: Date,
  freshness: "page" | "submit",
): Promise<ExternalBusyByUser> {
  try {
    return await getExternalBusy({
      userIds,
      start,
      end,
      maxAgeSeconds: FRESHNESS_MAX_AGE_SECONDS[freshness],
      timeoutMs: EXTERNAL_BUSY_TIMEOUT_MS,
    });
  } catch (e) {
    // Safer against double booking (SCH-11): an unreadable calendar makes the host unavailable (NOCAL).
    log.error("booking.external_busy_failed", { error: e });
    return Object.fromEntries(userIds.map((id) => [id, { ok: false, stale: true, nocal: true, busy: [] }]));
  }
}

/** External busy for the hosts of a booking, fetched before the transaction (SCH-20 submit freshness). */
export async function prefetchExternalBusy(
  target: BookingTarget,
  start: Date,
  end: Date,
  freshness: "page" | "submit" = "submit",
): Promise<ExternalBusyByUser> {
  const ids = candidateHostIds(target.eventType);
  if (ids.length === 0) return {};
  const pad = (Math.max(target.eventType.bufferBeforeMinutes, target.eventType.bufferAfterMinutes) * MIN) + DAY;
  return fetchExternal(ids, new Date(start.getTime() - pad), new Date(end.getTime() + pad), freshness);
}

// ---------------------------------------------------------------------------------------------------------------
// Steps 3 to 5: meetings, holds, counts

type MeetingRow = {
  scheduledEventId: string;
  userId: string;
  eventTypeId: string;
  startAt: Date;
  endAt: Date;
  bufferedStartAt: Date;
  bufferedEndAt: Date;
  name: string;
  isGroup: boolean;
  inviteesLimit: number;
};

async function loadMeetings(db: DbOrTx, userIds: string[], from: Date, to: Date): Promise<MeetingRow[]> {
  if (userIds.length === 0) return [];
  return db
    .select({
      scheduledEventId: scheduledEventHosts.scheduledEventId,
      userId: scheduledEventHosts.userId,
      eventTypeId: scheduledEvents.eventTypeId,
      startAt: scheduledEventHosts.startAt,
      endAt: scheduledEventHosts.endAt,
      bufferedStartAt: scheduledEventHosts.bufferedStartAt,
      bufferedEndAt: scheduledEventHosts.bufferedEndAt,
      name: scheduledEvents.name,
      isGroup: scheduledEvents.isGroup,
      inviteesLimit: scheduledEvents.inviteesLimit,
    })
    .from(scheduledEventHosts)
    .innerJoin(scheduledEvents, eq(scheduledEvents.id, scheduledEventHosts.scheduledEventId))
    .where(
      and(
        inArray(scheduledEventHosts.userId, userIds),
        eq(scheduledEventHosts.isActive, true),
        eq(scheduledEvents.status, "active"),
        lt(scheduledEventHosts.bufferedStartAt, to),
        gt(scheduledEventHosts.bufferedEndAt, from),
      ),
    );
}

/** Active invitee counts per scheduled event (group seats). */
async function activeInviteeCounts(db: DbOrTx, scheduledEventIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (scheduledEventIds.length === 0) return out;
  const rows = await db
    .select({ id: invitees.scheduledEventId, n: sql<number>`count(*)::int` })
    .from(invitees)
    .where(and(inArray(invitees.scheduledEventId, [...new Set(scheduledEventIds)]), eq(invitees.status, "active")))
    .groupBy(invitees.scheduledEventId);
  for (const r of rows) out.set(r.id, Number(r.n));
  return out;
}

type ReservationRow = {
  id: string;
  eventTypeId: string;
  startAt: Date;
  endAt: Date;
  hostUserIds: string[];
  isGroupSeat: boolean;
  inviteeEmailNormalized: string;
};

async function loadReservations(db: DbOrTx, userIds: string[], from: Date, to: Date, at: Date): Promise<ReservationRow[]> {
  if (userIds.length === 0) return [];
  return db
    .select({
      id: bookingReservations.id,
      eventTypeId: bookingReservations.eventTypeId,
      startAt: bookingReservations.startAt,
      endAt: bookingReservations.endAt,
      hostUserIds: bookingReservations.hostUserIds,
      isGroupSeat: bookingReservations.isGroupSeat,
      inviteeEmailNormalized: bookingReservations.inviteeEmailNormalized,
    })
    .from(bookingReservations)
    .where(
      and(
        eq(bookingReservations.status, "pending"),
        gt(bookingReservations.expiresAt, at),
        arrayOverlaps(bookingReservations.hostUserIds, userIds),
        lt(bookingReservations.startAt, to),
        gt(bookingReservations.endAt, from),
      ),
    );
}

/** Starts of every active meeting of the hosts in [from, to) (host limits across all event types, SCH-09). */
async function loadHostMeetingStarts(db: DbOrTx, userIds: string[], from: Date, to: Date) {
  if (userIds.length === 0) return [] as { userId: string; start: Date; meetingId: string }[];
  return db
    .select({ userId: scheduledEventHosts.userId, start: scheduledEvents.startAt, meetingId: scheduledEvents.id })
    .from(scheduledEventHosts)
    .innerJoin(scheduledEvents, eq(scheduledEvents.id, scheduledEventHosts.scheduledEventId))
    .where(
      and(
        inArray(scheduledEventHosts.userId, userIds),
        eq(scheduledEventHosts.isActive, true),
        eq(scheduledEvents.status, "active"),
        gte(scheduledEvents.startAt, from),
        lt(scheduledEvents.startAt, to),
      ),
    );
}

async function loadEventTypeMeetingStarts(db: DbOrTx, eventTypeId: string, span: Interval): Promise<MeetingStart[]> {
  const rows = await db
    .select({ start: scheduledEvents.startAt, meetingId: scheduledEvents.id })
    .from(scheduledEvents)
    .where(
      and(
        eq(scheduledEvents.eventTypeId, eventTypeId),
        eq(scheduledEvents.status, "active"),
        gte(scheduledEvents.startAt, new Date(span.start)),
        lt(scheduledEvents.startAt, new Date(span.end)),
      ),
    );
  return rows.map((r) => ({ start: r.start.getTime(), meetingId: r.meetingId }));
}

async function loadRoundRobinState(
  db: DbOrTx,
  et: EventTypeRow,
  ignoreMeetingId: string | null,
): Promise<Map<string, { count: number; lastAssignedAt: number | null }>> {
  const out = new Map<string, { count: number; lastAssignedAt: number | null }>();
  for (const pool of et.pools) {
    const rows = await db
      .select({
        userId: scheduledEventHosts.userId,
        n: sql<number>`count(*)::int`,
        last: sql<Date | null>`max(${scheduledEventHosts.assignedAt})`.mapWith(scheduledEventHosts.assignedAt),
      })
      .from(scheduledEventHosts)
      .where(
        and(
          eq(scheduledEventHosts.eventTypeId, et.id),
          eq(scheduledEventHosts.poolId, pool.id),
          eq(scheduledEventHosts.role, "assigned"),
          eq(scheduledEventHosts.isActive, true),
          gte(scheduledEventHosts.assignedAt, pool.countsResetAt),
          ignoreMeetingId ? ne(scheduledEventHosts.scheduledEventId, ignoreMeetingId) : undefined,
        ),
      )
      .groupBy(scheduledEventHosts.userId);
    for (const r of rows) {
      out.set(`${pool.id}:${r.userId}`, { count: Number(r.n), lastAssignedAt: r.last ? r.last.getTime() : null });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Assembly

/**
 * Prepares the engine input (steps 0 to 5). Returns `short` with the final result when the window short circuit or a
 * target state answers without busy times.
 */
export async function prepareAvailability(
  params: GetAvailabilityParams,
  internals: AvailabilityInternals = {},
): Promise<{ prepared: PreparedAvailability; short?: undefined } | { prepared?: undefined; short: AvailabilityResult }> {
  const db = internals.db ?? (await getDb());
  const mode: AvailabilityMode = internals.mode ?? { type: "standard" };
  const target = params.target;
  const et = target.eventType;
  const troubleshoot = params.troubleshoot === true;
  const nowMs = (params.now ?? clockNow()).getTime();
  const rangeStart = params.start.getTime();
  const rangeEnd = params.end.getTime();
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) throw new AppError("validation", "Invalid range.");

  const requested = params.durationMinutes ?? null;
  const durationMinutes =
    internals.allowAnyDuration && requested !== null && Number.isInteger(requested) && requested >= 1 && requested <= 720
      ? requested
      : resolveDuration(target, requested);
  if (durationMinutes === null) throw new AppError("validation", "This duration isn't available.", { fieldErrors: { duration: ["This duration isn't available."] } });
  const durationMs = durationMinutes * MIN;

  const inactive = et.deletedAt !== null || (target.linkStatus !== undefined && target.linkStatus !== "active");
  if (!(rangeEnd > rangeStart) || inactive) return { short: { ...emptyResult(troubleshoot), hostsById: {} } };

  // Step 1: hosts and schedules (the whole future for "days with availability" windows, SCH-03).
  const range = dateRangeRuleOf(et, target.overrides);
  const wholeFuture = needsWholeFuture(range) && mode.type === "standard";
  const scheduleRange = wholeFuture
    ? { start: new Date(Math.min(rangeStart, nowMs) - DAY), end: new Date(Math.max(rangeEnd, nowMs + WHOLE_FUTURE_DAYS * DAY)) }
    : { start: new Date(rangeStart - DAY), end: new Date(rangeEnd + durationMs + DAY) };
  const hostContexts = await loadHostContexts(db, target, scheduleRange);
  const hostsById: AvailabilityResult["hostsById"] = Object.fromEntries(
    hostContexts.map((h) => [h.userId, { name: h.name, avatarUrl: h.avatarUrl }]),
  );
  if (hostContexts.length === 0) return { short: { ...emptyResult(troubleshoot), hostsById } };

  const rangeZone = rangeZoneOf(et, hostContexts);
  const weekStart = weekStartOf(et, hostContexts);
  const spotsMode = mode.type !== "standard" || Array.isArray(target.spots);
  const spots: Interval[] | null =
    mode.type !== "standard"
      ? [{ start: mode.start, end: mode.end }]
      : target.spots
        ? target.spots.map((s) => ({ start: s.start.getTime(), end: s.end.getTime() }))
        : null;
  const zeroBuffers = mode.type === "poll" || target.kind === "one_off";
  const ignoreLimits = params.ignoreLimits === true || mode.type !== "standard" || target.kind === "one_off";

  const skeletonRules = buildRules({
    target,
    durationMinutes,
    rangeZone,
    weekStart,
    eventTypeMeetingStarts: [],
    groupSlots: [],
    spots,
    zeroBuffers,
    ignoreNoticeAndRange: mode.type !== "standard",
  });
  const skeletonHosts: HostInput[] = hostContexts.map((h) => ({
    userId: h.userId,
    schedule: spotsMode ? null : h.schedule,
    busy: [],
    calendarStatus: "ok",
    hostLimits: {},
    hostLimitZone: h.defaultZone,
    hostMeetingStarts: [],
    priority: h.priority,
    poolId: h.poolId,
    rr: null,
    weekStart: h.weekStart,
  }));

  // Step 0: the booking window short circuit (BK-31): no busy times, no provider calls.
  const window = bookingWindow({ rules: skeletonRules, hosts: skeletonHosts, now: nowMs });
  if (!troubleshoot && rangeOutsideWindow(window, rangeStart, rangeEnd)) {
    return { short: { slots: [], windowEnd: window.end, hostsById } };
  }

  // Reschedule (SCH-24): the moved meeting is excluded everywhere; a group invitee frees only its own seat.
  let ignoredMeetingId: string | null = null;
  let ownGroupSeat: { meetingId: string } | null = null;
  if (params.ignoreInviteeId) {
    const [old] = await db
      .select({ scheduledEventId: invitees.scheduledEventId, status: invitees.status, isGroup: scheduledEvents.isGroup })
      .from(invitees)
      .innerJoin(scheduledEvents, eq(scheduledEvents.id, invitees.scheduledEventId))
      .where(eq(invitees.id, params.ignoreInviteeId))
      .limit(1);
    if (old && old.status === "active") {
      if (old.isGroup) ownGroupSeat = { meetingId: old.scheduledEventId };
      else ignoredMeetingId = old.scheduledEventId;
    }
  }

  // Steps 2 to 4: busy times.
  const userIds = hostContexts.map((h) => h.userId);
  const maxBufferMs = Math.max(skeletonRules.bufferBeforeMinutes, skeletonRules.bufferAfterMinutes) * MIN;
  const busyFrom = new Date(rangeStart - maxBufferMs - DAY);
  const busyTo = new Date(rangeEnd + durationMs + maxBufferMs + DAY);
  const at = new Date(nowMs);

  const freshness = params.freshness ?? "page";
  let external: ExternalBusyByUser = {};
  if (mode.type !== "poll") {
    if (internals.externalBusy) external = internals.externalBusy;
    else if (internals.externalBusyCache) {
      // One wide fetch per host set and range, shared by every event type (buffers and durations are at most 12 hours).
      const key = `${userIds.join(",")}|${rangeStart}|${rangeEnd}|${freshness}`;
      let p = internals.externalBusyCache.get(key);
      if (!p) {
        p = fetchExternal(userIds, new Date(rangeStart - 3 * DAY), new Date(rangeEnd + 3 * DAY), freshness);
        internals.externalBusyCache.set(key, p);
      }
      external = await p;
    } else external = await fetchExternal(userIds, busyFrom, busyTo, freshness);
  }
  const overlappedExternal = new Set((target.spots ?? []).flatMap((s) => s.overlappedExternalIds));

  const meetingRows = await loadMeetings(db, userIds, busyFrom, busyTo);
  const groupMeetingIds = meetingRows.filter((m) => m.isGroup).map((m) => m.scheduledEventId);
  const reservationRows = await loadReservations(db, userIds, busyFrom, busyTo, at);
  const [linkHolds, pollHolds] =
    mode.type === "poll"
      ? [{}, {}]
      : await Promise.all([getReservedIntervals(userIds, busyFrom, busyTo), getPollReservedIntervals(userIds, busyFrom, busyTo)]);

  // Step 5: counts and group slots.
  const isGroup = et.kind === "group";
  const groupRows = isGroup && !spotsMode
    ? await db
        .select({ id: scheduledEvents.id, startAt: scheduledEvents.startAt, endAt: scheduledEvents.endAt, limit: scheduledEvents.inviteesLimit })
        .from(scheduledEvents)
        .where(
          and(
            eq(scheduledEvents.eventTypeId, et.id),
            eq(scheduledEvents.isGroup, true),
            eq(scheduledEvents.status, "active"),
            lt(scheduledEvents.startAt, new Date(rangeEnd)),
            gt(scheduledEvents.endAt, new Date(rangeStart)),
          ),
        )
    : [];
  const counts = await activeInviteeCounts(db, [...groupMeetingIds, ...groupRows.map((g) => g.id)]);

  const ignoreReservationKeys: string[] = [];
  if (params.ignoreReservationId) ignoreReservationKeys.push(params.ignoreReservationId);
  // SCH-19: a hold of the same invitee email for the same slot (a start in the evaluated range of this event type) is
  // the invitee's own (retrying payment, replacing an edited submission); holds of other slots still block.
  const ownEmail = params.reservationEmail?.trim().toLowerCase() ?? null;
  for (const r of reservationRows) {
    const s = r.startAt.getTime();
    if (ownEmail && r.inviteeEmailNormalized === ownEmail && r.eventTypeId === et.id && s >= rangeStart && s < rangeEnd) {
      ignoreReservationKeys.push(r.id);
    }
  }
  const ignoredReservations = new Set(ignoreReservationKeys);

  const groupSlots: EventTypeRules["groupSlots"] = [];
  if (isGroup && !spotsMode) {
    const seatHolds = new Map<number, number>();
    for (const r of reservationRows) {
      if (r.isGroupSeat && r.eventTypeId === et.id && !ignoredReservations.has(r.id)) {
        seatHolds.set(r.startAt.getTime(), (seatHolds.get(r.startAt.getTime()) ?? 0) + 1);
      }
    }
    const withMeeting = new Set<number>();
    for (const g of groupRows) {
      const s = g.startAt.getTime();
      withMeeting.add(s);
      const own = ownGroupSeat?.meetingId === g.id ? 1 : 0;
      groupSlots.push({
        start: s,
        end: g.endAt.getTime(),
        remaining: g.limit - (counts.get(g.id) ?? 0) - (seatHolds.get(s) ?? 0) + own,
        meetingId: g.id,
      });
    }
    for (const [s, n] of seatHolds) {
      if (withMeeting.has(s) || s < rangeStart || s >= rangeEnd) continue;
      groupSlots.push({ start: s, end: s + durationMs, remaining: Math.max(1, et.maxInvitees) - n, meetingId: null });
    }
  }

  const etHasLimits = !ignoreLimits && [et.limitPerDay, et.limitPerWeek, et.limitPerMonth].some((v) => v !== null && v !== undefined);
  const etSpan = limitCountSpan(rangeStart, rangeEnd, rangeZone, weekStart);
  const eventTypeMeetingStarts = etHasLimits ? await loadEventTypeMeetingStarts(db, et.id, etSpan) : [];

  const limitedHosts = ignoreLimits
    ? []
    : hostContexts.filter((h) => [h.limits.day, h.limits.week, h.limits.month].some((v) => v !== null && v !== undefined));
  const hostSpans = new Map(limitedHosts.map((h) => [h.userId, limitCountSpan(rangeStart, rangeEnd, h.defaultZone, h.weekStart)]));
  let hostStartRows: { userId: string; start: Date; meetingId: string }[] = [];
  if (limitedHosts.length > 0) {
    const from = Math.min(...[...hostSpans.values()].map((s) => s.start));
    const to = Math.max(...[...hostSpans.values()].map((s) => s.end));
    hostStartRows = await loadHostMeetingStarts(db, limitedHosts.map((h) => h.userId), new Date(from), new Date(to));
  }
  const rrState = et.pools.length > 0 && et.poolingType ? await loadRoundRobinState(db, et, ignoredMeetingId) : new Map();

  // Busy per host.
  const hosts: HostInput[] = hostContexts.map((h) => {
    const ext = external[h.userId];
    const own = mode.type === "override" && mode.hostUserId === h.userId;
    const busy: BusyInterval[] = [];
    if (ext && mode.type !== "poll" && !own) {
      const events = overlappedExternal.size ? ext.busy.filter((e) => !overlappedExternal.has(e.externalId)) : ext.busy;
      busy.push(...externalToBusy(events, h.scheduleZone, { titles: true }));
    }
    if (!own) {
      for (const m of meetingRows) {
        if (m.userId !== h.userId) continue;
        const full = m.isGroup && (counts.get(m.scheduledEventId) ?? 0) >= m.inviteesLimit;
        const core = { start: m.startAt.getTime(), end: m.endAt.getTime() };
        busy.push({
          // Poll bookings may overlap other meetings' buffers ("You can book over buffers").
          start: mode.type === "poll" ? core.start : m.bufferedStartAt.getTime(),
          end: mode.type === "poll" ? core.end : m.bufferedEndAt.getTime(),
          source: "meeting",
          core,
          title: m.name,
          meetingId: m.scheduledEventId,
          eventTypeId: m.eventTypeId,
          isFullGroupSlot: full,
        });
      }
    }
    for (const r of reservationRows) {
      if (!r.hostUserIds.includes(h.userId)) continue;
      // Seat holds of this group event type reduce the slot's seats instead of blocking the host.
      if (isGroup && !spotsMode && r.isGroupSeat && r.eventTypeId === et.id) continue;
      busy.push({
        start: r.startAt.getTime(),
        end: r.endAt.getTime(),
        source: "reserved",
        reservedKind: "reservation",
        reservationKey: r.id,
        title: null,
      });
    }
    if (mode.type !== "poll" && !own) {
      busy.push(...((linkHolds as Record<string, BusyInterval[]>)[h.userId] ?? []));
      busy.push(...((pollHolds as Record<string, BusyInterval[]>)[h.userId] ?? []));
    }
    const span = hostSpans.get(h.userId);
    const rr = h.poolId ? (rrState.get(`${h.poolId}:${h.userId}`) ?? { count: 0, lastAssignedAt: null }) : null;
    return {
      userId: h.userId,
      schedule: spotsMode ? null : h.schedule,
      busy,
      calendarStatus: ext?.nocal && mode.type !== "poll" && !own ? "nocal" : "ok",
      hostLimits: own ? {} : h.limits,
      hostLimitZone: h.defaultZone,
      hostMeetingStarts: span
        ? hostStartRows
            .filter((r) => r.userId === h.userId && r.start.getTime() >= span.start && r.start.getTime() < span.end)
            .map((r) => ({ start: r.start.getTime(), meetingId: r.meetingId }))
        : [],
      priority: h.priority,
      poolId: h.poolId,
      rr,
      weekStart: h.weekStart,
    };
  });

  const rules = buildRules({
    target,
    durationMinutes,
    rangeZone,
    weekStart,
    eventTypeMeetingStarts,
    groupSlots,
    spots,
    zeroBuffers,
    ignoreNoticeAndRange: mode.type !== "standard",
  });
  const query: SlotEngineInput["query"] = {
    rangeStart,
    rangeEnd,
    now: nowMs,
    troubleshoot,
    ignoreMeetingIds: ignoredMeetingId ? [ignoredMeetingId] : [],
    ignoreReservationKeys,
    ignoreLimits,
  };
  if (troubleshoot && params.diagnoseOutsideHours) query.diagnoseOutsideHours = true;
  const externalStale = Object.values(external).some((e) => e.stale);
  return {
    prepared: { rules, hosts, hostContexts, query, rangeZone, durationMinutes, ignoredMeetingId, externalStale },
  };
}

/** getAvailability with internal options (transaction handle, prefetched busy, poll and override modes). */
export async function computeAvailability(
  params: GetAvailabilityParams,
  internals: AvailabilityInternals = {},
): Promise<ComputedAvailability> {
  const p = await prepareAvailability(params, internals);
  if (p.short) return { ...p.short, prepared: null };
  const { prepared } = p;
  const result = computeSlots({ rules: prepared.rules, hosts: prepared.hosts, query: prepared.query });
  const hostsById = Object.fromEntries(prepared.hostContexts.map((h) => [h.userId, { name: h.name, avatarUrl: h.avatarUrl }]));
  return { ...result, hostsById, prepared };
}

/** Available slots of a booking target (ARCHITECTURE section 8). Slots are UTC instants sorted by start. */
export async function getAvailability(params: GetAvailabilityParams): Promise<AvailabilityResult> {
  const { prepared, ...result } = await computeAvailability(params);
  void prepared;
  return result;
}

// ---------------------------------------------------------------------------------------------------------------
// getBusyForUsers (pickers, polls, mutual availability)

/**
 * External + meetings + reserved busy intervals for pickers and polls. Authz (GEN-08): every userId must be the actor
 * or a member of the actor's organization (else AppError forbidden); titles only for the actor's own intervals.
 */
export async function getBusyForUsers(
  actor: { userId: string; organizationId: string },
  userIds: string[],
  start: Date,
  end: Date,
): Promise<Record<string, BusyInterval[]>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return {};
  if (ids.length > 50) throw new AppError("validation", "Too many people at once.");
  const s = start.getTime();
  const e = end.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) throw new AppError("validation", "Invalid range.");
  if (e - s > 93 * DAY) throw new AppError("validation", "The range is too long.");
  const db = await getDb();
  const members = await db
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(
      and(
        eq(organizationMemberships.organizationId, actor.organizationId),
        inArray(organizationMemberships.userId, ids),
        isNull(users.deletedAt),
      ),
    );
  const allowed = new Set(members.map((m) => m.userId));
  for (const id of ids) {
    if (!allowed.has(id)) throw new AppError("forbidden", "You don't have access to one of the selected people.");
  }

  // Zones for all-day expansion: each user's default schedule zone (else the profile zone).
  const zoneRows = await db
    .select({ userId: users.id, userTz: users.timezone, scheduleTz: availabilitySchedules.timezone })
    .from(users)
    .leftJoin(
      availabilitySchedules,
      and(
        eq(availabilitySchedules.userId, users.id),
        eq(availabilitySchedules.isDefault, true),
        isNull(availabilitySchedules.eventTypeId),
        isNull(availabilitySchedules.singleUseLinkId),
        isNull(availabilitySchedules.deletedAt),
      ),
    )
    .where(inArray(users.id, ids));
  const zoneOf = new Map<string, string>();
  for (const r of zoneRows) zoneOf.set(r.userId, zoneOr(r.scheduleTz, r.userTz));

  const from = new Date(s);
  const to = new Date(e);
  const at = clockNow();
  const [external, meetingRows, reservationRows, linkHolds, pollHolds] = await Promise.all([
    fetchExternal(ids, from, to, "page"),
    loadMeetings(db, ids, from, to),
    loadReservations(db, ids, from, to, at),
    getReservedIntervals(ids, from, to),
    getPollReservedIntervals(ids, from, to),
  ]);

  const out: Record<string, BusyInterval[]> = {};
  for (const id of ids) {
    const self = id === actor.userId;
    const busy: BusyInterval[] = [];
    busy.push(...externalToBusy(external[id]?.busy ?? [], zoneOf.get(id) ?? "UTC", { titles: self }));
    for (const m of meetingRows) {
      if (m.userId !== id) continue;
      busy.push({
        start: m.bufferedStartAt.getTime(),
        end: m.bufferedEndAt.getTime(),
        source: "meeting",
        core: { start: m.startAt.getTime(), end: m.endAt.getTime() },
        title: self ? m.name : null,
        meetingId: m.scheduledEventId,
        eventTypeId: m.eventTypeId,
      });
    }
    for (const r of reservationRows) {
      if (!r.hostUserIds.includes(id)) continue;
      busy.push({ start: r.startAt.getTime(), end: r.endAt.getTime(), source: "reserved", reservedKind: "reservation", reservationKey: r.id, title: null });
    }
    for (const h of [...(linkHolds[id] ?? []), ...(pollHolds[id] ?? [])]) busy.push({ ...h, title: self ? (h.title ?? null) : null });
    busy.sort((a, b) => a.start - b.start || a.end - b.end);
    out[id] = busy;
  }
  return out;
}
