// Event-type custom schedules (SPEC AV-11, AV-12, ET-19; ARCHITECTURE sections 5.4.4, 18.7), used by the event type
// editor: an event type can use one of the owner's named schedules or its own "Custom schedule" (a schedule row with
// event_type_id set, hidden from the Schedules list), and multi-host event types can give a host custom hours for the
// event (the same row shape, referenced from event_type_hosts.schedule_id).
//
// Callers authorize the event type (eventTypeAccess, owner or edit) and pass their transaction; these services check
// every schedule reference with assertScheduleUsableBy (cross-tenant ids, section 18.7) inside it.
import "server-only";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { getDb, withTx, type DbOrTx } from "@/db";
import { availabilityDateOverrides, availabilitySchedules, eventTypeHosts, eventTypes } from "@/db/schema";
import { assertScheduleUsableBy } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { now } from "@/lib/time/now";
import { zoneOrUtc } from "@/lib/time/zones";
import { isValidTimeZone } from "@/lib/validation";
import { ensureDefaultSchedule, getDefaultSchedule } from "./core";
import { dayIsValid, isIsoDate, sortIntervals, sortWeekly, weeklyIsValid, type ScheduleContent } from "./intervals";
import { getScheduleDetailById, lockUserSchedules, weeklyOf, writeOverrides, type ScheduleDetail, type ScheduleRow } from "./schedules";
import { MAX_OVERRIDES, OVERRIDE_LIMIT_MESSAGE } from "./schemas";

export type { ScheduleContent };

export type EventTypeScheduleChoice =
  /** A named schedule of the user; null = the user's default schedule. */
  | { kind: "schedule"; scheduleId: string | null }
  /** Event-only hours (AV-11). */
  | { kind: "custom"; content: ScheduleContent };

export const CUSTOM_SCHEDULE_NAME = "Custom hours";

/** Throws AppError("validation") unless the content is a valid schedule (AV-04, AV-06, AV-08). */
export function assertValidContent(content: ScheduleContent): void {
  if (!isValidTimeZone(content.timezone)) throw new AppError("validation", "Choose a valid time zone.");
  if (!Array.isArray(content.weeklyHours) || content.weeklyHours.length !== 7 || !weeklyIsValid(content.weeklyHours)) {
    throw new AppError("validation", "Times overlap with another set of times.");
  }
  if (content.overrides.length > MAX_OVERRIDES) throw new AppError("validation", OVERRIDE_LIMIT_MESSAGE);
  const seen = new Set<string>();
  for (const o of content.overrides) {
    if (!isIsoDate(o.date) || seen.has(o.date)) throw new AppError("validation", "Choose a valid date.");
    seen.add(o.date);
    if (!dayIsValid(o.intervals)) throw new AppError("validation", "Times overlap with another set of times.");
  }
}

/** The content of any live schedule (no owner check). */
export async function getScheduleContent(scheduleId: string, db?: DbOrTx): Promise<ScheduleContent | null> {
  const detail = await getScheduleDetailById(scheduleId, db);
  return detail ? { timezone: detail.timezone, weeklyHours: detail.weeklyHours, overrides: detail.overrides } : null;
}

async function liveCustomRow(db: DbOrTx, eventTypeId: string, userId: string): Promise<ScheduleRow | null> {
  const [row] = await db
    .select()
    .from(availabilitySchedules)
    .where(
      and(
        eq(availabilitySchedules.eventTypeId, eventTypeId),
        eq(availabilitySchedules.userId, userId),
        isNull(availabilitySchedules.deletedAt),
      ),
    )
    .orderBy(asc(availabilitySchedules.createdAt))
    .limit(1);
  return row ?? null;
}

/** Replaces the zone, weekly hours and every override of a schedule row (validated). */
export async function saveScheduleContent(db: DbOrTx, scheduleId: string, content: ScheduleContent): Promise<void> {
  assertValidContent(content);
  await withTx(db, async (tx) => {
    await tx
      .update(availabilitySchedules)
      .set({ timezone: content.timezone, weeklyHours: sortWeekly(content.weeklyHours), updatedAt: now() })
      .where(eq(availabilitySchedules.id, scheduleId));
    await tx.delete(availabilityDateOverrides).where(eq(availabilityDateOverrides.scheduleId, scheduleId));
    if (content.overrides.length) {
      await tx
        .insert(availabilityDateOverrides)
        .values(content.overrides.map((o) => ({ scheduleId, date: o.date, intervals: sortIntervals(o.intervals) })));
    }
  });
}

