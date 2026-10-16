// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Email verification (SPEC AU-08, GEN-08): email signups get "Verify your email" with /verify-email/{token}, valid for
// 24 hours. The token is random (256 bits) and stored only as its SHA-256 in auth_tokens (purpose
// email_verification) together with the address it verifies. The link page shows the address and a "Verify email"
// button; only that POST consumes the token (mail scanners prefetch GETs). Re-sending is limited to 5 emails per
// address per hour (AU-14). A token only verifies the address it was issued for (an email change in between leaves
// the new address unverified).
import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, withTx, type DbOrTx } from "@/db";
import { authTokens, users } from "@/db/schema";
import { hashToken, randomToken } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { now } from "@/lib/time/now";
import { normalizeEmail } from "@/lib/validation";
import { auditAuth } from "./flows/audit";
import { sendVerifyEmail } from "./flows/auth-emails";
import { AUTH_RATE_LIMITS, verifyEmailKey } from "./flows/rate-limits";
import type { RequestMeta } from "./flows/request-context";

export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const VERIFY_LINK_EXPIRED_MESSAGE = "This link has expired. Request a new one.";
export const ALREADY_VERIFIED_MESSAGE = "Your email address is already verified.";

export type VerificationTokenInfo = { email: string; userId: string; alreadyVerified: boolean };

/**
 * Creates a verification token for the user's current email and sends the email. Returns nothing when the user does
 * not exist or is already verified. Throws AppError("rate_limited") after 5 emails per address per hour.
 */
export async function sendVerificationEmail(userId: string, opts: { db?: DbOrTx; defer?: boolean } = {}): Promise<void> {
  const db = opts.db ?? (await getDb());
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, emailVerifiedAt: users.emailVerifiedAt, slug: users.slug })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!user || user.emailVerifiedAt) return;
  await assertRateLimit(verifyEmailKey(user.email), AUTH_RATE_LIMITS.verifyEmail.limit, AUTH_RATE_LIMITS.verifyEmail.windowSeconds, { db });
  const token = randomToken(32);
  const [row] = await db
    .insert(authTokens)
    .values({
      userId: user.id,
      purpose: "email_verification",
      tokenHash: hashToken(token),
      email: normalizeEmail(user.email),
      expiresAt: new Date(now().getTime() + VERIFY_TOKEN_TTL_MS),
    })
    .returning({ id: authTokens.id });
  if (!row) throw new Error("verification token insert returned no row");
  await sendVerifyEmail(user, { token, tokenId: row.id, defer: opts.defer });
}

async function findLiveToken(db: DbOrTx, token: string, lock: boolean) {
  if (!token || token.length > 200) return null;
  const q = db
    .select({ id: authTokens.id, userId: authTokens.userId, email: authTokens.email })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(token)),
        eq(authTokens.purpose, "email_verification"),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now()),
      ),
    )
    .limit(1);
  const rows = lock ? await q.for("update") : await q;
  return rows[0] ?? null;
}

/** Validates a verification token without consuming it (for the GET page). */
export async function peekEmailVerificationToken(token: string): Promise<{ email: string } | null> {
  const info = await inspectEmailVerificationToken(token);
  return info ? { email: info.email } : null;
}

/** Like peekEmailVerificationToken, with the user and whether that address is already verified. */
export async function inspectEmailVerificationToken(token: string, db?: DbOrTx): Promise<VerificationTokenInfo | null> {
  const d = db ?? (await getDb());
  const row = await findLiveToken(d, token, false);
  if (!row?.userId || !row.email) return null;
  const [user] = await d
    .select({ email: users.email, emailNormalized: users.emailNormalized, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(and(eq(users.id, row.userId), isNull(users.deletedAt)))
    .limit(1);
  if (!user || user.emailNormalized !== row.email) return null;
  return { email: user.email, userId: row.userId, alreadyVerified: Boolean(user.emailVerifiedAt) };
}

/**
 * Consumes the token and sets users.email_verified_at; returns the user id. Throws AppError("not_found",
 * "This link has expired. Request a new one.") for unknown, used, expired or outdated tokens.
 */
export async function verifyEmailToken(token: string, opts: { db?: DbOrTx; meta?: RequestMeta } = {}): Promise<{ userId: string }> {
  const db = opts.db ?? (await getDb());
  const result = await withTx(db, async (tx) => {
    const row = await findLiveToken(tx, token, true);
    if (!row?.userId || !row.email) throw new AppError("not_found", VERIFY_LINK_EXPIRED_MESSAGE);
    const at = now();
    await tx.update(authTokens).set({ usedAt: at }).where(eq(authTokens.id, row.id));
    const [user] = await tx
      .select({ id: users.id, name: users.name, email: users.email, emailNormalized: users.emailNormalized, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(and(eq(users.id, row.userId), isNull(users.deletedAt)))
      .limit(1)
      .for("update");
    if (!user || user.emailNormalized !== row.email) throw new AppError("not_found", VERIFY_LINK_EXPIRED_MESSAGE);
    if (!user.emailVerifiedAt) {
      await tx.update(users).set({ emailVerifiedAt: at }).where(eq(users.id, user.id));
      // Every other outstanding verification link of this user is now pointless.
      await tx
        .update(authTokens)
        .set({ usedAt: at })
        .where(and(eq(authTokens.userId, user.id), eq(authTokens.purpose, "email_verification"), isNull(authTokens.usedAt)));
      await auditAuth("user.email_verified", { user, details: { email: user.email }, meta: opts.meta, tx });
    }
    return { userId: user.id };
  });
  return result;
}
