// OWNER: calendar-integrations.
//
// Provider events this app writes (SPEC CAL-11, CAL-12, CAL-13, CAL-18, VID-07; ARCHITECTURE 10.2 and 12.4).
//
// - upsertLinkedEvent: one calendar_linked_events row per purpose, entity (scheduled event, poll option, one-off spot)
//   and user, keyed by an idempotency key, created before the provider call. The Google event id derives from that row
//   (hyphen-less UUID, valid base32hex), so a retry after a timeout hits 409 and resolves to the event the first
//   attempt created: a booking produces exactly one provider event. An existing row (by id, or by entity) is updated
//   instead (group slots: one provider event per slot, patched on every join and cancellation). When the provider
//   event was deleted meanwhile, a new one is created under a new deterministic id. Writes carry the private
//   properties kairosEventId, kairosPurpose and kairosLinkedEventId (CAL-18 matching).
// - Buffer events (CAL-13): after a meeting write, a destination calendar with "Include buffers on this calendar"
//   gets "Buffer: {title}" busy events for the before and after buffers (kept in sync, deleted when no longer wanted).
// - deleteLinkedEvent: deletes the provider event (with or without notifying attendees) and the meeting's buffer
//   events; transient failures retry in a job.
// - repointLinkedEvents: reschedule continuity (the provider event now belongs to the new scheduled event).
import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { calendarConnections, calendarLinkedEvents, calendars, scheduledEvents } from "@/db/schema";
import { assertCalendarOwnedBy } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { enqueueJob } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { now } from "@/lib/time/now";
import { getDestinationCalendar } from "./connections";
import { withConnection } from "./credentials";
import { readGoogleConference } from "./providers/google";
import { getProvider } from "./providers/registry";
import {
  isProviderAuthError,
  isProviderGone,
  isProviderRequestError,
  isProviderTransientError,
  type WriteEventInput,
  type WriteEventResult,
} from "./providers/types";

export const LINKED_EVENT_RETRY_JOB = "calendars.linked_event_retry";

export type LinkedEventPurpose = "meeting" | "buffer_before" | "buffer_after" | "one_off_hold" | "poll_hold";

export type LinkedEventInput = {
  userId: string;
  purpose: LinkedEventPurpose;
  scheduledEventId?: string;
  oneOffMeetingId?: string;
  oneOffSpotId?: string;
  pollId?: string;
  pollOptionId?: string;
  /** Default: the user's destination (or the event type override). */
  calendarId?: string;
  event: Omit<WriteEventInput, "idempotencyKey" | "privateProperties">;
  /** Update instead of create. */
  existingLinkedEventId?: string;
};

export type UpsertLinkedEventResult = {
  linkedEventId: string;
  externalId: string | null;
  icalUid?: string | null;
  htmlLink?: string | null;
  conference?: WriteEventResult["conference"];
  status: "synced" | "pending" | "failed" | "skipped_no_calendar";
};

type LinkedRow = typeof calendarLinkedEvents.$inferSelect;
type TargetCalendar = { calendarId: string; externalId: string; connectionId: string; provider: (typeof calendarConnections.$inferSelect)["provider"]; includeBuffers: boolean; status: string };

const BUFFER_PURPOSES = ["buffer_before", "buffer_after"] as const;

/** The entity a linked event belongs to (one provider event per purpose, entity and user). */
function entityOf(input: Pick<LinkedEventInput, "purpose" | "scheduledEventId" | "oneOffSpotId" | "oneOffMeetingId" | "pollOptionId" | "pollId">): string | null {
  switch (input.purpose) {
    case "meeting":
    case "buffer_before":
    case "buffer_after":
      return input.scheduledEventId ?? null;
    case "one_off_hold":
      return input.oneOffSpotId ?? input.oneOffMeetingId ?? null;
    case "poll_hold":
      return input.pollOptionId ?? input.pollId ?? null;
    default:
      return null;
  }
}

