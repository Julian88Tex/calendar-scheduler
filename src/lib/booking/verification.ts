// Email verification before booking (SPEC BK-17, GEN-08): 6-digit codes stored as HMAC (hashCode), valid 10 minutes,
// 5 attempts, resend at most 5 times per hour; "Remember this device" tokens (365 days per email) in the embed-safe
// cookie TRUSTED_DEVICE_COOKIE (several tokens, one per remembered email, joined with ".").
import "server-only";
import { and, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { trustedDevices, verificationCodes } from "@/db/schema";
import { encrypt, hashCode, hashToken, randomCode, randomToken, verifyCode } from "@/lib/crypto";
import { enqueueJob } from "@/lib/jobs";

export const VERIFICATION_PURPOSE = "booking" as const;
export const VERIFICATION_CODE_TTL_MS = 10 * 60_000;
export const VERIFICATION_MAX_ATTEMPTS = 5;
export const VERIFICATION_RESENDS_PER_HOUR = 5;
export const TRUSTED_DEVICE_COOKIE = "kairos_trusted_device";
export const TRUSTED_DEVICE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;
const MAX_DEVICE_TOKENS = 5;
/** Job that renders and sends the code email (src/lib/booking/jobs.ts). */
export const SEND_CODE_JOB = "booking.send_verification_code";

export type CodeCheck = "ok" | "invalid" | "expired" | "too_many_attempts" | "not_found";

/**
 * Creates a new code for a reservation (earlier unused codes stop working) and enqueues the email job with the code
 * encrypted at rest. Call inside the reservation transaction or right after it.
 */
export async function issueVerificationCode(
  db: DbOrTx,
  p: { reservationId: string; email: string; at: Date },
): Promise<{ codeId: string; expiresAt: Date }> {
  const emailNormalized = p.email.trim().toLowerCase();
  await db
    .update(verificationCodes)
    .set({ consumedAt: p.at })
    .where(
      and(
        eq(verificationCodes.purpose, VERIFICATION_PURPOSE),
        eq(verificationCodes.contextId, p.reservationId),
        isNull(verificationCodes.consumedAt),
      ),
    );
  const code = randomCode(6);
  const expiresAt = new Date(p.at.getTime() + VERIFICATION_CODE_TTL_MS);
  const [row] = await db
    .insert(verificationCodes)
    .values({
      purpose: VERIFICATION_PURPOSE,
      emailNormalized,
      codeHash: await hashCode(VERIFICATION_PURPOSE, p.reservationId, code),
      contextId: p.reservationId,
      expiresAt,
    })
    .returning({ id: verificationCodes.id });
  if (!row) throw new Error("issueVerificationCode: insert returned no row");
  await enqueueJob(db, {
    type: SEND_CODE_JOB,
    payload: { codeId: row.id, reservationId: p.reservationId, email: p.email.trim(), codeEnc: await encrypt(code) },
    idempotencyKey: `booking-code:${row.id}`,
    groupKey: `booking-code:${p.reservationId}`,
    priority: 20,
    maxAttempts: 5,
  });
  return { codeId: row.id, expiresAt };
}

/** Checks a submitted code; a wrong code counts one attempt (atomically, so 5 attempts hold under concurrency). */
export async function checkVerificationCode(
  db: DbOrTx,
  p: { reservationId: string; code: string; at: Date },
): Promise<CodeCheck> {
  const code = p.code.replace(/\s+/g, "");
  const [row] = await db
    .select()
    .from(verificationCodes)
    .where(
      and(
        eq(verificationCodes.purpose, VERIFICATION_PURPOSE),
        eq(verificationCodes.contextId, p.reservationId),
        isNull(verificationCodes.consumedAt),
      ),
    )
    .orderBy(desc(verificationCodes.createdAt))
    .limit(1);
  if (!row) return "not_found";
  if (row.expiresAt.getTime() <= p.at.getTime()) return "expired";
  if (row.attempts >= VERIFICATION_MAX_ATTEMPTS) return "too_many_attempts";
  if (/^\d{6}$/.test(code) && (await verifyCode(VERIFICATION_PURPOSE, p.reservationId, code, row.codeHash))) {
    await db
      .update(verificationCodes)
      .set({ consumedAt: p.at })
      .where(and(eq(verificationCodes.id, row.id), isNull(verificationCodes.consumedAt)));
    return "ok";
  }
  const [bumped] = await db
    .update(verificationCodes)
    .set({ attempts: sql`${verificationCodes.attempts} + 1` })
    .where(and(eq(verificationCodes.id, row.id), lt(verificationCodes.attempts, VERIFICATION_MAX_ATTEMPTS)))
    .returning({ attempts: verificationCodes.attempts });
  if (!bumped || bumped.attempts >= VERIFICATION_MAX_ATTEMPTS) return "too_many_attempts";
  return "invalid";
}

/** Splits the cookie value into tokens. */
export function parseTrustedDeviceCookie(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(".")
    .map((t) => t.trim())
    .filter((t) => /^[A-Za-z0-9_-]{20,100}$/.test(t))
    .slice(0, MAX_DEVICE_TOKENS);
}

/** Creates a remembered device for an email; returns the new cookie value (existing tokens kept, newest first). */
export async function rememberDevice(
  db: DbOrTx,
  p: { email: string; at: Date; existing?: string[] },
): Promise<string> {
  const token = randomToken(24);
  await db.insert(trustedDevices).values({
    emailNormalized: p.email.trim().toLowerCase(),
    tokenHash: hashToken(token),
    expiresAt: new Date(p.at.getTime() + TRUSTED_DEVICE_MAX_AGE_SECONDS * 1000),
  });
  return [token, ...(p.existing ?? [])].slice(0, MAX_DEVICE_TOKENS).join(".");
}

/** True when one of the tokens remembers this email and has not expired. */
export async function isTrustedDevice(db: DbOrTx, tokens: readonly string[] | undefined, email: string, at: Date): Promise<boolean> {
  const list = (tokens ?? []).filter((t) => typeof t === "string" && t.length >= 20).slice(0, MAX_DEVICE_TOKENS);
  if (list.length === 0) return false;
  const rows = await db
    .select({ id: trustedDevices.id })
    .from(trustedDevices)
    .where(
      and(
        inArray(trustedDevices.tokenHash, list.map(hashToken)),
        eq(trustedDevices.emailNormalized, email.trim().toLowerCase()),
        gt(trustedDevices.expiresAt, at),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
