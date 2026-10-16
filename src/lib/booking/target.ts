// Booking target resolution (ARCHITECTURE section 8): /{handle}/{eventSlug} and /d/{code} to a BookingTarget, and
// the event type loader with hosts, pools and questions.
import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { eventTypeHostPools, eventTypeHosts, eventTypeQuestions, eventTypes, handles, teams, users } from "@/db/schema";
import { isUuid } from "@/lib/ids";
import { resolveBookingCode } from "@/lib/links";
import type { BookingTarget, EventTypeRow } from "./types";

type EventTypeBase = typeof eventTypes.$inferSelect;

/** Attaches hosts (by position), pools (by position) and questions (by position) to event type rows. */
export async function withRelations(db: DbOrTx, rows: EventTypeBase[]): Promise<EventTypeRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const hostRows = await db
    .select()
    .from(eventTypeHosts)
    .where(inArray(eventTypeHosts.eventTypeId, ids))
    .orderBy(asc(eventTypeHosts.position), asc(eventTypeHosts.createdAt));
  const poolRows = await db
    .select()
    .from(eventTypeHostPools)
    .where(inArray(eventTypeHostPools.eventTypeId, ids))
    .orderBy(asc(eventTypeHostPools.position));
  const questionRows = await db
    .select()
    .from(eventTypeQuestions)
    .where(inArray(eventTypeQuestions.eventTypeId, ids))
    .orderBy(asc(eventTypeQuestions.position));
  return rows.map((r) => ({
    ...r,
    hosts: hostRows.filter((h) => h.eventTypeId === r.id),
    pools: poolRows.filter((p) => p.eventTypeId === r.id),
    questions: questionRows.filter((q) => q.eventTypeId === r.id),
  }));
}

/** The live (not deleted) event type with its relations, or null. */
export async function loadEventType(eventTypeId: string, db?: DbOrTx): Promise<EventTypeRow | null> {
  if (!isUuid(eventTypeId)) return null;
  const d = db ?? (await getDb());
  const rows = await d
    .select()
    .from(eventTypes)
    .where(and(eq(eventTypes.id, eventTypeId), isNull(eventTypes.deletedAt)))
    .limit(1);
  const [row] = await withRelations(d, rows);
  return row ?? null;
}

/**
 * Resolves /{handle}/{eventSlug}: a personal event type of the user owning the handle, or a team event type of the
 * team owning it. Inactive and secret event types resolve too (the page shows their state); deleted users, teams and
 * event types do not. Adhoc types (one-off meetings, polls) are never reachable by slug.
 */
export async function resolveTargetBySlugs(handle: string, eventSlug: string): Promise<BookingTarget | null> {
  const slug = handle.trim().toLowerCase();
  const etSlug = eventSlug.trim().toLowerCase();
  if (!slug || !etSlug || slug.length > 100 || etSlug.length > 200) return null;
  const db = await getDb();
  const [owner] = await db
    .select({ userId: handles.userId, teamId: handles.teamId })
    .from(handles)
    .where(eq(handles.slug, slug))
    .limit(1);
  if (!owner) return null;
  let rows: EventTypeBase[] = [];
  if (owner.userId) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, owner.userId), isNull(users.deletedAt)))
      .limit(1);
    if (!user) return null;
    rows = await db
      .select()
      .from(eventTypes)
      .where(
        and(
          eq(eventTypes.ownerUserId, user.id),
          eq(eventTypes.slug, etSlug),
          eq(eventTypes.scope, "personal"),
          eq(eventTypes.type, "standard"),
          isNull(eventTypes.teamId),
          isNull(eventTypes.deletedAt),
        ),
      )
      .limit(1);
  } else if (owner.teamId) {
    const [team] = await db
      .select({ id: teams.id })
      .from(teams)
      .where(and(eq(teams.id, owner.teamId), isNull(teams.deletedAt)))
      .limit(1);
    if (!team) return null;
    rows = await db
      .select()
      .from(eventTypes)
      .where(
        and(
          eq(eventTypes.teamId, team.id),
          eq(eventTypes.slug, etSlug),
          eq(eventTypes.type, "standard"),
          isNull(eventTypes.deletedAt),
        ),
      )
      .limit(1);
  }
  const [eventType] = await withRelations(db, rows);
  return eventType ? { kind: "event_type", eventType } : null;
}

/**
 * Resolves /d/{code} through links.resolveBookingCode (single-use links, one-off meetings, shared event types).
 * Deleted links resolve to null; used or expired links resolve with `linkStatus` set so the pages can show the
 * BK-23 state and bookings fail with link_used.
 */
export async function resolveTargetByCode(code: string): Promise<BookingTarget | null> {
  const clean = code.trim();
  if (!clean || clean.length > 100) return null;
  const resolved = await resolveBookingCode(clean);
  if (!resolved || resolved.status === "deleted") return null;
  const eventType = await loadEventType(resolved.eventTypeId);
  if (!eventType) return null;
  const target: BookingTarget = { kind: resolved.kind, eventType, code: resolved.code, linkStatus: resolved.status };
  if (resolved.linkId) target.linkId = resolved.linkId;
  if (resolved.overrides) target.overrides = resolved.overrides;
  if (resolved.spots) target.spots = resolved.spots;
  return target;
}

/** Resolves the target of a booking request (CreateBookingInput.target). */
export async function resolveRequestTarget(t: {
  kind: BookingTarget["kind"];
  eventTypeId?: string;
  code?: string;
  handle?: string;
  eventSlug?: string;
}): Promise<BookingTarget | null> {
  if (t.kind !== "event_type") return t.code ? resolveTargetByCode(t.code) : null;
  if (t.eventTypeId) {
    const eventType = await loadEventType(t.eventTypeId);
    return eventType ? { kind: "event_type", eventType } : null;
  }
  if (t.handle && t.eventSlug) return resolveTargetBySlugs(t.handle, t.eventSlug);
  return null;
}
