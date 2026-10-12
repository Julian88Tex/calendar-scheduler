// Named schedule services (SPEC AV-02, AV-03, AV-04, AV-06, AV-08, AV-09, AV-15; ARCHITECTURE sections 5.4.4, 18.7).
//
// Personal ("named") schedules are availability_schedules rows without event_type_id and single_use_link_id. Every
// mutation runs in one transaction holding the user's availability advisory lock, so the default schedule invariant
// (exactly one live default, schedules_one_default_uq) and the count limits hold under concurrent requests from
// several tabs. Callers (server actions) authenticate; every function here checks that the schedule belongs to the
// user. Event types reference schedules through event_types.schedule_id (and event_type_hosts.schedule_id for
// per-host hours); a null reference means the user's default schedule.
import "server-only";
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { getDb, withTx, type DbOrTx } from "@/db";
import { advisoryXactLock } from "@/db/helpers";
import { availabilityDateOverrides, availabilitySchedules, eventTypeHosts, eventTypes, singleUseLinks } from "@/db/schema";
import type { MinuteRange, WeeklyHours } from "@/db/types";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { now } from "@/lib/time/now";
import { zoneOrUtc } from "@/lib/time/zones";
import { isValidTimeZone } from "@/lib/validation";
import { ensureDefaultSchedule } from "./core";
import { sortIntervals, sortOverrides, sortWeekly, weeklyIsValid, type DateOverride } from "./intervals";
import { MAX_OVERRIDES, MAX_SCHEDULES, OVERRIDE_LIMIT_MESSAGE, SCHEDULE_LIMIT_MESSAGE, SCHEDULE_NAME_MAX } from "./schemas";
import type { ActiveOnEventType, ScheduleDetail, ScheduleSummary } from "./types";

export type { ActiveOnEventType, ScheduleDetail, ScheduleSummary } from "./types";

export type ScheduleRow = typeof availabilitySchedules.$inferSelect;

const NOT_FOUND = "This schedule could not be found.";

/** Serializes the user's schedule mutations (default invariant, count limits). */
export async function lockUserSchedules(tx: DbOrTx, userId: string): Promise<void> {
  await advisoryXactLock(tx, `availability:${userId}`);
}

export const personalScheduleWhere = (userId: string) =>
  and(
    eq(availabilitySchedules.userId, userId),
    isNull(availabilitySchedules.eventTypeId),
    isNull(availabilitySchedules.singleUseLinkId),
    isNull(availabilitySchedules.deletedAt),
  );

/** A live personal schedule of the user, or AppError not_found. */
export async function loadOwnedSchedule(db: DbOrTx, userId: string, scheduleId: string): Promise<ScheduleRow> {
  if (!isUuid(scheduleId)) throw new AppError("not_found", NOT_FOUND);
  const [row] = await db
    .select()
    .from(availabilitySchedules)
    .where(and(eq(availabilitySchedules.id, scheduleId), personalScheduleWhere(userId)))
    .limit(1);
  if (!row) throw new AppError("not_found", NOT_FOUND);
  return row;
}

/** Normalized weekly hours of a row (seven arrays, sorted, invalid entries dropped). */
export function weeklyOf(row: Pick<ScheduleRow, "weeklyHours">): WeeklyHours {
  const raw = Array.isArray(row.weeklyHours) ? row.weeklyHours : [];
  return Array.from({ length: 7 }, (_, d) =>
    sortIntervals(
      (Array.isArray(raw[d]) ? raw[d] : []).filter(
        (r): r is MinuteRange =>
          Boolean(r) && Number.isInteger(r.start) && Number.isInteger(r.end) && r.start >= 0 && r.end <= 1440 && r.end > r.start,
      ),
    ),
  ) as WeeklyHours;
}

async function overridesOf(db: DbOrTx, scheduleId: string): Promise<DateOverride[]> {
  const rows = await db
    .select({ date: availabilityDateOverrides.date, intervals: availabilityDateOverrides.intervals })
    .from(availabilityDateOverrides)
    .where(eq(availabilityDateOverrides.scheduleId, scheduleId))
    .orderBy(asc(availabilityDateOverrides.date));
  return rows.map((r) => ({ date: r.date, intervals: sortIntervals(Array.isArray(r.intervals) ? r.intervals : []) }));
}

export function toDetail(row: ScheduleRow, overrides: DateOverride[]): ScheduleDetail {
  return {
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    timezone: zoneOrUtc(row.timezone),
    weeklyHours: weeklyOf(row),
    overrides: sortOverrides(overrides),
    eventTypeId: row.eventTypeId,
  };
}

