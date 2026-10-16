// Password changes from Settings > Login (SPEC AU-10, GEN-17), for settings-onboarding's form: "Change password"
// checks the current password; "Set password" (OAuth-only accounts) needs none. Every other session of the user is
// revoked and user.password_changed is audited.
import "server-only";
import { and, eq, isNull, ne } from "drizzle-orm";
import { getDb, withTx, type DbOrTx } from "@/db";
import { sessions, users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { now } from "@/lib/time/now";
import { zPassword } from "@/lib/validation";
import { auditAuth } from "./audit";
import type { RequestMeta } from "./request-context";

export const INCORRECT_CURRENT_PASSWORD_MESSAGE = "Your current password is incorrect.";

/**
 * Sets a new password. Requires `currentPassword` when the account already has one. Throws AppError("validation")
 * with field errors (currentPassword, newPassword). Sessions other than `keepSessionId` are revoked.
 */
export async function changePassword(p: {
  userId: string;
  currentPassword?: string | null;
  newPassword: string;
  keepSessionId?: string | null;
  meta?: RequestMeta;
  db?: DbOrTx;
}): Promise<void> {
  const parsed = zPassword.safeParse(p.newPassword);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Choose a stronger password";
    throw new AppError("validation", message, { fieldErrors: { newPassword: [message] } });
  }
  const db = p.db ?? (await getDb());
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.id, p.userId), isNull(users.deletedAt)))
    .limit(1);
  if (!user) throw new AppError("not_found");
  if (user.passwordHash && !(await verifyPassword(p.currentPassword ?? "", user.passwordHash))) {
    throw new AppError("validation", INCORRECT_CURRENT_PASSWORD_MESSAGE, {
      fieldErrors: { currentPassword: [INCORRECT_CURRENT_PASSWORD_MESSAGE] },
    });
  }
  const passwordHash = await hashPassword(p.newPassword);
  await withTx(db, async (tx) => {
    const at = now();
    await tx.update(users).set({ passwordHash, updatedAt: at }).where(eq(users.id, user.id));
    const others = p.keepSessionId
      ? and(eq(sessions.userId, user.id), ne(sessions.id, p.keepSessionId), isNull(sessions.revokedAt))
      : and(eq(sessions.userId, user.id), isNull(sessions.revokedAt));
    await tx.update(sessions).set({ revokedAt: at }).where(others);
    await auditAuth("user.password_changed", { user, details: { via: user.passwordHash ? "change" : "set" }, meta: p.meta, tx });
  });
}
