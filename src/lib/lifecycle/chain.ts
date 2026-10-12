// CR-02, CR-04: links of old invitees open the active one of their reschedule chain.
import "server-only";
import { eq } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { invitees } from "@/db/schema";
import type { InviteeRow } from "@/lib/booking";
import { isUuid } from "@/lib/ids";

/**
 * Follows invitees.new_invitee_id from a (possibly rescheduled) invitee to the current one of its chain (CR-04: links
 * of old invitees open the active one). Returns null when the invitee does not exist (or the id is not a uuid). Cycles
 * are cut after 50 hops.
 */
export async function resolveActiveInviteeChain(inviteeId: string, db?: DbOrTx): Promise<InviteeRow | null> {
  if (!isUuid(inviteeId)) return null; // capability ids come from URLs; malformed ids are unknown, not a 22P02 error
  const d = db ?? (await getDb());
  let [row] = await d.select().from(invitees).where(eq(invitees.id, inviteeId)).limit(1);
  const seen = new Set<string>();
  for (let hops = 0; row?.newInviteeId && hops < 50 && !seen.has(row.id); hops++) {
    seen.add(row.id);
    const [next] = await d.select().from(invitees).where(eq(invitees.id, row.newInviteeId)).limit(1);
    if (!next) break;
    row = next;
  }
  return row ?? null;
}
