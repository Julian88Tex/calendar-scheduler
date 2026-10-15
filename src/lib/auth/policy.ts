// Signup policy (SPEC AU-11): instance setting signup_policy ("invite_only" default once an account exists, "open",
// "domains" with signup_domains), overridden by the SIGNUP_POLICY env var. The very first signup of a fresh instance is
// always allowed and becomes the instance admin and org owner (the first-account exception). When OWNER_EMAIL is set
// (src/lib/setup/config.ts, the same check as the owner bootstrap) that exception applies only to that address
// (case-insensitive, trimmed) and only when the signup proves it (a verified Google or Microsoft email): any other first
// signup follows the policy like everyone else and never becomes instance admin, so nobody can claim a fresh instance by
// signing up before the owner. A password signup proves nothing (anyone can type the owner's address), so with the
// owner's address it follows the policy too, like the bootstrap, which refuses an unverified owner account as possibly
// a squatter's. A set but malformed OWNER_EMAIL gives the exception to nobody, like it disables the bootstrap.
// ADMIN_EMAILS addresses may always sign up (they become instance admins once their email is verified,
// src/lib/authz.ts). Invitation acceptance bypasses the policy.
//
// signupPolicyAllows() reads the user count, so a caller that creates an account must evaluate it inside the signup
// transaction after taking the signup advisory lock (createAccountUnderPolicy in src/lib/auth/signup.ts); otherwise
// two simultaneous first signups could both become instance admin.
import "server-only";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { instanceSettings, organizations, users } from "@/db/schema";
import { adminEmails, getEnv } from "@/lib/env";
import { isAppError } from "@/lib/errors";
import { configuredOwnerEmail } from "@/lib/setup/config";
import { normalizeEmail } from "@/lib/validation";

export type SignupPolicy = "invite_only" | "open" | "domains";

export type SignupDecision =
  | { allowed: true; firstUser: boolean; policy: SignupPolicy; joinOrganizationId: string | null }
  | { allowed: false; firstUser: false; policy: SignupPolicy; message: string };

export const SIGNUPS_CLOSED_MESSAGE = "Sign ups are closed. Ask an admin for an invitation.";

/** The owner's address on a fresh instance, refused because the signup does not prove it (a password signup). */
export const OWNER_SIGNUP_NEEDS_PROOF_MESSAGE =
  'To create the owner account, use "Continue with Google" (or Microsoft) with this address. A password signup does not prove the address is yours.';

/** Options of the policy checks: whether the signup proves the address (a verified Google or Microsoft email). */
export type SignupProof = { emailVerified?: boolean };

/** Labels of the instance setting "Who can sign up" (Admin > Instance). */
export const SIGNUP_POLICY_LABELS: Record<SignupPolicy, string> = {
  invite_only: "Only people I invite",
  open: "Anyone",
  domains: "Anyone with an email at these domains",
};

function asPolicy(value: unknown): SignupPolicy | null {
  return value === "invite_only" || value === "open" || value === "domains" ? value : null;
}

/** True when SIGNUP_POLICY is set (the admin setting is then read only). */
export function signupPolicyFromEnv(): SignupPolicy | null {
  return asPolicy(getEnv().SIGNUP_POLICY);
}

/** The effective policy: SIGNUP_POLICY env, else the instance setting, else invite_only. */
export async function getSignupPolicy(db?: DbOrTx): Promise<SignupPolicy> {
  const fromEnv = signupPolicyFromEnv();
  if (fromEnv) return fromEnv;
  const d = db ?? (await getDb());
  const [row] = await d.select({ value: instanceSettings.value }).from(instanceSettings).where(eq(instanceSettings.key, "signup_policy")).limit(1);
  return asPolicy(row?.value) ?? "invite_only";
}

/** Lowercase email domains allowed by the "domains" policy (instance setting signup_domains). */
export async function getSignupDomains(db?: DbOrTx): Promise<string[]> {
  const d = db ?? (await getDb());
  const [row] = await d.select({ value: instanceSettings.value }).from(instanceSettings).where(eq(instanceSettings.key, "signup_domains")).limit(1);
  if (!Array.isArray(row?.value)) return [];
  return (row.value as unknown[])
    .map((v) => String(v).trim().toLowerCase().replace(/^@/, ""))
    .filter((v) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(v));
}

