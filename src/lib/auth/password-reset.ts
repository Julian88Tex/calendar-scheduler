// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Password reset (SPEC AU-07, AU-14, GEN-08):
// - requestPasswordReset always answers the same way ("If an account exists for {email}, we sent a link to reset your
//   password."), limited to 5 requests per address per hour. When the account exists it stores a random token (SHA-256
//   only, auth_tokens purpose password_reset, 60 minutes) and emails /reset-password/{token} after the response.
// - The GET page only peeks at the token; resetPassword (the POST) consumes it in a transaction with a row lock, so a
//   link works exactly once ("This link has expired. Request a new one." afterwards).
// - A link only works for the address it was sent to: when the account's email changed since, the link is expired
//   (the old mailbox must not be able to set the password, and the reset must not mark the new address verified).
// - OAuth-only accounts can set a password this way. A successful reset also proves the address, so an unverified
//   email becomes verified, and every other outstanding reset link of the user is invalidated. The caller creates the
//   session and revokes the user's other sessions.
import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, withTx, type DbOrTx } from "@/db";
import { authTokens, users } from "@/db/schema";
import { hashPassword, hashToken, randomToken } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { now } from "@/lib/time/now";
import { normalizeEmail } from "@/lib/validation";
import { auditAuth } from "./flows/audit";
import { sendResetPasswordEmail } from "./flows/auth-emails";
import { AUTH_RATE_LIMITS, resetEmailKey } from "./flows/rate-limits";
import type { RequestMeta } from "./flows/request-context";

export const RESET_LINK_SENT_MESSAGE = "If an account exists for {email}, we sent a link to reset your password.";
export const RESET_LINK_EXPIRED_MESSAGE = "This link has expired. Request a new one.";
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** RESET_LINK_SENT_MESSAGE with the address filled in. */
export function resetLinkSentMessage(email: string): string {
  return RESET_LINK_SENT_MESSAGE.replace("{email}", email.trim());
}

/** Sends the reset email when the account exists (always answers the same way). */
export async function requestPasswordReset(
  email: string,
  ctx: { ip?: string | null; userAgent?: string | null; db?: DbOrTx; defer?: boolean } = {},
): Promise<void> {
  const db = ctx.db ?? (await getDb());
  await assertRateLimit(resetEmailKey(email), AUTH_RATE_LIMITS.resetEmail.limit, AUTH_RATE_LIMITS.resetEmail.windowSeconds, { db });
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, slug: users.slug })
    .from(users)
    .where(and(eq(users.emailNormalized, normalizeEmail(email)), isNull(users.deletedAt)))
    .limit(1);
  if (!user) return;
  const token = randomToken(32);
  const [row] = await db
    .insert(authTokens)
    .values({
      userId: user.id,
      purpose: "password_reset",
      tokenHash: hashToken(token),
      email: normalizeEmail(user.email),
      expiresAt: new Date(now().getTime() + RESET_TOKEN_TTL_MS),
    })
    .returning({ id: authTokens.id });
  if (!row) throw new Error("reset token insert returned no row");
  await auditAuth("user.password_reset_requested", {
    user,
    meta: { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null },
  });
  await sendResetPasswordEmail(user, { token, tokenId: row.id, defer: ctx.defer });
}

async function findLiveResetToken(db: DbOrTx, token: string, lock: boolean) {
  if (!token || token.length > 200) return null;
  const q = db
    .select({ id: authTokens.id, userId: authTokens.userId, email: authTokens.email })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        eq(authTokens.purpose, "password_reset"),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now()),
      ),
    )
    .limit(1);
  const rows = lock ? await q.for("update") : await q;
  return rows[0] ?? null;
}

/** True when the token was issued for the account's current address (requestPasswordReset always records it). */
function sentToCurrentAddress(row: { email: string | null }, user: { emailNormalized: string }): boolean {
  return row.email !== null && row.email === user.emailNormalized;
}

/** Validates a reset token without consuming it (for the GET page). */
export async function peekPasswordResetToken(token: string): Promise<{ email: string } | null> {
  const db = await getDb();
  const row = await findLiveResetToken(db, token, false);
  if (!row?.userId) return null;
  const [user] = await db
    .select({ email: users.email, emailNormalized: users.emailNormalized })
    .from(users)
    .where(and(eq(users.id, row.userId), isNull(users.deletedAt)))
    .limit(1);
  return user && sentToCurrentAddress(row, user) ? { email: user.email } : null;
}

/** Consumes the token and sets the new password; returns the user id (the caller creates the session). */
export async function resetPassword(
  token: string,
  newPassword: string,
  opts: { db?: DbOrTx; meta?: RequestMeta } = {},
): Promise<{ userId: string }> {
  const db = opts.db ?? (await getDb());
  // Hash before taking row locks: scrypt takes tens of milliseconds.
  const passwordHash = await hashPassword(newPassword);
  return withTx(db, async (tx) => {
    const row = await findLiveResetToken(tx, token, true);
    if (!row?.userId) throw new AppError("not_found", RESET_LINK_EXPIRED_MESSAGE);
    const [user] = await tx
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailNormalized: users.emailNormalized,
        passwordHash: users.passwordHash,
        emailVerifiedAt: users.emailVerifiedAt,
      })
      .from(users)
      .where(and(eq(users.id, row.userId), isNull(users.deletedAt)))
      .limit(1)
      .for("update");
    if (!user || !sentToCurrentAddress(row, user)) throw new AppError("not_found", RESET_LINK_EXPIRED_MESSAGE);
    const at = now();
    await tx
      .update(users)
      .set({ passwordHash, emailVerifiedAt: user.emailVerifiedAt ?? at, updatedAt: at })
      .where(eq(users.id, user.id));
    await tx
      .update(authTokens)
      .set({ usedAt: at })
      .where(and(eq(authTokens.userId, user.id), eq(authTokens.purpose, "password_reset"), isNull(authTokens.usedAt)));
    await auditAuth("user.password_changed", {
      user,
      details: { via: "reset", hadPassword: Boolean(user.passwordHash) },
      meta: opts.meta,
      tx,
    });
    return { userId: user.id };
  });
}
