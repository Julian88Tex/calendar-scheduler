// The Troubleshoot view data (SCOPE priority 4; SPEC SCH-21, BK-24): for a host, a range and one or every event type,
// every candidate start with its status and reasons (outside working hours, a conflicting calendar event with its
// title, a buffer before or after a named event, minimum notice, beyond the date range, daily or weekly limit, host
// meeting limit, an existing booking, holds), built on the slot engine diagnostics. The availability module renders
// it on /app/availability; booking-pages uses the same data for the owner's troubleshoot mode.
//
// Authorization (GEN-08): the actor diagnoses their own availability; org owners and admins may diagnose another
// member of their organization, without event titles (titles are only ever shown to the calendar owner).
import "server-only";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { getDb } from "@/db";
import { eventTypeHosts, eventTypes, organizationMemberships, users } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import type { Blocker, BusyInterval, CandidateDiagnostic, ReasonCode } from "@/lib/slots/types";
import { now as clockNow } from "@/lib/time/now";
import { computeAvailability, getBusyForUsers, MAX_RANGE_DAYS, type ComputedAvailability } from "./availability";
import { allowedDurationsOf, dateRangeRuleOf } from "./rules";
import { loadEventType, withRelations } from "./target";
import type {
  EventTypeRow,
  TroubleshootBlocker,
  TroubleshootCandidate,
  TroubleshootEntry,
  TroubleshootParams,
  TroubleshootResult,
} from "./types";

const DAY = 86_400_000;

export type TroubleshootActor = { userId: string; organizationId: string; orgRole?: "owner" | "admin" | "user" };

function codeOfBusy(b: BusyInterval, eventTypeId: string | null): ReasonCode {
  if (b.source === "calendar") return "CALENDAR";
  if (b.source === "reserved") return "RESERVED";
  return eventTypeId && b.eventTypeId === eventTypeId ? "EVENT" : "OVERLAP";
}

function blockerOut(b: Blocker, showTitles: boolean): TroubleshootBlocker {
  return {
    code: b.code ?? (b.source === "calendar" ? "CALENDAR" : b.source === "reserved" ? "RESERVED" : "OVERLAP"),
    source: b.source,
    start: b.start,
    end: b.end,
    core: b.core ? { start: b.core.start, end: b.core.end } : null,
    title: showTitles ? (b.title ?? null) : null,
    calendarId: b.calendarId ?? null,
    meetingId: b.meetingId ?? null,
    eventTypeId: b.eventTypeId ?? null,
    bufferSide: b.bufferSide ?? null,
  };
}

/** One engine diagnostic as the Troubleshoot view row of a host. */
export function candidateOut(d: CandidateDiagnostic, hostId: string, showTitles: boolean): TroubleshootCandidate {
  const host = d.hosts[hostId];
  const outsideHours = !d.available && (d.outsideHours === true || host?.outsideHours === true);
  const reasons = d.available ? [] : d.reasons;
  const status: TroubleshootCandidate["status"] = d.available ? "available" : outsideHours ? "outside_hours" : (reasons[0] ?? "outside_hours");
  return {
    start: d.start,
    end: d.end,
    available: d.available,
    reasons,
    status,
    outsideHours,
    limitPeriods: d.limitPeriods ?? [],
    hostLimitPeriods: host?.limitPeriods ?? [],
    blockers: (host?.blockers ?? []).map((b) => blockerOut(b, showTitles)),
  };
}