/**
 * Creates the custom schedule of (event type, user) or returns the existing one. It starts as a copy of `from` (a
 * schedule id usable by the user, or explicit content), else of the user's default schedule (ET-19 acceptance).
 */
export async function createCustomSchedule(
  db: DbOrTx,
  input: { eventTypeId: string; userId: string; from?: string | ScheduleContent | null },
): Promise<ScheduleRow> {
  if (!isUuid(input.eventTypeId) || !isUuid(input.userId)) throw new AppError("not_found", "This event type could not be found.");
  return withTx(db, async (tx) => {
    await lockUserSchedules(tx, input.userId);
    const existing = await liveCustomRow(tx, input.eventTypeId, input.userId);
    if (existing) return existing;
    let content: ScheduleContent;
    if (input.from && typeof input.from === "object") {
      content = input.from;
    } else {
      let sourceId = input.from ?? null;
      if (sourceId) await assertScheduleUsableBy(tx, sourceId, [input.userId], { eventTypeId: input.eventTypeId });
      sourceId ??= (await ensureDefaultSchedule(tx, input.userId)).id;
      const source = await getScheduleDetailById(sourceId, tx);
      if (!source) throw new AppError("not_found", "This schedule could not be found.");
      content = { timezone: source.timezone, weeklyHours: source.weeklyHours, overrides: source.overrides };
    }
    assertValidContent(content);
    const [row] = await tx
      .insert(availabilitySchedules)
      .values({
        userId: input.userId,
        eventTypeId: input.eventTypeId,
        name: CUSTOM_SCHEDULE_NAME,
        timezone: zoneOrUtc(content.timezone),
        isDefault: false,
        weeklyHours: sortWeekly(content.weeklyHours),
      })
      .returning();
    if (!row) throw new Error("createCustomSchedule: insert returned no row");
    if (content.overrides.length) {
      const byIntervals = new Map<string, string[]>();
      for (const o of content.overrides) {
        const key = JSON.stringify(sortIntervals(o.intervals));
        byIntervals.set(key, [...(byIntervals.get(key) ?? []), o.date]);
      }
      for (const [key, dates] of byIntervals) await writeOverrides(tx, row.id, dates, JSON.parse(key));
    }
    return row;
  });
}

/** Soft-deletes the custom schedules of an event type (one user's, or every user's), except `keepId`. */
export async function deleteCustomSchedules(
  db: DbOrTx,
  input: { eventTypeId: string; userId?: string | null; keepId?: string | null },
): Promise<number> {
  const conds = [eq(availabilitySchedules.eventTypeId, input.eventTypeId), isNull(availabilitySchedules.deletedAt)];
  if (input.userId) conds.push(eq(availabilitySchedules.userId, input.userId));
  if (input.keepId) conds.push(ne(availabilitySchedules.id, input.keepId));
  const stamp = now();
  const rows = await db
    .update(availabilitySchedules)
    .set({ deletedAt: stamp, updatedAt: stamp })
    .where(and(...conds))
    .returning({ id: availabilitySchedules.id });
  return rows.length;
}

export type EventTypeScheduleState = {
  /** The schedule in use: a named schedule, the custom one, or the default (null only without any schedule). */
  scheduleId: string | null;
  custom: boolean;
  schedule: ScheduleDetail | null;
};

/**
 * The schedule an event type uses for a host (the editor's "Schedule:" value), resolved like the availability service:
 * the host row's schedule, else the event type's schedule when usable by the host, else the host's default.
 */