/** The domain part of an email ("" when malformed). */
export function emailDomain(email: string): string {
  const at = normalizeEmail(email).lastIndexOf("@");
  return at > 0 ? normalizeEmail(email).slice(at + 1) : "";
}

/** True when the email is listed in ADMIN_EMAILS. */
export function isAdminEmail(email: string): boolean {
  return adminEmails().includes(normalizeEmail(email));
}

/** OWNER_EMAIL (normalized), null when unset, undefined when set but malformed. */
function ownerEmail(): string | null | undefined {
  try {
    return configuredOwnerEmail();
  } catch (e) {
    if (isAppError(e) && e.code === "not_configured") return undefined;
    throw e;
  }
}

/**
 * Whether the first-account exception (allowed whatever the policy, instance admin) may apply to this signup: anyone
 * while OWNER_EMAIL is unset; when it is set, only OWNER_EMAIL (case-insensitive, trimmed) with a proven address
 * (`emailVerified`, never a password signup); nobody while it is malformed.
 */
export function firstAccountExceptionAllows(email: string, proof: SignupProof = {}): boolean {
  const owner = ownerEmail();
  if (owner === null) return true;
  return owner !== undefined && proof.emailVerified === true && normalizeEmail(email) === owner;
}

/** Live (not deleted) accounts on the instance. */
export async function countLiveUsers(db?: DbOrTx): Promise<number> {
  const d = db ?? (await getDb());
  const [{ n } = { n: 0 }] = await d.select({ n: count() }).from(users).where(isNull(users.deletedAt));
  return Number(n);
}

/** The oldest live organization (the "domains" policy joins it as User). */
async function firstOrganizationId(db: DbOrTx): Promise<string | null> {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(and(isNull(organizations.deletedAt)))
    .orderBy(asc(organizations.createdAt))
    .limit(1);
  return org?.id ?? null;
}

/**
 * Whether a new account may be created for this email (outside an invitation). `emailVerified`: the signup proves the
 * address (OAuth with a verified email); leave it unset for a password signup.
 */
export async function signupPolicyAllows(email: string, opts: { db?: DbOrTx } & SignupProof = {}): Promise<SignupDecision> {
  const db = opts.db ?? (await getDb());
  const n = await countLiveUsers(db);
  const policy = await getSignupPolicy(db);
  if (n === 0 && firstAccountExceptionAllows(email, opts)) return { allowed: true, firstUser: true, policy, joinOrganizationId: null };
  if (policy === "open") return { allowed: true, firstUser: false, policy, joinOrganizationId: null };
  let domainMatch = false;
  if (policy === "domains") {
    const domain = emailDomain(email);
    domainMatch = Boolean(domain && (await getSignupDomains(db)).includes(domain));
    if (domainMatch) return { allowed: true, firstUser: false, policy, joinOrganizationId: await firstOrganizationId(db) };
  }
  if (isAdminEmail(email)) return { allowed: true, firstUser: false, policy, joinOrganizationId: null };
  // Only the owner's unproven signup of a fresh instance gets here with the owner's address: tell them how to proceed.
  const owner = n === 0 ? ownerEmail() : null;
  const message = owner && normalizeEmail(email) === owner ? OWNER_SIGNUP_NEEDS_PROOF_MESSAGE : SIGNUPS_CLOSED_MESSAGE;
  return { allowed: false, firstUser: false, policy, message };
}

export type SignupAvailability = {
  policy: SignupPolicy;
  /**
   * No account exists yet: the next signup becomes the instance admin (when OWNER_EMAIL is set, only the owner's with
   * a verified address).
   */
  firstUser: boolean;
  /**
   * Whether /signup shows the form. False only when nobody without an invitation can sign up (invite_only with
   * accounts and no ADMIN_EMAILS); the "domains" policy shows the form and checks the email on submit.
   */
  open: boolean;
};

/** What the signup and login pages show (closed message, "Sign up for free" link). */
export async function getSignupAvailability(db?: DbOrTx): Promise<SignupAvailability> {
  const d = db ?? (await getDb());
  const [n, policy] = await Promise.all([countLiveUsers(d), getSignupPolicy(d)]);
  const firstUser = n === 0;
  const open = firstUser || policy !== "invite_only" || adminEmails().length > 0;
  return { policy, firstUser, open };
}