export const linkedEventKey = (purpose: LinkedEventPurpose, entityId: string, userId: string) => `${purpose}:${entityId}:${userId}`;

/**
 * The provider event id of a linked row: the hyphen-less row UUID (hex digits are valid base32hex, 32 characters),
 * or, after the previous provider event vanished, a hash of the row id and that event id (stable across retries).
 */
export function providerEventIdFor(linkedEventId: string, previousExternalId?: string | null): string {
  if (!previousExternalId) return linkedEventId.replace(/-/g, "").toLowerCase();
  return createHash("sha256").update(`${linkedEventId}:${previousExternalId}`).digest("hex").slice(0, 32);
}

async function loadCalendar(db: DbOrTx, calendarId: string): Promise<TargetCalendar | null> {
  const [row] = await db
    .select({
      calendarId: calendars.id,
      externalId: calendars.externalId,
      connectionId: calendars.connectionId,
      includeBuffers: calendars.includeBuffers,
      deletedAt: calendars.deletedAt,
      provider: calendarConnections.provider,
      status: calendarConnections.status,
    })
    .from(calendars)
    .innerJoin(calendarConnections, eq(calendarConnections.id, calendars.connectionId))
    .where(eq(calendars.id, calendarId))
    .limit(1);
  if (!row || row.deletedAt || row.status === "disconnected") return null;
  return row;
}

async function findRow(db: DbOrTx, input: Omit<LinkedEventInput, "event">): Promise<LinkedRow | null> {
  if (input.existingLinkedEventId) {
    if (!isUuid(input.existingLinkedEventId)) return null;
    const [row] = await db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.id, input.existingLinkedEventId)).limit(1);
    if (row && row.userId !== input.userId) throw new AppError("forbidden", "This calendar event belongs to someone else.");
    return row ?? null;
  }
  const entity = entityOf(input);
  if (!entity) return null;
  const col =
    input.purpose === "one_off_hold"
      ? input.oneOffSpotId
        ? calendarLinkedEvents.oneOffSpotId
        : calendarLinkedEvents.oneOffMeetingId
      : input.purpose === "poll_hold"
        ? input.pollOptionId
          ? calendarLinkedEvents.pollOptionId
          : calendarLinkedEvents.pollId
        : calendarLinkedEvents.scheduledEventId;
  const rows = await db
    .select()
    .from(calendarLinkedEvents)
    .where(and(eq(col, entity), eq(calendarLinkedEvents.userId, input.userId), eq(calendarLinkedEvents.purpose, input.purpose)))
    .orderBy(calendarLinkedEvents.createdAt);
  return rows.find((r) => r.status !== "deleted") ?? rows.at(-1) ?? null;
}

async function eventTypeOf(db: DbOrTx, scheduledEventId: string | undefined): Promise<string | undefined> {
  if (!scheduledEventId || !isUuid(scheduledEventId)) return undefined;
  const [se] = await db.select({ eventTypeId: scheduledEvents.eventTypeId }).from(scheduledEvents).where(eq(scheduledEvents.id, scheduledEventId)).limit(1);
  return se?.eventTypeId ?? undefined;
}

/** Inserts the row for this entity (or returns the one a concurrent call inserted). */
async function ensureRow(db: DbOrTx, input: LinkedEventInput, target: TargetCalendar): Promise<LinkedRow> {
  const entity = entityOf(input);
  if (!entity) throw new AppError("validation", "A calendar event needs the meeting, poll or one-off it belongs to.");
  const key = linkedEventKey(input.purpose, entity, input.userId);
  await db
    .insert(calendarLinkedEvents)
    .values({
      userId: input.userId,
      connectionId: target.connectionId,
      calendarId: target.calendarId,
      purpose: input.purpose,
      scheduledEventId: input.scheduledEventId ?? null,
      oneOffMeetingId: input.oneOffMeetingId ?? null,
      oneOffSpotId: input.oneOffSpotId ?? null,
      pollId: input.pollId ?? null,
      pollOptionId: input.pollOptionId ?? null,
      idempotencyKey: key,
      status: "pending",
    })
    .onConflictDoNothing({ target: calendarLinkedEvents.idempotencyKey });
  const [row] = await db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.idempotencyKey, key)).limit(1);
  if (!row) throw new Error("linked event row missing after insert");
  return row;
}

