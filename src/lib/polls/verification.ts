// "Verify email" for votes (SPEC MP-04, MP-09, MP-30): 6-digit codes stored as HMAC (hashCode) in verification_codes
// with purpose poll_vote and context_id = poll id, valid 10 minutes, 5 attempts, at most 5 codes per email per hour.
// The code email job receives the code encrypted at rest. Server only.
import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import { verificationCodes } from "@/db/schema";
import { encrypt, hashCode, hashToken, randomCode, verifyCode } from "@/lib/crypto";
import { rateLimit, rateLimitedError } from "@/lib/rate-limit";
import { POLL_ERRORS, VERIFICATION_CODES_PER_HOUR, VERIFICATION_MAX_ATTEMPTS, VERIFICATION_TTL_MS } from "./constants";
import { enqueuePollEmail } from "./schedule";

const PURPOSE = "poll_vote" as const;

export type VoteCodeCheck = "ok" | "invalid" | "expired" | "too_many_attempts" | "not_found";

/** Sends a new code (earlier unused codes stop working). Throws rate_limited beyond 5 per email per hour. */
export async function issueVoteCode(db: DbOrTx, p: { pollId: string; email: string; at: Date }): Promise<{ expiresAt: Date }> {
  const emailNormalized = p.email.trim().toLowerCase();
  const limit = await rateLimit(`poll-code:email:${hashToken(emailNormalized)}`, VERIFICATION_CODES_PER_HOUR, 3600, { db, nowMs: p.at.getTime() });
  if (!limit.ok) throw rateLimitedError(limit);
  await db
    .update(verificationCodes)
    .set({ consumedAt: p.at })
    .where(and(eq(verificationCodes.purpose, PURPOSE), eq(verificationCodes.contextId, p.pollId), eq(verificationCodes.emailNormalized, emailNormalized), isNull(verificationCodes.consumedAt)));
  const code = randomCode(6);
  const expiresAt = new Date(p.at.getTime() + VERIFICATION_TTL_MS);
  const [row] = await db
    .insert(verificationCodes)
    .values({ purpose: PURPOSE, emailNormalized, codeHash: await hashCode(PURPOSE, p.pollId, code), contextId: p.pollId, expiresAt, createdAt: p.at })
    .returning({ id: verificationCodes.id });
  await enqueuePollEmail(db, { template: "verification_code", pollId: p.pollId, email: p.email.trim(), data: { codeEnc: await encrypt(code) } }, `${p.pollId}:code:${row!.id}`, p.at, 20);
  return { expiresAt };
}

/** Checks (and on success consumes) the latest code of an email for a poll; a wrong code counts one attempt. */
export async function checkVoteCode(db: DbOrTx, p: { pollId: string; email: string; code: string; at: Date }): Promise<VoteCodeCheck> {
  const emailNormalized = p.email.trim().toLowerCase();
  const code = p.code.replace(/\s+/g, "");
  const [row] = await db
    .select()
    .from(verificationCodes)
    .where(and(eq(verificationCodes.purpose, PURPOSE), eq(verificationCodes.contextId, p.pollId), eq(verificationCodes.emailNormalized, emailNormalized), isNull(verificationCodes.consumedAt)))
    .orderBy(desc(verificationCodes.createdAt))
    .limit(1);
  if (!row) return "not_found";
  if (row.expiresAt.getTime() <= p.at.getTime()) return "expired";
  if (row.attempts >= VERIFICATION_MAX_ATTEMPTS) return "too_many_attempts";
  if (!/^\d{6}$/.test(code) || !(await verifyCode(PURPOSE, p.pollId, code, row.codeHash))) {
    await db.update(verificationCodes).set({ attempts: sql`${verificationCodes.attempts} + 1` }).where(eq(verificationCodes.id, row.id));
    return row.attempts + 1 >= VERIFICATION_MAX_ATTEMPTS ? "too_many_attempts" : "invalid";
  }
  await db.update(verificationCodes).set({ consumedAt: p.at }).where(eq(verificationCodes.id, row.id));
  return "ok";
}

export function codeCheckMessage(r: Exclude<VoteCodeCheck, "ok">): string {
  if (r === "expired") return POLL_ERRORS.verificationExpired;
  if (r === "too_many_attempts") return POLL_ERRORS.verificationTooMany;
  if (r === "not_found") return POLL_ERRORS.verificationRequired;
  return POLL_ERRORS.verificationInvalid;
}
