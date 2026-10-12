// Two-factor authentication, server side (SPEC AU-09, AU-14, GEN-08, GEN-17).
//
// - The TOTP secret is stored encrypted (users.two_factor_secret_enc, AES-256-GCM). A code is accepted for the current
//   30-second step or one step of drift, and never twice: the last accepted step is kept in users.metadata
//   (totpLastStep) and an atomic update rejects a replay.
// - Recovery codes: 10 one-time codes, stored as HMAC-SHA256 with the session secret (hashCode), bound to the user;
//   using one marks it used atomically, so it works exactly once.
// - The login challenge (/login/two-factor) runs on a two_factor_pending session, limited to 5 attempts per session
//   per 5 minutes; success clears the pending flag and audits user.login.
// - Enrollment helpers for Settings > Login (settings-onboarding owns the UI): beginTwoFactorEnrollment (secret and
//   otpauth URI), enableTwoFactor (confirms a code, stores the secret, returns the recovery codes), disableTwoFactor
//   and regenerateRecoveryCodes.
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, rowsOf, withTx, type DbOrTx } from "@/db";
import { twoFactorRecoveryCodes, users } from "@/db/schema";
import { appName } from "@/lib/brand";
import { decryptOrNull, encrypt, hashCode, verifyPassword } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { assertRateLimit } from "@/lib/rate-limit";
import { now, nowMs } from "@/lib/time/now";
import { completeTwoFactor, type UserRow } from "../session";
import {
  RECOVERY_CODE_COUNT,
  generateRecoveryCodes,
  generateTotpSecret,
  looksLikeRecoveryCode,
  matchTotpStep,
  normalizeRecoveryCode,
  totpUri,
} from "../totp";
import { auditAuth } from "./audit";
import { AUTH_RATE_LIMITS, twoFactorSessionKey } from "./rate-limits";
import type { RequestMeta } from "./request-context";

export const INVALID_TOTP_MESSAGE = "That code didn't work. Check your authenticator app and try again.";
export const INVALID_RECOVERY_CODE_MESSAGE = "That recovery code didn't work. Check it and try again.";

const RECOVERY_PURPOSE = "2fa_recovery";

/** HMAC of a recovery code bound to its user (never stored in plaintext). */
export async function hashRecoveryCode(userId: string, code: string): Promise<string> {
  return hashCode(RECOVERY_PURPOSE, userId, normalizeRecoveryCode(code));
}

/** Replaces every recovery code of the user with RECOVERY_CODE_COUNT new ones and returns them (shown once). */
export async function replaceRecoveryCodes(db: DbOrTx, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  const hashes = await Promise.all(codes.map((c) => hashRecoveryCode(userId, c)));
  await withTx(db, async (tx) => {
    await tx.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, userId));
    await tx.insert(twoFactorRecoveryCodes).values(hashes.map((codeHash) => ({ userId, codeHash })));
  });
  return codes;
}

/** Marks a matching unused recovery code as used; true when one was consumed (atomic: one use only). */
export async function consumeRecoveryCode(db: DbOrTx, userId: string, code: string): Promise<boolean> {
  if (!looksLikeRecoveryCode(code)) return false;
  const codeHash = await hashRecoveryCode(userId, code);
  const rows = await db
    .update(twoFactorRecoveryCodes)
    .set({ usedAt: now() })
    .where(
      and(
        eq(twoFactorRecoveryCodes.userId, userId),
        eq(twoFactorRecoveryCodes.codeHash, codeHash),
        isNull(twoFactorRecoveryCodes.usedAt),
      ),
    )
    .returning({ id: twoFactorRecoveryCodes.id });
  return rows.length > 0;
}

/** Unused recovery codes left for the user. */
export async function remainingRecoveryCodes(db: DbOrTx, userId: string): Promise<number> {
  const rows = await db
    .select({ id: twoFactorRecoveryCodes.id })
    .from(twoFactorRecoveryCodes)
    .where(and(eq(twoFactorRecoveryCodes.userId, userId), isNull(twoFactorRecoveryCodes.usedAt)));
  return rows.length;
}

/**
 * Verifies a TOTP code against the user's stored secret and records the accepted step so the same code cannot be
 * replayed. False for a wrong code, a replay, or a secret that can no longer be decrypted (ENCRYPTION_KEY changed).
 */
export async function verifyUserTotp(
  db: DbOrTx,
  user: Pick<UserRow, "id" | "twoFactorSecretEnc">,
  code: string,
): Promise<boolean> {
  const secret = await decryptOrNull(user.twoFactorSecretEnc);
  if (!secret) return false;
  const step = matchTotpStep(secret, code, { atMs: nowMs() });
  if (step === null) return false;
  // Atomic replay check: only one request can move totpLastStep forward to (or past) this step.
  const res = await db.execute(sql`
    update users
       set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{totpLastStep}', to_jsonb(${step}::bigint))
     where id = ${user.id}
       and coalesce((metadata->>'totpLastStep')::bigint, -1) < ${step}::bigint
    returning id`);
  return rowsOf<{ id: string }>(res).length > 0;
}

export type TwoFactorMethod = "totp" | "recovery";

/**
 * The /login/two-factor challenge for a two_factor_pending session. Throws AppError("rate_limited") after 5 attempts
 * per session per 5 minutes and AppError("validation") with a code field error for a wrong code. On success the
 * session becomes fully authenticated and user.login is audited.
 */
