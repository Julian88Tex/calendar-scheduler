// Whether the instance already has an account (docs/DEPLOY.md, "Bootstrap the owner"). The owner bootstrap only ever
// configures a fresh instance, so once a live account exists the public /setup page stops advertising it
// (src/lib/auth/flows/setup-status.ts) and POST /api/setup/bootstrap refuses with one read and no writes. Server only.
import "server-only";
import { and, isNull, ne } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { users } from "@/db/schema";
import { normalizeEmail } from "@/lib/validation";

/** True when a live (not deleted) account exists, ignoring the one with `exceptEmail` when given. One read, no writes. */
export async function hasLiveAccount(opts: { db?: DbOrTx; exceptEmail?: string } = {}): Promise<boolean> {
  const db = opts.db ?? (await getDb());
  const live = isNull(users.deletedAt);
  const where = opts.exceptEmail === undefined ? live : and(live, ne(users.emailNormalized, normalizeEmail(opts.exceptEmail)));
  const [row] = await db.select({ id: users.id }).from(users).where(where).limit(1);
  return Boolean(row);
}
