// Bulk actions of the Scheduling list (SPEC ET-08 with ET-09 and ET-12): delete or turn on/off every selected event
// type in ONE transaction through the event-types-editor services (deleteEventType, setEventTypeActive), so each row
// keeps its authorization check, soft delete, audit entry, single-use link expiry and domain event, and a failure on
// any row (no permission, someone else's or unknown id) leaves every selected event type untouched.
//
// Selections can be stale (the list was open in another tab while one of the event types was deleted there): the
// actor's own personal event types that are already deleted are skipped instead of failing the whole action, so
// "Delete" still removes the rest and "Toggle on/off" still switches the live ones. Deleted rows of anyone else stay
// "not found", which reveals nothing about other accounts.
//
// Lock order (the one the event type services document: the owner's schedule lock, then event type rows, then the
// profile's slug lock): the schedule locks of the owners in the actor's organization first, which serializes a bulk
// action with reorder, save and duplicate of the same profile (reorder updates many rows while holding that lock), then
// every selected row FOR UPDATE in id order, so overlapping bulk actions and single row actions queue instead of
// deadlocking, and the rows are classified (live or already deleted) on their latest committed version. Server only.
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { withTx, type DB, type DbOrTx } from "@/db";
import { eventTypes } from "@/db/schema";
import { lockUserSchedules } from "@/lib/availability";
import type { ActorCtx } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { deleteEventType, setEventTypeActive } from "@/lib/event-types";
import { isUuid } from "@/lib/ids";
import { BULK_MAX } from "./schemas";

function lockOrder(ids: readonly string[]): string[] {
  const unique = [...new Set(ids)];
  if (!unique.length) throw new AppError("validation", "Select at least one event type.");
  if (unique.length > BULK_MAX) throw new AppError("validation", `Select up to ${BULK_MAX} event types at a time.`);
  if (!unique.every((id) => isUuid(id))) throw new AppError("validation", "Invalid id");
  return unique.sort();
}

/**
 * Takes the locks of the selection and returns the ids to skip: the actor's own personal event types that are already
 * deleted. Every other id goes to the event type services, which authorize it (unknown or foreign ids: not found).
 */
async function lockSelection(tx: DbOrTx, actor: ActorCtx, ids: readonly string[]): Promise<Set<string>> {
  const owners = await tx
    .selectDistinct({ ownerUserId: eventTypes.ownerUserId })
    .from(eventTypes)
    .where(and(inArray(eventTypes.id, [...ids]), eq(eventTypes.organizationId, actor.orgId)));
  const ownerIds = owners.map((r) => r.ownerUserId).filter((x): x is string => Boolean(x)).sort();
  for (const owner of ownerIds) await lockUserSchedules(tx, owner);
  const rows = await tx
    .select({ id: eventTypes.id, ownerUserId: eventTypes.ownerUserId, teamId: eventTypes.teamId, scope: eventTypes.scope, deletedAt: eventTypes.deletedAt })
    .from(eventTypes)
    .where(and(inArray(eventTypes.id, [...ids]), eq(eventTypes.organizationId, actor.orgId)))
    .orderBy(asc(eventTypes.id))
    .for("update");
  return new Set(
    rows.filter((r) => r.deletedAt && r.ownerUserId === actor.user.id && !r.teamId && r.scope === "personal").map((r) => r.id),
  );
}

/** ET-08 "Delete": soft deletes every selected event type (one confirmation in the UI). `deleted` lists the selection. */
export async function bulkDeleteEventTypes(db: DB | DbOrTx, actor: ActorCtx, ids: readonly string[]): Promise<{ deleted: string[] }> {
  const ordered = lockOrder(ids);
  await withTx(db as DB, async (tx) => {
    const gone = await lockSelection(tx, actor, ordered);
    for (const id of ordered) if (!gone.has(id)) await deleteEventType(tx, actor, id);
  });
  return { deleted: ordered };
}

/**
 * ET-08 "Toggle on/off": sets every selected event type on (active) or off; rows already in that state are left as they
 * are. `updated` lists the live event types of the selection (already deleted ones of the actor are skipped).
 */
export async function bulkSetEventTypesActive(
  db: DB | DbOrTx,
  actor: ActorCtx,
  ids: readonly string[],
  active: boolean,
): Promise<{ updated: string[]; active: boolean }> {
  const ordered = lockOrder(ids);
  const updated = await withTx(db as DB, async (tx) => {
    const gone = await lockSelection(tx, actor, ordered);
    const live = ordered.filter((id) => !gone.has(id));
    for (const id of live) await setEventTypeActive(tx, actor, id, active);
    return live;
  });
  return { updated, active };
}
