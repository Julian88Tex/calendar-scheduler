// Global lock order helpers (ARCHITECTURE section 9), exported through index.ts for lifecycle-core, links-sharing and
// polls-core.
//
// Global lock order (normative): 1. lockHostsInTx (advisory locks per host, ascending user id); 2. row locks: the
// invitee being changed (lockInviteeForChangeInTx), then at most one target row (link, one-off, group slot or poll);
// 3. everything else.
import "server-only";
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { advisoryXactLock } from "@/db/helpers";
import { invitees } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import type { InviteeRow } from "./types";

/** The advisory lock key of one host (`host:{userId}`). */
export function hostLockKey(userId: string): string {
  return `host:${userId}`;
}

/** Lock order step 1 (call inside a transaction): pg_advisory_xact_lock(hashtextextended('host:' || user_id, 0)) per host, ascending user id. */
export async function lockHostsInTx(tx: DbOrTx, userIds: string[]): Promise<void> {
  const ids = [...new Set(userIds)].sort();
  await advisoryXactLock(tx, ...ids.map(hostLockKey));
}

/**
 * Lock order step 2: SELECT ... FOR UPDATE of the invitee being canceled or rescheduled. Throws AppError("not_found")
 * when it does not exist and AppError("conflict", details.reason "canceled" | "rescheduled") when it is no longer
 * active or was already rescheduled (callers map it, for example to "This event can no longer be rescheduled.").
 */
export async function lockInviteeForChangeInTx(tx: DbOrTx, inviteeId: string): Promise<InviteeRow> {
  // Capability ids come from URLs: a malformed id is "not found", never a uuid cast error (22P02).
  if (!isUuid(inviteeId)) throw new AppError("not_found", "This meeting could not be found.");
  const [row] = await tx.select().from(invitees).where(eq(invitees.id, inviteeId)).limit(1).for("update");
  if (!row) throw new AppError("not_found", "This meeting could not be found.");
  if (row.status !== "active" || row.rescheduled || row.newInviteeId) {
    const reason = row.rescheduled || row.newInviteeId ? "rescheduled" : "canceled";
    throw new AppError("conflict", "This event was already canceled or rescheduled.", { details: { reason } });
  }
  return row;
}