export async function resolveEventTypeSchedule(eventTypeId: string, userId: string, db?: DbOrTx): Promise<EventTypeScheduleState> {
  const d = db ?? (await getDb());
  if (!isUuid(eventTypeId) || !isUuid(userId)) return { scheduleId: null, custom: false, schedule: null };
  const [et] = await d
    .select({ scheduleId: eventTypes.scheduleId, availabilitySetting: eventTypes.availabilitySetting })
    .from(eventTypes)
    .where(and(eq(eventTypes.id, eventTypeId), isNull(eventTypes.deletedAt)))
    .limit(1);
  if (!et) return { scheduleId: null, custom: false, schedule: null };
  const [host] = await d
    .select({ scheduleId: eventTypeHosts.scheduleId })
    .from(eventTypeHosts)
    .where(and(eq(eventTypeHosts.eventTypeId, eventTypeId), eq(eventTypeHosts.userId, userId)))
    .limit(1);
  const candidates = et.availabilitySetting === "shared" ? [et.scheduleId, host?.scheduleId] : [host?.scheduleId, et.scheduleId];
  for (const id of candidates) {
    if (!id) continue;
    const [row] = await d
      .select()
      .from(availabilitySchedules)
      .where(and(eq(availabilitySchedules.id, id), isNull(availabilitySchedules.deletedAt)))
      .limit(1);
    if (!row || row.singleUseLinkId) continue;
    if (row.eventTypeId && row.eventTypeId !== eventTypeId) continue;
    if (!row.eventTypeId && row.userId !== userId && et.availabilitySetting !== "shared") continue;
    return { scheduleId: row.id, custom: Boolean(row.eventTypeId), schedule: await getScheduleDetailById(row.id, d) };
  }
  const fallback = await getDefaultSchedule(userId, d);
  const chosen = fallback ? await getScheduleDetailById(fallback.id, d) : null;
  return { scheduleId: chosen?.id ?? null, custom: false, schedule: chosen };
}

/**
 * Saves an event type's schedule choice (AV-11, AV-12, ET-19) for `userId` (the owner for solo types; a host for
 * per-host hours with scope "host"):
 * - "schedule": points the event type (scope "event") or the host row (scope "host") at the named schedule (null = the
 *   default) and deletes this user's custom schedule of the event type ("Switching back to a named schedule deletes
 *   the custom one");
 * - "custom": creates or updates the custom schedule with `content` and points the event type or host row at it.
 */
export async function setEventTypeSchedule(
  db: DbOrTx,
  input: { eventTypeId: string; userId: string; scope?: "event" | "host"; choice: EventTypeScheduleChoice },
): Promise<{ scheduleId: string | null; custom: boolean }> {
  const scope = input.scope ?? "event";
  if (!isUuid(input.eventTypeId) || !isUuid(input.userId)) throw new AppError("not_found", "This event type could not be found.");
  return withTx(db, async (tx) => {
    await lockUserSchedules(tx, input.userId);
    const [et] = await tx
      .select({ id: eventTypes.id })
      .from(eventTypes)
      .where(and(eq(eventTypes.id, input.eventTypeId), isNull(eventTypes.deletedAt)))
      .limit(1);
    if (!et) throw new AppError("not_found", "This event type could not be found.");
    const stamp = now();
    const point = async (scheduleId: string | null) => {
      if (scope === "event") {
        await tx.update(eventTypes).set({ scheduleId, updatedAt: stamp }).where(eq(eventTypes.id, input.eventTypeId));
        await tx
          .update(eventTypeHosts)
          .set({ scheduleId: null, updatedAt: stamp })
          .where(and(eq(eventTypeHosts.eventTypeId, input.eventTypeId), eq(eventTypeHosts.userId, input.userId)));
      } else {
        const updated = await tx
          .update(eventTypeHosts)
          .set({ scheduleId, updatedAt: stamp })
          .where(and(eq(eventTypeHosts.eventTypeId, input.eventTypeId), eq(eventTypeHosts.userId, input.userId)))
          .returning({ id: eventTypeHosts.id });
        if (updated.length === 0) throw new AppError("not_found", "This host is not part of the event type.");
      }
    };

    if (input.choice.kind === "schedule") {
      const scheduleId = input.choice.scheduleId;
      if (scheduleId) await assertScheduleUsableBy(tx, scheduleId, [input.userId]);
      await point(scheduleId);
      await deleteCustomSchedules(tx, { eventTypeId: input.eventTypeId, userId: input.userId });
      return { scheduleId, custom: false };
    }

    assertValidContent(input.choice.content);
    let row = await liveCustomRow(tx, input.eventTypeId, input.userId);
    if (row) {
      await saveScheduleContent(tx, row.id, input.choice.content);
    } else {
      row = await createCustomSchedule(tx, { eventTypeId: input.eventTypeId, userId: input.userId, from: input.choice.content });
    }
    await point(row.id);
    await deleteCustomSchedules(tx, { eventTypeId: input.eventTypeId, userId: input.userId, keepId: row.id });
    return { scheduleId: row.id, custom: true };
  });
}

/** The weekly hours of a schedule row, normalized (re-exported for the editor's summaries). */
export { weeklyOf };