function privatePropsOf(input: LinkedEventInput, linkedEventId: string): Record<string, string> {
  const entity = input.scheduledEventId ?? input.pollId ?? input.oneOffMeetingId ?? entityOf(input) ?? linkedEventId;
  return { kairosEventId: entity, kairosPurpose: input.purpose, kairosLinkedEventId: linkedEventId };
}

/** One provider write of a linked row (create, update, or recreate after the provider event vanished). */
async function writeRow(row: LinkedRow, target: TargetCalendar, input: LinkedEventInput): Promise<WriteEventResult> {
  const impl = getProvider(target.provider);
  if (!impl?.capabilities.write) throw new AppError("not_configured", "This calendar can't receive events.");
  const base = { ...input.event, privateProperties: privatePropsOf(input, row.id) };
  const create = (previous: string | null) =>
    withConnection(target.connectionId, (ctx) => impl.createEvent(ctx, target.externalId, { ...base, idempotencyKey: providerEventIdFor(row.id, previous) }));
  const createWithFallback = async (previous: string | null) => {
    try {
      return await create(previous);
    } catch (e) {
      // The derived id belongs to an event deleted earlier: derive the next one.
      if (isProviderRequestError(e) && e.status === 409) return create(providerEventIdFor(row.id, previous));
      throw e;
    }
  };
  const sameCalendar = row.calendarId === target.calendarId;
  if (row.externalId && row.status !== "deleted" && sameCalendar) {
    try {
      return await withConnection(target.connectionId, (ctx) =>
        // The provider id doubles as the conference requestId used at creation: Google ignores a repeated one, so an
        // update never replaces the Meet link.
        impl.updateEvent(ctx, target.externalId, row.externalId!, { ...base, idempotencyKey: row.externalId! }, row.etag),
      );
    } catch (e) {
      if (!isProviderGone(e)) throw e;
      log.info("calendars.linked_event_recreated", { linkedEventId: row.id });
      return createWithFallback(row.externalId);
    }
  }
  return createWithFallback(row.externalId && (row.status === "deleted" || !sameCalendar) ? row.externalId : null);
}

function failureOf(e: unknown): { status: "pending" | "failed"; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  if (isProviderTransientError(e)) return { status: "pending", message };
  if (isProviderAuthError(e)) return { status: "failed", message: `Calendar connection needs attention: ${message}` };
  return { status: "failed", message };
}

