// Login method change confirmation (SPEC AU-10, GEN-08): switching how a user logs in (connecting or disconnecting
// Google or Microsoft, Calendly parity) first sends a 6-digit code to the current login email. Codes are stored as
// HMAC-SHA256 with the session secret (hashCode), expire after 10 minutes, allow 5 tries (each one claimed
// atomically before the code is compared, so parallel guesses cannot exceed it), and at most 5 codes
// are sent per user per hour. Settings > Login (settings-onboarding) calls these.
//
// A verified code returns a confirmation token (10 minutes, bound to the user, HMAC with the session secret). The
// link_login_method OAuth start route requires it as ?confirm= (oauthStartPath(provider, { intent:
// "link_login_method", confirm })), so a hijacked session cannot add its own sign-in method without the mailbox.
import "server-only";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { users, verificationCodes } from "@/db/schema";
import { hashCode, hmacSha256Hex, randomCode, timingSafeEqualStr, verifyCode } from "@/lib/crypto";
import { getSecret } from "@/lib/secrets";
import { AppError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { now, nowMs } from "@/lib/time/now";
import { normalizeEmail } from "@/lib/validation";
import { sendLoginMethodCodeEmail } from "./auth-emails";
import { AUTH_RATE_LIMITS, loginMethodCodeKey } from "./rate-limits";

export const LOGIN_METHOD_CODE_TTL_MINUTES = 10;
export const LOGIN_METHOD_CODE_MAX_ATTEMPTS = 5;
export const INVALID_LOGIN_METHOD_CODE_MESSAGE = "That code is incorrect or has expired. Request a new one.";
export const LOGIN_METHOD_CONFIRMATION_TTL_MS = 10 * 60_000;

const PURPOSE = "login_method_change" as const;

/** Sends a new code to the user's login email (rate limited). */
export async function sendLoginMethodCode(userId: string, opts: { db?: DbOrTx; defer?: boolean } = {}): Promise<void> {
  const db = opts.db ?? (await getDb());
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1);
  if (!user) throw new AppError("not_found");
  const { limit, windowSeconds } = AUTH_RATE_LIMITS.loginMethodCode;
  await assertRateLimit(loginMethodCodeKey(user.id), limit, windowSeconds, { db });
  const code = randomCode(6);
  const [row] = await db
    .insert(verificationCodes)
    .values({
      purpose: PURPOSE,
      emailNormalized: normalizeEmail(user.email),
      contextId: user.id,
      codeHash: await hashCode(PURPOSE, user.id, code),
      expiresAt: new Date(now().getTime() + LOGIN_METHOD_CODE_TTL_MINUTES * 60_000),
    })
    .returning({ id: verificationCodes.id });
  if (!row) throw new Error("verification code insert returned no row");
  await sendLoginMethodCodeEmail(user, { code, codeId: row.id, expiresMinutes: LOGIN_METHOD_CODE_TTL_MINUTES, defer: opts.defer });
}

async function confirmationSignature(userId: string, expiresAtMs: number): Promise<string> {
  return hmacSha256Hex(await getSecret("session_secret"), `login-method-confirm:${userId}:${expiresAtMs}`);
}

/** A confirmation token for the user, valid for 10 minutes ("{expiresAtMs}.{hmac}"). */
export async function createLoginMethodConfirmation(userId: string): Promise<string> {
  const expiresAtMs = nowMs() + LOGIN_METHOD_CONFIRMATION_TTL_MS;
  return `${expiresAtMs}.${await confirmationSignature(userId, expiresAtMs)}`;
}

/** True when `token` is an unexpired confirmation of this user. */
export async function checkLoginMethodConfirmation(userId: string, token: string | null | undefined): Promise<boolean> {
  if (!token || token.length > 200) return false;
  const [exp, sig] = token.split(".");
  const expiresAtMs = Number(exp);
  if (!sig || !Number.isFinite(expiresAtMs) || expiresAtMs < nowMs()) return false;
  return timingSafeEqualStr(await confirmationSignature(userId, expiresAtMs), sig);
}

/**
 * Checks and consumes the latest unexpired code of the user and returns a confirmation token for the change. Throws
 * AppError("validation") with a code field error when it is wrong, expired, used up or missing.
 */
export async function verifyLoginMethodCode(userId: string, code: string, opts: { db?: DbOrTx } = {}): Promise<{ confirmation: string }> {
  const db = opts.db ?? (await getDb());
  const fail = () => new AppError("validation", INVALID_LOGIN_METHOD_CODE_MESSAGE, { fieldErrors: { code: [INVALID_LOGIN_METHOD_CODE_MESSAGE] } });
  const digits = code.replace(/\s/g, "");
  const [row] = await db
    .select()
    .from(verificationCodes)
    .where(
      and(
        eq(verificationCodes.purpose, PURPOSE),
        eq(verificationCodes.contextId, userId),
        isNull(verificationCodes.consumedAt),
        gt(verificationCodes.expiresAt, now()),
      ),
    )
    .orderBy(desc(verificationCodes.createdAt))
    .limit(1);
  if (!row) throw fail();
  // Claim one of the 5 tries atomically BEFORE checking the code, so parallel guesses cannot all read attempts = 0.
  const claimed = await db
    .update(verificationCodes)
    .set({ attempts: sql`${verificationCodes.attempts} + 1` })
    .where(
      and(
        eq(verificationCodes.id, row.id),
        isNull(verificationCodes.consumedAt),
        lt(verificationCodes.attempts, LOGIN_METHOD_CODE_MAX_ATTEMPTS),
      ),
    )
    .returning({ id: verificationCodes.id });
  if (!claimed.length) throw fail();
  if (!/^\d{6}$/.test(digits) || !(await verifyCode(PURPOSE, userId, digits, row.codeHash))) throw fail();
  const consumed = await db
    .update(verificationCodes)
    .set({ consumedAt: now() })
    .where(and(eq(verificationCodes.id, row.id), isNull(verificationCodes.consumedAt)))
    .returning({ id: verificationCodes.id });
  if (!consumed.length) throw fail();
  return { confirmation: await createLoginMethodConfirmation(userId) };
}
