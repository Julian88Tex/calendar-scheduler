// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Signup policy (SPEC AU-11): instance setting signup_policy ("invite_only" default once an account exists, "open",
// "domains" with signup_domains), overridden by the SIGNUP_POLICY env var. The very first signup of a fresh instance is
// always allowed and becomes the instance admin and org owner. Invitation acceptance bypasses the policy.
// Foundation stub: a minimal real implementation of these rules (foundation-auth owns and extends it).
import "server-only";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { instanceSettings, organizations, users } from "@/db/schema";
import { getEnv } from "@/lib/env";

export type SignupPolicy = "invite_only" | "open" | "domains";

export type SignupDecision =
  | { allowed: true; firstUser: boolean; policy: SignupPolicy; joinOrganizationId: string | null }
  | { allowed: false; firstUser: false; policy: SignupPolicy; message: string };

export const SIGNUPS_CLOSED_MESSAGE = "Sign ups are closed. Ask an admin for an invitation.";

function asPolicy(value: unknown): SignupPolicy | null {
  return value === "invite_only" || value === "open" || value === "domains" ? value : null;
}

/** The effective policy: SIGNUP_POLICY env, else the instance setting, else invite_only. */
export async function getSignupPolicy(db?: DbOrTx): Promise<SignupPolicy> {
  const fromEnv = asPolicy(getEnv().SIGNUP_POLICY);
  if (fromEnv) return fromEnv;
  const d = db ?? (await getDb());
  const [row] = await d.select({ value: instanceSettings.value }).from(instanceSettings).where(eq(instanceSettings.key, "signup_policy")).limit(1);
  return asPolicy(row?.value) ?? "invite_only";
}

/** Whether a new account may be created for this email (outside an invitation). */
export async function signupPolicyAllows(email: string, opts: { db?: DbOrTx } = {}): Promise<SignupDecision> {
  const db = opts.db ?? (await getDb());
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(users).where(isNull(users.deletedAt));
  const policy = await getSignupPolicy(db);
  if (Number(n) === 0) return { allowed: true, firstUser: true, policy, joinOrganizationId: null };
  if (policy === "open") return { allowed: true, firstUser: false, policy, joinOrganizationId: null };
  if (policy === "domains") {
    const [row] = await db.select({ value: instanceSettings.value }).from(instanceSettings).where(eq(instanceSettings.key, "signup_domains")).limit(1);
    const domains = Array.isArray(row?.value) ? (row.value as unknown[]).map((d) => String(d).toLowerCase()) : [];
    const domain = email.trim().toLowerCase().split("@")[1] ?? "";
    if (domain && domains.includes(domain)) {
      const [org] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(and(isNull(organizations.deletedAt)))
        .orderBy(asc(organizations.createdAt))
        .limit(1);
      return { allowed: true, firstUser: false, policy, joinOrganizationId: org?.id ?? null };
    }
  }
  return { allowed: false, firstUser: false, policy, message: SIGNUPS_CLOSED_MESSAGE };
}