async function assertCanDiagnose(actor: TroubleshootActor, hostUserId: string): Promise<void> {
  if (hostUserId === actor.userId) return;
  if (actor.orgRole !== "owner" && actor.orgRole !== "admin") {
    throw new AppError("forbidden", "You can only troubleshoot your own availability.");
  }
  const db = await getDb();
  const [member] = await db
    .select({ userId: organizationMemberships.userId })
    .from(organizationMemberships)
    .innerJoin(users, eq(users.id, organizationMemberships.userId))
    .where(
      and(
        eq(organizationMemberships.organizationId, actor.organizationId),
        eq(organizationMemberships.userId, hostUserId),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  if (!member) throw new AppError("forbidden", "You don't have access to this person's availability.");
}

/** Standard event types the host attends, in the actor's organization (owner's own list order). */
async function eventTypesOfHost(hostUserId: string, organizationId: string): Promise<EventTypeRow[]> {
  const db = await getDb();
  const hosted = await db
    .select({ id: eventTypeHosts.eventTypeId })
    .from(eventTypeHosts)
    .where(eq(eventTypeHosts.userId, hostUserId));
  const rows = await db
    .select()
    .from(eventTypes)
    .where(
      and(
        eq(eventTypes.organizationId, organizationId),
        eq(eventTypes.type, "standard"),
        isNull(eventTypes.deletedAt),
        hosted.length
          ? or(eq(eventTypes.ownerUserId, hostUserId), inArray(eventTypes.id, hosted.map((h) => h.id)))
          : eq(eventTypes.ownerUserId, hostUserId),
      ),
    )
    .orderBy(asc(eventTypes.position), asc(eventTypes.createdAt));
  const withRel = await withRelations(db, rows);
  return withRel.filter((et) => et.hosts.length === 0 ? et.ownerUserId === hostUserId : et.hosts.some((h) => h.userId === hostUserId));
}

/**
 * Per-candidate diagnostics of a host for one or every event type over [start, end) (see the file header). Every
 * candidate start of each day is listed: available ones, blocked ones with their reasons and blockers, and starts
 * outside the working hours (status "outside_hours").
 */
export async function troubleshootAvailability(actor: TroubleshootActor, params: TroubleshootParams): Promise<TroubleshootResult> {
  const hostUserId = params.hostUserId ?? actor.userId;
  if (!isUuid(hostUserId)) throw new AppError("not_found", "This person could not be found.");
  const s = params.start.getTime();
  const e = params.end.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) throw new AppError("validation", "Choose a valid date range.");
  if (e - s > MAX_RANGE_DAYS * DAY) throw new AppError("validation", `Choose at most ${MAX_RANGE_DAYS} days.`);
  await assertCanDiagnose(actor, hostUserId);
  const showTitles = hostUserId === actor.userId;
  const now = params.now ?? clockNow();

  const db = await getDb();
  const [host] = await db
    .select({
      id: users.id,
      name: users.name,
      timezone: users.timezone,
      weekStart: users.weekStart,
      day: users.meetingLimitDay,
      week: users.meetingLimitWeek,
      month: users.meetingLimitMonth,
    })
    .from(users)
    .where(and(eq(users.id, hostUserId), isNull(users.deletedAt)))
    .limit(1);
  if (!host) throw new AppError("not_found", "This person could not be found.");

  let list: EventTypeRow[];
  if (params.eventTypeId) {
    const et = await loadEventType(params.eventTypeId);
    const hostsIt = et && (et.hosts.length === 0 ? et.ownerUserId === hostUserId : et.hosts.some((h) => h.userId === hostUserId));
    if (!et || et.organizationId !== actor.organizationId || !hostsIt) throw new AppError("not_found", "This event type could not be found.");
    list = [et];
  } else {
    list = await eventTypesOfHost(hostUserId, actor.organizationId);
  }

  const externalBusyCache = new Map();
  const entries: TroubleshootEntry[] = [];
  let first: ComputedAvailability | null = null;
  for (const et of list) {
    const allowed = allowedDurationsOf({ eventType: et });
    const duration = params.durationMinutes && allowed.includes(params.durationMinutes) ? params.durationMinutes : allowed[0]!;
    const result = await computeAvailability(
      {
        target: { kind: "event_type", eventType: et },
        start: params.start,
        end: params.end,
        durationMinutes: duration,
        now,
        troubleshoot: true,
        diagnoseOutsideHours: true,
        freshness: "page",
      },
      { externalBusyCache },
    );
    if (!first && result.prepared) first = result;
    const ctx = result.prepared?.hostContexts.find((h) => h.userId === hostUserId) ?? null;
    entries.push({
      eventType: {
        id: et.id,
        name: et.name,
        slug: et.slug,
        color: et.color,
        durationMinutes: duration,
        active: et.active,
        secret: et.secret,
        scheduleId: ctx?.scheduleId ?? null,
        scheduleName: ctx?.scheduleName ?? null,
        timeZone: result.prepared?.rangeZone ?? ctx?.scheduleZone ?? host.timezone,
        settings: {
          incrementMinutes: et.slotIncrementMinutes,
          bufferBeforeMinutes: et.bufferBeforeMinutes,
          bufferAfterMinutes: et.bufferAfterMinutes,
          minimumNoticeMinutes: et.minimumNoticeMinutes,
          dateRange: dateRangeRuleOf(et),
          limits: { day: et.limitPerDay, week: et.limitPerWeek, month: et.limitPerMonth },
        },
      },
      windowEnd: result.windowEnd,
      slots: result.slots,
      candidates: (result.diagnostics ?? []).map((d) => candidateOut(d, hostUserId, showTitles)),
    });
  }

  // The host's busy intervals in the range (one list for every event type).
  let busy: TroubleshootBlocker[];
  let calendar: TroubleshootResult["calendar"] = { status: "ok", stale: false };
  const hostInput = first?.prepared?.hosts.find((h) => h.userId === hostUserId);
  if (first?.prepared && hostInput) {
    calendar = { status: hostInput.calendarStatus, stale: first.prepared.externalStale };
    busy = hostInput.busy
      .filter((b) => b.end > s && b.start < e)
      .sort((a, b) => a.start - b.start || a.end - b.end)
      .map((b) =>
        blockerOut(
          { source: b.source, start: b.start, end: b.end, title: b.title ?? null, meetingId: b.meetingId, calendarId: b.calendarId, eventTypeId: b.eventTypeId, core: b.core, code: codeOfBusy(b, null) },
          showTitles,
        ),
      );
  } else {
    const byUser = await getBusyForUsers({ userId: actor.userId, organizationId: actor.organizationId }, [hostUserId], params.start, params.end);
    busy = (byUser[hostUserId] ?? []).map((b) =>
      blockerOut(
        { source: b.source, start: b.start, end: b.end, title: b.title ?? null, meetingId: b.meetingId, calendarId: b.calendarId, eventTypeId: b.eventTypeId, core: b.core, code: codeOfBusy(b, null) },
        showTitles,
      ),
    );
  }

  const ctx = first?.prepared?.hostContexts.find((h) => h.userId === hostUserId);
  return {
    host: { id: host.id, name: host.name, timeZone: ctx?.defaultZone ?? host.timezone, weekStart: host.weekStart === 1 ? 1 : 0 },
    hostLimits: { day: host.day, week: host.week, month: host.month },
    calendar,
    busy,
    entries,
  };
}

/**
 * Removes event titles of other people's intervals from engine diagnostics (GEN-08), for the owner troubleshoot mode
 * of the public booking page.
 */
export function redactDiagnostics(diagnostics: CandidateDiagnostic[], viewerUserId: string | null): CandidateDiagnostic[] {
  return diagnostics.map((d) => ({
    ...d,
    hosts: Object.fromEntries(
      Object.entries(d.hosts).map(([id, h]) => [
        id,
        { ...h, blockers: id === viewerUserId ? h.blockers : h.blockers.map((b) => ({ ...b, title: null })) },
      ]),
    ),
  }));
}
