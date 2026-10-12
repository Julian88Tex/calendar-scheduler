// Email and password signup (SPEC AU-01, AU-08, AU-11, AU-13, AU-14, GEN-17), testable without Next:
// - checkSignupEmail (step 1 "Continue with email"): format, "An account with this email already exists. Log in
//   instead." and the signup policy, limited per IP;
// - signUpWithPassword (step 2 "Sign up"): 20 signups per IP per hour, scrypt hash, createAccountUnderPolicy inside one
//   transaction (signup advisory lock, first account is instance admin), audit user.signup, then the welcome and the
//   "Verify your email" emails after the response. The caller creates the session and redirects to POST_SIGNUP_PATH.
import "server-only";
import { getDb, type DbOrTx } from "@/db";
import { hashPassword } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { assertRateLimit } from "@/lib/rate-limit";
import { isValidTimeZone } from "@/lib/validation";
import { signupPolicyAllows } from "../policy";
import type { UserRow } from "../session";
import { EMAIL_TAKEN_MESSAGE, createAccountUnderPolicy, findUserByEmail } from "../signup";
import { sendVerificationEmail } from "../verify-email";
import { auditAuth } from "./audit";
import { sendWelcomeEmail } from "./auth-emails";
import { AUTH_RATE_LIMITS, signupEmailCheckIpKey, signupIpKey } from "./rate-limits";
import type { RequestMeta } from "./request-context";

/**
 * Where a new account lands. The onboarding wizard is outside the reduced scope (docs/SCOPE.md), so new accounts go
 * straight to Scheduling with the AU-13 defaults (URL from the name, browser time zone, "30 Minute Meeting").
 */
export const POST_SIGNUP_PATH = "/app/scheduling";

/** Step 1: throws AppError with an email field error when the address cannot sign up. */
export async function checkSignupEmail(p: { email: string; meta: RequestMeta; db?: DbOrTx }): Promise<void> {
  const db = p.db ?? (await getDb());
  const { limit, windowSeconds } = AUTH_RATE_LIMITS.signupEmailCheckIp;
  await assertRateLimit(await signupEmailCheckIpKey(p.meta.ip), limit, windowSeconds, { db });
  if (await findUserByEmail(db, p.email)) {
    throw new AppError("conflict", EMAIL_TAKEN_MESSAGE, { fieldErrors: { email: [EMAIL_TAKEN_MESSAGE] } });
  }
  const decision = await signupPolicyAllows(p.email, { db });
  if (!decision.allowed) throw new AppError("forbidden", decision.message, { fieldErrors: { email: [decision.message] } });
}

/** Step 2: creates the account (see the file header). */
export async function signUpWithPassword(p: {
  email: string;
  name: string;
  password: string;
  timezone?: string | null;
  meta: RequestMeta;
  db?: DbOrTx;
}): Promise<{ user: UserRow; firstUser: boolean }> {
  const db = p.db ?? (await getDb());
  const { limit, windowSeconds } = AUTH_RATE_LIMITS.signupIp;
  await assertRateLimit(await signupIpKey(p.meta.ip), limit, windowSeconds, { db });
  const passwordHash = await hashPassword(p.password);
  const { user, decision } = await db.transaction((tx) =>
    createAccountUnderPolicy(tx, {
      email: p.email,
      name: p.name,
      passwordHash,
      timezone: p.timezone && isValidTimeZone(p.timezone) ? p.timezone : null,
    }),
  );
  const firstUser = decision.allowed && decision.firstUser;
  await auditAuth("user.signup", { user, details: { method: "password", ...(firstUser ? { instanceAdmin: true } : {}) }, meta: p.meta });
  await sendWelcomeEmail(user);
  await sendVerificationEmail(user.id, { db }).catch((e: unknown) => log.error("auth.verification_email_failed", { userId: user.id, error: e }));
  return { user, firstUser };
}