/** Any live schedule (personal or custom) with its overrides, without an owner check (callers authorize). */
export async function getScheduleDetailById(scheduleId: string, db?: DbOrTx): Promise<ScheduleDetail | null> {
  if (!isUuid(scheduleId)) return null;
  const d = db ?? (await getDb());
  const [row] = await d
    .select()
    .from(availabilitySchedules)
    .where(and(eq(availabilitySchedules.id, scheduleId), isNull(availabilitySchedules.deletedAt)))
    .limit(1);
  if (!row) return null;
  return toDetail(row, await overridesOf(d, row.id));
}

/** A personal schedule of the user with every override, or null. */
export async function getSchedule(userId: string, scheduleId: string, db?: DbOrTx): Promise<ScheduleDetail | null> {
  if (!isUuid(scheduleId)) return null;
  const d = db ?? (await getDb());
  const [row] = await d
    .select()
    .from(availabilitySchedules)
    .where(and(eq(availabilitySchedules.id, scheduleId), personalScheduleWhere(userId)))
    .limit(1);
  if (!row) return null;
  return toDetail(row, await overridesOf(d, row.id));
}

/**
 * The user's personal schedules: the default first, then by creation. `eventTypeCount` counts the event types that
 * reference each schedule (and, for the default, the event types without a schedule of their own).
 */
export async function listSchedules(userId: string, db?: DbOrTx): Promise<ScheduleSummary[]> {
  const d = db ?? (await getDb());
  const rows = await d
    .select()
    .from(availabilitySchedules)
    .where(personalScheduleWhere(userId))
    .orderBy(desc(availabilitySchedules.isDefault), asc(availabilitySchedules.createdAt));
  if (rows.length === 0) return [];
  const usage = await scheduleUsage(d, rows.map((r) => r.id));
  const defaultUsers = await d
    .select({ n: count() })
    .from(eventTypes)
    .where(
      and(
        eq(eventTypes.ownerUserId, userId),
        eq(eventTypes.scope, "personal"),
        eq(eventTypes.type, "standard"),
        isNull(eventTypes.deletedAt),
        isNull(eventTypes.scheduleId),
      ),
    );
  const implicit = Number(defaultUsers[0]?.n ?? 0);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isDefault: r.isDefault,
    timezone: zoneOrUtc(r.timezone),
    eventTypeCount: (usage.get(r.id)?.size ?? 0) + (r.isDefault ? implicit : 0),
  }));
}

/** Distinct live event types referencing each schedule (event level and host level). */
async function scheduleUsage(db: DbOrTx, scheduleIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (scheduleIds.length === 0) return out;
  const direct = await db
    .select({ scheduleId: eventTypes.scheduleId, eventTypeId: eventTypes.id })
    .from(eventTypes)
    .where(and(inArray(eventTypes.scheduleId, scheduleIds), isNull(eventTypes.deletedAt), eq(eventTypes.type, "standard")));
  const hosts = await db
    .select({ scheduleId: eventTypeHosts.scheduleId, eventTypeId: eventTypeHosts.eventTypeId })
    .from(eventTypeHosts)
    .innerJoin(eventTypes, eq(eventTypes.id, eventTypeHosts.eventTypeId))
    .where(and(inArray(eventTypeHosts.scheduleId, scheduleIds), isNull(eventTypes.deletedAt), eq(eventTypes.type, "standard")));
  for (const r of [...direct, ...hosts]) {
    if (!r.scheduleId) continue;
    let set = out.get(r.scheduleId);
    if (!set) out.set(r.scheduleId, (set = new Set()));
    set.add(r.eventTypeId);
  }
  return out;
}

async function personalCount(db: DbOrTx, userId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(availabilitySchedules).where(personalScheduleWhere(userId));
  return Number(row?.n ?? 0);
}

/** "{name} (copy)", shortened to fit the 60 character limit. */
export function copyName(name: string): string {
  const suffix = " (copy)";
  const base = name.trim().slice(0, SCHEDULE_NAME_MAX - suffix.length).trimEnd();
  return `${base}${suffix}`;
}

/**
 * Creates a named schedule (AV-02): it starts with the default schedule's weekly hours and time zone (our choice).
 * The user's first schedule becomes the default.
 */
