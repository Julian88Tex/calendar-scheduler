// Login method change confirmation (SPEC AU-10, GEN-08): switching how a user logs in (connecting or disconnecting
// Google or Microsoft, Calendly parity) first sends a 6-digit code to the current login email. Codes are stored as
// HMAC-SHA256 with the session secret (hashCode), expire after 10 minutes, allow 5 wrong tries, and at most 5 codes
// are sent per user per hour. Settings > Login (settings-onboarding) calls these; the OAuth link flow runs after a
// confirmed code.
import "server-only";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { users, verificationCodes } from "@/db/schema";
import { hashCode, randomCode, verifyCode } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { now } from "@/lib/time/now";
import { normalizeEmail } from "@/lib/validation";
import { sendLoginMethodCodeEmail } from "./auth-emails";
import { AUTH_RATE_LIMITS, loginMethodCodeKey } from "./rate-limits";

export const LOGIN_METHOD_CODE_TTL_MINUTES = 10;
export const LOGIN_METHOD_CODE_MAX_ATTEMPTS = 5;
export const INVALID_LOGIN_METHOD_CODE_MESSAGE = "That code is incorrect or has expired. Request a new one.";

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

/**
 * Checks and consumes the latest unexpired code of the user. Throws AppError("validation") with a code field error
 * when it is wrong, expired, used up or missing.
 */
export async function verifyLoginMethodCode(userId: string, code: string, opts: { db?: DbOrTx } = {}): Promise<void> {
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
  if (!row || row.attempts >= LOGIN_METHOD_CODE_MAX_ATTEMPTS) throw fail();
  if (!/^\d{6}$/.test(digits) || !(await verifyCode(PURPOSE, userId, digits, row.codeHash))) {
    await db
      .update(verificationCodes)
      .set({ attempts: sql`${verificationCodes.attempts} + 1` })
      .where(eq(verificationCodes.id, row.id));
    throw fail();
  }
  const consumed = await db
    .update(verificationCodes)
    .set({ consumedAt: now() })
    .where(and(eq(verificationCodes.id, row.id), isNull(verificationCodes.consumedAt)))
    .returning({ id: verificationCodes.id });
  if (!consumed.length) throw fail();
}
