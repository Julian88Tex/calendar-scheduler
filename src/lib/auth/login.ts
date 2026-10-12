// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Email and password login (SPEC AU-04, AU-14): no account enumeration ("Incorrect email or password."), rate limits
// per email and per IP, 2FA users continue on /login/two-factor. Foundation stub: the credential check only.
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword, verifyPasswordDummy } from "@/lib/crypto";
import { normalizeEmail } from "@/lib/validation";
import type { UserRow } from "./session";

export const INCORRECT_CREDENTIALS_MESSAGE = "Incorrect email or password.";

/** The live user whose password matches, or null (constant work whether or not the email exists). */
export async function verifyLoginCredentials(email: string, password: string, db?: DbOrTx): Promise<UserRow | null> {
  const d = db ?? (await getDb());
  const [user] = await d
    .select()
    .from(users)
    .where(and(eq(users.emailNormalized, normalizeEmail(email)), isNull(users.deletedAt)))
    .limit(1);
  if (!user?.passwordHash) {
    await verifyPasswordDummy(password);
    return null;
  }
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}