/** CAL-11 (see the file header). */
export async function upsertLinkedEvent(input: LinkedEventInput): Promise<UpsertLinkedEventResult> {
  if (!isUuid(input.userId)) throw new AppError("validation", "Invalid user.");
  const db = await getDb();
  const row0 = await findRow(db, input);

  // Target calendar: the row's own calendar for updates, else the explicit one, else the destination.
  let target: TargetCalendar | null = null;
  if (row0?.calendarId && row0.status !== "deleted") target = await loadCalendar(db, row0.calendarId);
  else if (row0 && row0.status !== "deleted" && !row0.calendarId) target = null;
  else if (input.calendarId) {
    await assertCalendarOwnedBy(db, input.calendarId, input.userId, { purpose: "destination" });
    target = await loadCalendar(db, input.calendarId);
  } else {
    const dest = await getDestinationCalendar(input.userId, await eventTypeOf(db, input.scheduledEventId));
    target = dest ? await loadCalendar(db, dest.calendarId) : null;
  }
  if (!target || target.status === "needs_reauth") {
    if (row0 && target?.status === "needs_reauth") {
      await db.update(calendarLinkedEvents).set({ status: "failed", lastError: "Calendar connection needs attention", attempts: row0.attempts + 1 }).where(eq(calendarLinkedEvents.id, row0.id));
      return { status: "failed", linkedEventId: row0.id, externalId: row0.externalId };
    }
    return { status: "skipped_no_calendar", linkedEventId: row0?.id ?? "", externalId: row0?.externalId ?? null };
  }

  const row = row0 ?? (await ensureRow(db, input, target));
  const t = now();
  let result: WriteEventResult;
  try {
    result = await writeRow(row, target, input);
  } catch (e) {
    if (!isProviderTransientError(e) && !isProviderAuthError(e) && !isProviderRequestError(e) && !(e instanceof AppError)) throw e;
    const f = failureOf(e);
    log.warn("calendars.linked_event_write_failed", { linkedEventId: row.id, purpose: input.purpose, error: e });
    await db
      .update(calendarLinkedEvents)
      .set({ status: row.externalId && row.status === "synced" ? "synced" : f.status === "pending" ? "pending" : "failed", attempts: row.attempts + 1, lastError: f.message.slice(0, 500), updatedAt: t })
      .where(eq(calendarLinkedEvents.id, row.id));
    return { status: f.status, linkedEventId: row.id, externalId: row.externalId };
  }
  await db
    .update(calendarLinkedEvents)
    .set({
      externalId: result.externalId,
      icalUid: result.icalUid ?? null,
      etag: result.etag ?? null,
      syncedStartAt: input.event.start,
      syncedEndAt: input.event.end,
      status: "synced",
      attempts: row.attempts + 1,
      lastError: null,
      lastCheckedAt: t,
      calendarId: target.calendarId,
      connectionId: target.connectionId,
      // An existing row re-created on another entity keeps its key; a fresh one adopts the entity of this call.
      ...(input.scheduledEventId && row.purpose === input.purpose ? { scheduledEventId: input.scheduledEventId } : {}),
      updatedAt: t,
    })
    .where(eq(calendarLinkedEvents.id, row.id));

  if (input.purpose === "meeting" && input.scheduledEventId) {
    await syncBufferEvents({ userId: input.userId, scheduledEventId: input.scheduledEventId, target, meetingTitle: input.event.title, icalUid: input.event.icalUid }).catch((e: unknown) => {
      log.warn("calendars.buffer_events_failed", { scheduledEventId: input.scheduledEventId, error: e });
    });
  }
  return {
    status: "synced",
    linkedEventId: row.id,
    externalId: result.externalId,
    icalUid: result.icalUid ?? null,
    htmlLink: result.htmlLink ?? null,
    ...(result.conference ? { conference: result.conference } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Buffer events (CAL-13)

/** Creates, updates or removes the "Buffer: {title}" events of one meeting on its calendar. */
export async function syncBufferEvents(p: { userId: string; scheduledEventId: string; target?: TargetCalendar | null; meetingTitle?: string; icalUid?: string }): Promise<void> {
  const db = await getDb();
  const [meeting] = await db
    .select({
      status: scheduledEvents.status,
      name: scheduledEvents.name,
      startAt: scheduledEvents.startAt,
      endAt: scheduledEvents.endAt,
      before: scheduledEvents.bufferBeforeMinutes,
      after: scheduledEvents.bufferAfterMinutes,
      icsUid: scheduledEvents.icsUid,
    })
    .from(scheduledEvents)
    .where(eq(scheduledEvents.id, p.scheduledEventId))
    .limit(1);
  if (!meeting) return;
  let target = p.target ?? null;
  if (!target) {
    const [m] = await db
      .select({ calendarId: calendarLinkedEvents.calendarId })
      .from(calendarLinkedEvents)
      .where(and(eq(calendarLinkedEvents.scheduledEventId, p.scheduledEventId), eq(calendarLinkedEvents.userId, p.userId), eq(calendarLinkedEvents.purpose, "meeting"), ne(calendarLinkedEvents.status, "deleted")))
      .limit(1);
    target = m?.calendarId ? await loadCalendar(db, m.calendarId) : null;
  }
  const title = p.meetingTitle ?? meeting.name;
  const uid = p.icalUid ?? meeting.icsUid;
  for (const purpose of BUFFER_PURPOSES) {
    const minutes = purpose === "buffer_before" ? meeting.before : meeting.after;
    const wanted = Boolean(target?.includeBuffers) && minutes > 0 && meeting.status === "active";
    const existing = await findRow(db, { userId: p.userId, purpose, scheduledEventId: p.scheduledEventId });
    if (!wanted) {
      if (existing && existing.status !== "deleted") await deleteLinkedEvent({ linkedEventId: existing.id, notifyAttendees: false });
      continue;
    }
    const start = purpose === "buffer_before" ? new Date(meeting.startAt.getTime() - minutes * 60_000) : meeting.endAt;
    const end = purpose === "buffer_before" ? meeting.startAt : new Date(meeting.endAt.getTime() + minutes * 60_000);
    const res = await upsertLinkedEvent({
      userId: p.userId,
      purpose,
      scheduledEventId: p.scheduledEventId,
      calendarId: existing ? undefined : target!.calendarId,
      existingLinkedEventId: existing && existing.status !== "deleted" ? existing.id : undefined,
      event: {
        title: `Buffer: ${title}`,
        descriptionText: `${purpose === "buffer_before" ? "Buffer time before" : "Buffer time after"} ${title}.`,
        location: null,
        start,
        end,
        attendees: [],
        sendInvitations: false,
        conference: null,
        transparency: "busy",
        visibility: "default",
        icalUid: `${uid}-${purpose.replace("_", "-")}`,
      },
    });
    if (res.status === "pending") {
      await enqueueJob(db, {
        type: LINKED_EVENT_RETRY_JOB,
        payload: { op: "buffers", userId: p.userId, scheduledEventId: p.scheduledEventId },
        idempotencyKey: `buffers:${p.scheduledEventId}:${p.userId}:${Math.floor(now().getTime() / 600_000)}`,
        runAt: new Date(now().getTime() + 60_000),
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Delete and repoint

/** Deletes one provider event now; throws ProviderTransientError for the retry job. */
export async function deleteLinkedEventNow(p: { linkedEventId: string; notifyAttendees: boolean; comment?: string }): Promise<"deleted" | "kept"> {
  const db = await getDb();
  const [row] = await db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.id, p.linkedEventId)).limit(1);
  if (!row || row.status === "deleted") return "deleted";
  const t = now();
  const target = row.calendarId ? await loadCalendar(db, row.calendarId) : null;
  // No provider event, or its calendar is gone (disconnected: events already added stay there, CAL-16).
  if (!row.externalId || !target) {
    await db.update(calendarLinkedEvents).set({ status: "deleted", updatedAt: t }).where(eq(calendarLinkedEvents.id, row.id));
    return "deleted";
  }
  const impl = getProvider(target.provider);
  if (!impl?.capabilities.write || target.status === "needs_reauth") {
    await db.update(calendarLinkedEvents).set({ status: "failed", lastError: "Calendar connection needs attention", updatedAt: t }).where(eq(calendarLinkedEvents.id, row.id));
    return "kept";
  }
  try {
    await withConnection(target.connectionId, (ctx) => impl.deleteEvent(ctx, target.externalId, row.externalId!, { notifyAttendees: p.notifyAttendees, comment: p.comment }));
  } catch (e) {
    if (isProviderTransientError(e)) {
      await db.update(calendarLinkedEvents).set({ attempts: row.attempts + 1, lastError: (e as Error).message.slice(0, 500), updatedAt: t }).where(eq(calendarLinkedEvents.id, row.id));
      throw e;
    }
    if (!isProviderGone(e)) {
      await db.update(calendarLinkedEvents).set({ status: "failed", lastError: (e as Error).message?.slice(0, 500) ?? "delete failed", updatedAt: t }).where(eq(calendarLinkedEvents.id, row.id));
      return "kept";
    }
  }
  await db.update(calendarLinkedEvents).set({ status: "deleted", lastError: null, updatedAt: t }).where(eq(calendarLinkedEvents.id, row.id));
  return "deleted";
}

/** CAL-11: deletes the provider event of a linked row (and a meeting's buffer events); transient failures retry in a job. */
export async function deleteLinkedEvent(p: { linkedEventId: string; notifyAttendees: boolean; comment?: string }): Promise<void> {
  if (!isUuid(p.linkedEventId)) return;
  const db = await getDb();
  const [row] = await db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.id, p.linkedEventId)).limit(1);
  if (!row) return;
  const ids = [row.id];
  if (row.purpose === "meeting" && row.scheduledEventId) {
    const buffers = await db
      .select({ id: calendarLinkedEvents.id })
      .from(calendarLinkedEvents)
      .where(
        and(
          eq(calendarLinkedEvents.scheduledEventId, row.scheduledEventId),
          eq(calendarLinkedEvents.userId, row.userId),
          inArray(calendarLinkedEvents.purpose, [...BUFFER_PURPOSES]),
          ne(calendarLinkedEvents.status, "deleted"),
        ),
      );
    ids.push(...buffers.map((b) => b.id));
  }
  for (const id of ids) {
    const notify = id === row.id ? p.notifyAttendees : false;
    try {
      await deleteLinkedEventNow({ linkedEventId: id, notifyAttendees: notify, comment: p.comment });
    } catch (e) {
      log.warn("calendars.linked_event_delete_retry", { linkedEventId: id, error: e });
      await enqueueJob(db, {
        type: LINKED_EVENT_RETRY_JOB,
        payload: { op: "delete", linkedEventId: id, notifyAttendees: notify, comment: p.comment ?? null },
        idempotencyKey: `delete:${id}`,
        runAt: new Date(now().getTime() + 30_000),
        maxAttempts: 8,
      });
    }
  }
}

/** Reschedule continuity: the provider events of `from` now belong to `to` (the same provider event is moved). */
export async function repointLinkedEvents(p: { fromScheduledEventId: string; toScheduledEventId: string }): Promise<void> {
  if (!isUuid(p.fromScheduledEventId) || !isUuid(p.toScheduledEventId) || p.fromScheduledEventId === p.toScheduledEventId) return;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(calendarLinkedEvents)
      .where(and(eq(calendarLinkedEvents.scheduledEventId, p.fromScheduledEventId), ne(calendarLinkedEvents.status, "deleted")));
    for (const r of rows) {
      const key = linkedEventKey(r.purpose, p.toScheduledEventId, r.userId);
      const [taken] = await tx.select({ id: calendarLinkedEvents.id }).from(calendarLinkedEvents).where(eq(calendarLinkedEvents.idempotencyKey, key)).limit(1);
      await tx
        .update(calendarLinkedEvents)
        .set({ scheduledEventId: p.toScheduledEventId, ...(taken ? {} : { idempotencyKey: key }), updatedAt: now() })
        .where(eq(calendarLinkedEvents.id, r.id));
    }
  });
}

/** Re-reads a linked event's provider event and returns its conference (a Meet link that was still pending, VID-07). */
export async function refreshLinkedConference(linkedEventId: string): Promise<WriteEventResult["conference"] | null> {
  if (!isUuid(linkedEventId)) return null;
  const db = await getDb();
  const [row] = await db.select().from(calendarLinkedEvents).where(eq(calendarLinkedEvents.id, linkedEventId)).limit(1);
  if (!row?.externalId || !row.calendarId) return null;
  const target = await loadCalendar(db, row.calendarId);
  if (!target || target.provider !== "google") return null;
  return withConnection(target.connectionId, (ctx) => readGoogleConference(ctx, target.externalId, row.externalId!));
}