export async function completeTwoFactorChallenge(p: {
  sessionId: string;
  user: UserRow;
  method: TwoFactorMethod;
  code: string;
  meta: RequestMeta;
  loginMethod?: string;
  db?: DbOrTx;
}): Promise<{ remainingRecoveryCodes: number | null }> {
  const db = p.db ?? (await getDb());
  const { limit, windowSeconds } = AUTH_RATE_LIMITS.twoFactorSession;
  await assertRateLimit(twoFactorSessionKey(p.sessionId), limit, windowSeconds, { db });
  if (!p.user.twoFactorEnabled) throw new AppError("forbidden", "Two-factor authentication is not enabled for this account.");
  const ok =
    p.method === "totp" ? await verifyUserTotp(db, p.user, p.code) : await consumeRecoveryCode(db, p.user.id, p.code);
  if (!ok) {
    await auditAuth("user.login_failed", {
      user: p.user,
      details: { reason: p.method === "totp" ? "invalid_two_factor_code" : "invalid_recovery_code" },
      meta: p.meta,
    });
    const message = p.method === "totp" ? INVALID_TOTP_MESSAGE : INVALID_RECOVERY_CODE_MESSAGE;
    throw new AppError("validation", message, { fieldErrors: { code: [message] } });
  }
  await completeTwoFactor(p.sessionId);
  await db.update(users).set({ lastLoginAt: now(), lastActiveAt: now() }).where(eq(users.id, p.user.id));
  await auditAuth("user.login", {
    user: p.user,
    details: { method: p.loginMethod ?? "password", twoFactor: p.method },
    meta: p.meta,
  });
  return { remainingRecoveryCodes: p.method === "recovery" ? await remainingRecoveryCodes(db, p.user.id) : null };
}

// ---------------------------------------------------------------------------------------------------------------
// Enrollment (Settings > Login, settings-onboarding UI)

/** A new secret and its otpauth:// URI for the QR code (nothing is stored until enableTwoFactor). */
export function beginTwoFactorEnrollment(user: Pick<UserRow, "email">): { secretBase32: string; otpauthUri: string } {
  const secretBase32 = generateTotpSecret();
  return { secretBase32, otpauthUri: totpUri({ secretBase32, accountName: user.email, issuer: appName() }) };
}

/**
 * Confirms the first code for `secretBase32`, stores the encrypted secret, enables 2FA and returns 10 new recovery
 * codes. Throws AppError("validation") with a code field error when the code does not match.
 */
export async function enableTwoFactor(p: {
  user: Pick<UserRow, "id" | "name" | "email">;
  secretBase32: string;
  code: string;
  meta?: RequestMeta;
  db?: DbOrTx;
}): Promise<{ recoveryCodes: string[] }> {
  const db = p.db ?? (await getDb());
  const step = matchTotpStep(p.secretBase32, p.code, { atMs: nowMs() });
  if (step === null) throw new AppError("validation", INVALID_TOTP_MESSAGE, { fieldErrors: { code: [INVALID_TOTP_MESSAGE] } });
  const secretEnc = await encrypt(p.secretBase32);
  return withTx(db, async (tx) => {
    await tx
      .update(users)
      .set({
        twoFactorEnabled: true,
        twoFactorSecretEnc: secretEnc,
        metadata: sql`jsonb_set(coalesce(${users.metadata}, '{}'::jsonb), '{totpLastStep}', to_jsonb(${step}::bigint))`,
      })
      .where(eq(users.id, p.user.id));
    const recoveryCodes = await replaceRecoveryCodes(tx, p.user.id);
    await auditAuth("user.two_factor_enabled", { user: p.user, meta: p.meta, tx });
    return { recoveryCodes };
  });
}

/**
 * Turns 2FA off after checking the password (when the account has one) and a current TOTP or recovery code. Throws
 * AppError("validation") with field errors (password or code).
 */
export async function disableTwoFactor(p: {
  user: UserRow;
  code: string;
  password?: string | null;
  meta?: RequestMeta;
  db?: DbOrTx;
}): Promise<void> {
  const db = p.db ?? (await getDb());
  if (p.user.passwordHash && !(await verifyPassword(p.password ?? "", p.user.passwordHash))) {
    throw new AppError("validation", "Incorrect password.", { fieldErrors: { password: ["Incorrect password."] } });
  }
  const ok = (await verifyUserTotp(db, p.user, p.code)) || (await consumeRecoveryCode(db, p.user.id, p.code));
  if (!ok) throw new AppError("validation", INVALID_TOTP_MESSAGE, { fieldErrors: { code: [INVALID_TOTP_MESSAGE] } });
  await withTx(db, async (tx) => {
    await tx.update(users).set({ twoFactorEnabled: false, twoFactorSecretEnc: null }).where(eq(users.id, p.user.id));
    await tx.delete(twoFactorRecoveryCodes).where(eq(twoFactorRecoveryCodes.userId, p.user.id));
    await auditAuth("user.two_factor_disabled", { user: p.user, meta: p.meta, tx });
  });
}

/** New recovery codes for an enrolled user (the old ones stop working). */
export async function regenerateRecoveryCodes(p: {
  user: Pick<UserRow, "id" | "name" | "email" | "twoFactorEnabled">;
  meta?: RequestMeta;
  db?: DbOrTx;
}): Promise<string[]> {
  if (!p.user.twoFactorEnabled) throw new AppError("forbidden", "Two-factor authentication is not enabled for this account.");
  const db = p.db ?? (await getDb());
  return withTx(db, async (tx) => {
    const codes = await replaceRecoveryCodes(tx, p.user.id);
    await auditAuth("user.recovery_codes_regenerated", { user: p.user, meta: p.meta, tx });
    return codes;
  });
}
