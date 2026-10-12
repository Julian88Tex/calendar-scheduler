// Bulk actions of the Scheduling list (SPEC ET-08 with ET-09 and ET-12): delete or turn on/off every selected event
// type in ONE transaction through the event-types-editor services (deleteEventType, setEventTypeActive), so each row
// keeps its authorization check, soft delete, audit entry, single-use link expiry and domain event, and a failure on
// any row (deleted meanwhile, no permission) leaves every selected event type untouched. Rows are processed in id
// order so two concurrent bulk actions lock them in the same order. Server only.
import "server-only";
import { withTx, type DB, type DbOrTx } from "@/db";
import type { ActorCtx } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { deleteEventType, setEventTypeActive } from "@/lib/event-types";
import { BULK_MAX } from "./schemas";

function lockOrder(ids: readonly string[]): string[] {
  const unique = [...new Set(ids)];
  if (!unique.length) throw new AppError("validation", "Select at least one event type.");
  if (unique.length > BULK_MAX) throw new AppError("validation", `Select up to ${BULK_MAX} event types at a time.`);
  return unique.sort();
}

/** ET-08 "Delete": soft deletes every selected event type (one confirmation in the UI). */
export async function bulkDeleteEventTypes(db: DB | DbOrTx, actor: ActorCtx, ids: readonly string[]): Promise<{ deleted: string[] }> {
  const ordered = lockOrder(ids);
  await withTx(db as DB, async (tx) => {
    for (const id of ordered) await deleteEventType(tx, actor, id);
  });
  return { deleted: ordered };
}

/** ET-08 "Toggle on/off": sets every selected event type on (active) or off; already matching rows are left as they are. */
export async function bulkSetEventTypesActive(
  db: DB | DbOrTx,
  actor: ActorCtx,
  ids: readonly string[],
  active: boolean,
): Promise<{ updated: string[]; active: boolean }> {
  const ordered = lockOrder(ids);
  await withTx(db as DB, async (tx) => {
    for (const id of ordered) await setEventTypeActive(tx, actor, id, active);
  });
  return { updated: ordered, active };
}
