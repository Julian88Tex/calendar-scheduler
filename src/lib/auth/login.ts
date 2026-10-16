// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Email and password login (SPEC AU-04, AU-14, GEN-17):
// - No account enumeration: unknown email, OAuth-only account and wrong password all answer "Incorrect email or
//   password." after the same amount of work (a dummy scrypt when there is no hash).
// - Rate limits: 10 failed attempts per email and 50 per IP per 15 minutes; once a window is full the next attempt is
//   rejected before the password is checked. Each attempt is counted atomically before the check (a parallel burst
//   cannot slip past a read-only peek); a successful login clears the email window and gives its IP hit back.
// - Audit: user.login_failed for every failure (with the user's organization when the account exists); user.login is
//   written by the caller once the session is fully authenticated (after the second factor when enabled).
import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { users } from "@/db/schema";
import { verifyPassword, verifyPasswordDummy } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { rateLimit, rateLimitedError, resetRateLimit } from "@/lib/rate-limit";
import { nowMs } from "@/lib/time/now";
import { normalizeEmail } from "@/lib/validation";
import { auditAuth } from "./flows/audit";
import { AUTH_RATE_LIMITS, loginEmailKey, loginIpKey, refundRateLimitHit } from "./flows/rate-limits";
import type { RequestMeta } from "./flows/request-context";
import type { UserRow } from "./session";

export const INCORRECT_CREDENTIALS_MESSAGE = "Incorrect email or password.";

async function findLoginUser(d: DbOrTx, email: string): Promise<UserRow | null> {
  const [user] = await d
    .select()
    .from(users)
    .where(and(eq(users.emailNormalized, normalizeEmail(email)), isNull(users.deletedAt)))
    .limit(1);
  return user ?? null;
}

/** The live user whose password matches, or null (constant work whether or not the email exists). */
export async function verifyLoginCredentials(email: string, password: string, db?: DbOrTx): Promise<UserRow | null> {
  const d = db ?? (await getDb());
  const user = await findLoginUser(d, email);
  if (!user?.passwordHash) {
    await verifyPasswordDummy(password);
    return null;
  }
  return (await verifyPassword(password, user.passwordHash)) ? user : null;
}

export type PasswordLoginResult = { user: UserRow; twoFactorRequired: boolean };

/**
 * Checks email and password under the AU-14 limits. Throws AppError("rate_limited", "Too many attempts. Try again in
 * {minutes} minutes.") when a window is full and AppError("unauthorized", INCORRECT_CREDENTIALS_MESSAGE) on bad
 * credentials. On success returns the user and whether the second factor is still required.
 */
export async function authenticateWithPassword(p: {
  email: string;
  password: string;
  meta: RequestMeta;
  db?: DbOrTx;
}): Promise<PasswordLoginResult> {
  const db = p.db ?? (await getDb());
  const emailKey = loginEmailKey(p.email);
  const ipKey = await loginIpKey(p.meta.ip);
  const { loginEmail, loginIp } = AUTH_RATE_LIMITS;
  // AU-14: the 11th failed attempt is rejected before the password is checked. The hit is counted first (atomic
  // INSERT ... ON CONFLICT DO UPDATE), so of any number of parallel attempts at most `limit` reach the scrypt check.
  // Rejected attempts are not audited (unbounded under attack); every checked failure is (bounded by these windows).
  const atMs = nowMs();
  const emailHit = await rateLimit(emailKey, loginEmail.limit, loginEmail.windowSeconds, { db, nowMs: atMs });
  if (!emailHit.ok) throw rateLimitedError(emailHit);
  const ipHit = await rateLimit(ipKey, loginIp.limit, loginIp.windowSeconds, { db, nowMs: atMs });
  if (!ipHit.ok) {
    // Not a guess against this email (the password is never checked): give the email hit back.
    await refundRateLimitHit(emailKey, loginEmail.windowSeconds, { atMs, db });
    throw rateLimitedError(ipHit);
  }
  const user = await verifyLoginCredentials(p.email, p.password, db);
  if (!user) {
    const known = await findLoginUser(db, p.email);
    await auditAuth("user.login_failed", {
      user: known,
      details: { method: "password", reason: "invalid_credentials", ...(known ? {} : { email: normalizeEmail(p.email) }) },
      meta: p.meta,
    });
    throw new AppError("unauthorized", INCORRECT_CREDENTIALS_MESSAGE);
  }
  // Only failures use the windows up: clear the email window, give the IP hit back.
  await resetRateLimit(emailKey, { db });
  await refundRateLimitHit(ipKey, loginIp.windowSeconds, { atMs, db });
  return { user, twoFactorRequired: user.twoFactorEnabled };
}