export async function createSchedule(db: DbOrTx, userId: string, input: { name: string; timezone?: string | null }): Promise<ScheduleRow> {
  return withTx(db, async (tx) => {
    await lockUserSchedules(tx, userId);
    if ((await personalCount(tx, userId)) >= MAX_SCHEDULES) throw new AppError("conflict", SCHEDULE_LIMIT_MESSAGE);
    const [existingDefault] = await tx
      .select()
      .from(availabilitySchedules)
      .where(and(personalScheduleWhere(userId), eq(availabilitySchedules.isDefault, true)))
      .limit(1);
    if (!existingDefault) {
      const created = await ensureDefaultSchedule(tx, userId, { timezone: input.timezone, name: input.name });
      return created;
    }
    const [row] = await tx
      .insert(availabilitySchedules)
      .values({
        userId,
        name: input.name.trim(),
        timezone: zoneOrUtc(existingDefault.timezone),
        isDefault: false,
        weeklyHours: weeklyOf(existingDefault),
      })
      .returning();
    if (!row) throw new Error("createSchedule: insert returned no row");
    return row;
  });
}

export async function renameSchedule(db: DbOrTx, userId: string, scheduleId: string, name: string): Promise<ScheduleRow> {
  return withTx(db, async (tx) => {
    await lockUserSchedules(tx, userId);
    await loadOwnedSchedule(tx, userId, scheduleId);
    const [row] = await tx
      .update(availabilitySchedules)
      .set({ name: name.trim(), updatedAt: now() })
      .where(eq(availabilitySchedules.id, scheduleId))
      .returning();
    if (!row) throw new AppError("not_found", NOT_FOUND);
    return row;
  });
}

/**
 * Makes the schedule the default (AV-02, AV-15). The default label moves and new event types use it; personal event
 * types that relied on the previous default implicitly (schedule_id null) are pinned to it so their hours do not change.
 */
export async function setDefaultSchedule(db: DbOrTx, userId: string, scheduleId: string): Promise<ScheduleRow> {
  return withTx(db, async (tx) => {
    await lockUserSchedules(tx, userId);
    const target = await loadOwnedSchedule(tx, userId, scheduleId);
    if (target.isDefault) return target;
    const [previous] = await tx
      .select()
      .from(availabilitySchedules)
      .where(and(personalScheduleWhere(userId), eq(availabilitySchedules.isDefault, true)))
      .limit(1);
    if (previous) {
      await tx
        .update(eventTypes)
        .set({ scheduleId: previous.id, updatedAt: now() })
        .where(
          and(
            eq(eventTypes.ownerUserId, userId),
            eq(eventTypes.scope, "personal"),
            isNull(eventTypes.scheduleId),
            isNull(eventTypes.deletedAt),
          ),
        );
      await tx.update(availabilitySchedules).set({ isDefault: false, updatedAt: now() }).where(eq(availabilitySchedules.id, previous.id));
    }
    const [row] = await tx
      .update(availabilitySchedules)
      .set({ isDefault: true, updatedAt: now() })
      .where(eq(availabilitySchedules.id, scheduleId))
      .returning();
    if (!row) throw new AppError("not_found", NOT_FOUND);
    return row;
  });
}

/** Copies a schedule with its weekly hours, time zone and date-specific hours as "{name} (copy)" (not the default). */
export async function cloneSchedule(db: DbOrTx, userId: string, scheduleId: string): Promise<ScheduleRow> {
  return withTx(db, async (tx) => {
    await lockUserSchedules(tx, userId);
    const source = await loadOwnedSchedule(tx, userId, scheduleId);
    if ((await personalCount(tx, userId)) >= MAX_SCHEDULES) throw new AppError("conflict", SCHEDULE_LIMIT_MESSAGE);
    const [row] = await tx
      .insert(availabilitySchedules)
      .values({
        userId,
        name: copyName(source.name),
        timezone: zoneOrUtc(source.timezone),
        isDefault: false,
        weeklyHours: weeklyOf(source),
      })
      .returning();
    if (!row) throw new Error("cloneSchedule: insert returned no row");
    const overrides = await overridesOf(tx, source.id);
    if (overrides.length) {
      await tx.insert(availabilityDateOverrides).values(overrides.map((o) => ({ scheduleId: row.id, date: o.date, intervals: o.intervals })));
    }
    return row;
  });
}

/**
 * Deletes a named schedule (AV-02). The default schedule cannot be deleted ("Set another schedule as default
 * first."). Event types, per-host hours and single-use links using it switch to `replacementId` (default: the default
 * schedule). Soft delete; overrides are kept with the row.
 */
export async function deleteSchedule(
  db: DbOrTx,
  userId: string,
  scheduleId: string,
  opts: { replacementId?: string | null } = {},
): Promise<{ reassigned: number; replacementId: string }> {
  return withTx(db, async (tx) => {
    await lockUserSchedules(tx, userId);
    const target = await loadOwnedSchedule(tx, userId, scheduleId);
    if (target.isDefault) throw new AppError("conflict", "Set another schedule as default first.");
    const defaultRow = await ensureDefaultSchedule(tx, userId, { timezone: target.timezone });
    const replacementId = opts.replacementId ?? defaultRow.id;
    if (replacementId === scheduleId) throw new AppError("validation", "Choose another schedule for these event types.");
    await loadOwnedSchedule(tx, userId, replacementId);

    const usage = (await scheduleUsage(tx, [scheduleId])).get(scheduleId)?.size ?? 0;
    const stamp = now();
    await tx.update(eventTypes).set({ scheduleId: replacementId, updatedAt: stamp }).where(eq(eventTypes.scheduleId, scheduleId));
    await tx.update(eventTypeHosts).set({ scheduleId: replacementId, updatedAt: stamp }).where(eq(eventTypeHosts.scheduleId, scheduleId));
    await tx.update(singleUseLinks).set({ scheduleId: replacementId }).where(eq(singleUseLinks.scheduleId, scheduleId));
    await tx
      .update(availabilitySchedules)
      .set({ deletedAt: stamp, isDefault: false, updatedAt: stamp })
      .where(eq(availabilitySchedules.id, scheduleId));
    return { reassigned: usage, replacementId };
  });
}

/** Replaces the weekly hours (validated: no inverted or overlapping intervals; touching allowed; stored sorted). */
export async function updateWeeklyHours(db: DbOrTx, userId: string, scheduleId: string, weeklyHours: WeeklyHours): Promise<void> {
  if (!weeklyIsValid(weeklyHours)) throw new AppError("validation", "Times overlap with another set of times.");
  await withTx(db, async (tx) => {
    await loadOwnedSchedule(tx, userId, scheduleId);
    await tx
      .update(availabilitySchedules)
      .set({ weeklyHours: sortWeekly(weeklyHours), updatedAt: now() })
      .where(eq(availabilitySchedules.id, scheduleId));
  });
}

/** Changes the schedule zone (AV-08): wall-clock hours stay the same, so the UTC slots move with the zone. */
export async function updateScheduleTimezone(db: DbOrTx, userId: string, scheduleId: string, timezone: string): Promise<void> {
  if (!isValidTimeZone(timezone)) throw new AppError("validation", "Choose a valid time zone.", { fieldErrors: { timezone: ["Choose a valid time zone."] } });
  await withTx(db, async (tx) => {
    await loadOwnedSchedule(tx, userId, scheduleId);
    await tx.update(availabilitySchedules).set({ timezone, updatedAt: now() }).where(eq(availabilitySchedules.id, scheduleId));
  });
}

/** Number of overrides of a schedule, not counting `excludingDates`. */
async function overrideCount(db: DbOrTx, scheduleId: string, excludingDates: string[]): Promise<number> {
  const conds = [eq(availabilityDateOverrides.scheduleId, scheduleId)];
  if (excludingDates.length) conds.push(sql`${availabilityDateOverrides.date} not in (${sql.join(excludingDates.map((d) => sql`${d}`), sql`, `)})`);
  const [row] = await db.select({ n: count() }).from(availabilityDateOverrides).where(and(...conds));
  return Number(row?.n ?? 0);
}

/**
 * Sets date-specific hours for dates of any schedule row (AV-06): each date's hours are replaced entirely; empty
 * intervals mark the date unavailable. At most 1,000 overrides per schedule. No owner check (internal).
 */
export async function writeOverrides(tx: DbOrTx, scheduleId: string, dates: readonly string[], intervals: readonly MinuteRange[]): Promise<void> {
  const unique = [...new Set(dates)].sort();
  if (unique.length === 0) return;
  const existing = await overrideCount(tx, scheduleId, unique);
  if (existing + unique.length > MAX_OVERRIDES) throw new AppError("conflict", OVERRIDE_LIMIT_MESSAGE);
  const sorted = sortIntervals(intervals);
  const stamp = now();
  await tx
    .insert(availabilityDateOverrides)
    .values(unique.map((date) => ({ scheduleId, date, intervals: sorted })))
    .onConflictDoUpdate({
      target: [availabilityDateOverrides.scheduleId, availabilityDateOverrides.date],
      set: { intervals: sql`excluded.intervals`, updatedAt: stamp },
    });
}

/** Date-specific hours of the user's schedule (AV-06). */
export async function upsertDateOverrides(
  db: DbOrTx,
  userId: string,
  scheduleId: string,
  input: { dates: readonly string[]; intervals: readonly MinuteRange[] },
): Promise<void> {
  await withTx(db, async (tx) => {
    await lockUserSchedules(tx, userId);
    await loadOwnedSchedule(tx, userId, scheduleId);
    await writeOverrides(tx, scheduleId, input.dates, input.intervals);
    await tx.update(availabilitySchedules).set({ updatedAt: now() }).where(eq(availabilitySchedules.id, scheduleId));
  });
}

export async function deleteDateOverride(db: DbOrTx, userId: string, scheduleId: string, date: string): Promise<void> {
  await withTx(db, async (tx) => {
    await loadOwnedSchedule(tx, userId, scheduleId);
    await tx
      .delete(availabilityDateOverrides)
      .where(and(eq(availabilityDateOverrides.scheduleId, scheduleId), eq(availabilityDateOverrides.date, date)));
    await tx.update(availabilitySchedules).set({ updatedAt: now() }).where(eq(availabilitySchedules.id, scheduleId));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// "Active on" (AV-09): which personal event types a schedule drives.

type EventTypeRef = { id: string; scheduleId: string | null };

/** Personal single-host standard event types of the user, in their list order. */
async function personalEventTypes(db: DbOrTx, userId: string) {
  return db
    .select({
      id: eventTypes.id,
      name: eventTypes.name,
      color: eventTypes.color,
      active: eventTypes.active,
      secret: eventTypes.secret,
      durationMinutes: eventTypes.durationMinutes,
      durationOptions: eventTypes.durationOptions,
      scheduleId: eventTypes.scheduleId,
    })
    .from(eventTypes)
    .where(
      and(
        eq(eventTypes.ownerUserId, userId),
        eq(eventTypes.scope, "personal"),
        eq(eventTypes.type, "standard"),
        isNull(eventTypes.poolingType),
        isNull(eventTypes.deletedAt),
      ),
    )
    .orderBy(asc(eventTypes.position), asc(eventTypes.createdAt));
}

/**
 * The schedule each event type uses for the user, like the availability service (booking-core section 8 step 1):
 * the user's host-level schedule, else the event type's schedule when it is the user's (named or custom), else the
 * default schedule.
 */
export async function effectiveSchedules(
  db: DbOrTx,
  userId: string,
  list: readonly EventTypeRef[],
): Promise<Map<string, { scheduleId: string | null; custom: boolean }>> {
  const out = new Map<string, { scheduleId: string | null; custom: boolean }>();
  if (list.length === 0) return out;
  const schedules = await db
    .select({ id: availabilitySchedules.id, isDefault: availabilitySchedules.isDefault, eventTypeId: availabilitySchedules.eventTypeId, singleUseLinkId: availabilitySchedules.singleUseLinkId })
    .from(availabilitySchedules)
    .where(and(eq(availabilitySchedules.userId, userId), isNull(availabilitySchedules.deletedAt)))
    .orderBy(desc(availabilitySchedules.isDefault), asc(availabilitySchedules.createdAt));
  const byId = new Map(schedules.map((s) => [s.id, s]));
  const named = schedules.filter((s) => !s.eventTypeId && !s.singleUseLinkId);
  const defaultId = named.find((s) => s.isDefault)?.id ?? named[0]?.id ?? null;
  const hostRows = await db
    .select({ eventTypeId: eventTypeHosts.eventTypeId, scheduleId: eventTypeHosts.scheduleId })
    .from(eventTypeHosts)
    .where(and(eq(eventTypeHosts.userId, userId), inArray(eventTypeHosts.eventTypeId, list.map((e) => e.id)), isNotNull(eventTypeHosts.scheduleId)));
  const hostSchedule = new Map(hostRows.map((h) => [h.eventTypeId, h.scheduleId]));
  const usable = (id: string | null | undefined, eventTypeId: string) => {
    if (!id) return null;
    const s = byId.get(id);
    if (!s || s.singleUseLinkId) return null;
    if (s.eventTypeId && s.eventTypeId !== eventTypeId) return null;
    return s;
  };
  for (const et of list) {
    const chosen = usable(hostSchedule.get(et.id), et.id) ?? usable(et.scheduleId, et.id);
    if (chosen) out.set(et.id, { scheduleId: chosen.id, custom: Boolean(chosen.eventTypeId) });
    else out.set(et.id, { scheduleId: defaultId, custom: false });
  }
  return out;
}

/** The personal event types of the user with the schedule each one uses (the "Active on" checklist). */
export async function listActiveOnEventTypes(userId: string, db?: DbOrTx): Promise<ActiveOnEventType[]> {
  const d = db ?? (await getDb());
  const rows = await personalEventTypes(d, userId);
  const effective = await effectiveSchedules(d, userId, rows);
  return rows.map((r) => {
    const e = effective.get(r.id);
    const options = (r.durationOptions ?? []).filter((n) => Number.isInteger(n) && n > 0);
    return {
      id: r.id,
      name: r.name,
      color: r.color,
      active: r.active,
      secret: r.secret,
      durationMinutes: r.durationMinutes,
      durationOptions: options.length ? [...new Set([r.durationMinutes, ...options])].sort((a, b) => a - b) : [r.durationMinutes],
      scheduleId: e?.scheduleId ?? null,
      custom: e?.custom ?? false,
    };
  });
}

/** Points a personal event type at a named schedule and removes its custom schedules (AV-09, AV-11). */
async function assignEventType(tx: DbOrTx, userId: string, eventTypeId: string, scheduleId: string): Promise<void> {
  const stamp = now();
  await tx.update(eventTypes).set({ scheduleId, updatedAt: stamp }).where(eq(eventTypes.id, eventTypeId));
  await tx
    .update(eventTypeHosts)
    .set({ scheduleId: null, updatedAt: stamp })
    .where(and(eq(eventTypeHosts.eventTypeId, eventTypeId), eq(eventTypeHosts.userId, userId)));
  await tx
    .update(availabilitySchedules)
    .set({ deletedAt: stamp, updatedAt: stamp })
    .where(
      and(
        eq(availabilitySchedules.eventTypeId, eventTypeId),
        eq(availabilitySchedules.userId, userId),
        ne(availabilitySchedules.id, scheduleId),
        isNull(availabilitySchedules.deletedAt),
      ),
    );
}

export const CUSTOM_HOURS_CONFLICT_MESSAGE = "Some of these event types use custom hours. Confirm to replace them.";

/**
 * Applies the "Active on" checklist (AV-09): checked event types use this schedule; unchecked ones that used it move
 * to the default schedule (the default schedule's own event types cannot be unchecked: they have nowhere else to go).
 * Checking an event type with custom hours replaces them only with `replaceCustom` (else a conflict listing them).
 */
export async function setScheduleEventTypes(
  db: DbOrTx,
  userId: string,
  scheduleId: string,
  input: { eventTypeIds: readonly string[]; replaceCustom?: boolean },
): Promise<{ changed: number }> {
  return withTx(db, async (tx) => {
    await lockUserSchedules(tx, userId);
    const schedule = await loadOwnedSchedule(tx, userId, scheduleId);
    const defaultRow = await ensureDefaultSchedule(tx, userId, { timezone: schedule.timezone });
    const list = await personalEventTypes(tx, userId);
    const known = new Set(list.map((e) => e.id));
    const wanted = new Set(input.eventTypeIds);
    for (const id of wanted) if (!known.has(id)) throw new AppError("forbidden", "You don't have access to one of the selected items.");
    const effective = await effectiveSchedules(tx, userId, list);

    const customConflicts: string[] = [];
    const changes: { id: string; to: string }[] = [];
    for (const et of list) {
      const current = effective.get(et.id);
      const isOn = current?.scheduleId === scheduleId;
      if (wanted.has(et.id) && !isOn) {
        if (current?.custom && !input.replaceCustom) customConflicts.push(et.id);
        else changes.push({ id: et.id, to: scheduleId });
      } else if (!wanted.has(et.id) && isOn && !schedule.isDefault) {
        changes.push({ id: et.id, to: defaultRow.id });
      }
    }
    if (customConflicts.length) {
      throw new AppError("conflict", CUSTOM_HOURS_CONFLICT_MESSAGE, { details: { customEventTypeIds: customConflicts } });
    }
    for (const c of changes) await assignEventType(tx, userId, c.id, c.to);
    return { changed: changes.length };
  });
}
