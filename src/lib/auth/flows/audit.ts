// Audit entries for auth events (SPEC GEN-17, ADM-07): login, logout, failed login, signup, password change and
// reset, 2FA change, login method change and email verification. Namespace "auth"; the entry belongs to the user's
// organization so its admins see it in Admin > Activity (failed logins for unknown emails have no organization).
// Audit failures never break an auth flow (audit() logs them).
import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { organizationMemberships } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { RequestMeta } from "./request-context";

export type AuthAuditAction =
  | "user.signup"
  | "user.login"
  | "user.login_failed"
  | "user.logout"
  | "user.password_reset_requested"
  | "user.password_changed"
  | "user.email_verified"
  | "user.two_factor_enabled"
  | "user.two_factor_disabled"
  | "user.recovery_codes_regenerated"
  | "login_method.connected"
  | "login_method.disconnected";

/** The first organization of a user (memberships are one per user in practice), or null. */
export async function primaryOrganizationId(userId: string, db?: DbOrTx): Promise<string | null> {
  const d = db ?? (await getDb());
  const [row] = await d
    .select({ id: organizationMemberships.organizationId })
    .from(organizationMemberships)
    .where(eq(organizationMemberships.userId, userId))
    .orderBy(asc(organizationMemberships.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Writes one auth audit entry. `user` is the subject (and actor) when known. Pass `tx` to commit the entry with the
 * change; without it the entry is written best effort.
 */
export async function auditAuth(
  action: AuthAuditAction,
  p: {
    user?: { id: string; name?: string | null; email?: string | null } | null;
    organizationId?: string | null;
    details?: Record<string, unknown>;
    meta?: RequestMeta;
    tx?: DbOrTx;
  } = {},
): Promise<void> {
  const user = p.user ?? null;
  let organizationId = p.organizationId ?? null;
  if (!organizationId && user) {
    organizationId = await primaryOrganizationId(user.id, p.tx).catch(() => null);
  }
  await audit(
    {
      action,
      namespace: "auth",
      targetType: user ? "user" : null,
      targetId: user?.id ?? null,
      details: p.details ?? {},
      actor: user
        ? { type: "user", userId: user.id, organizationId, label: user.name ?? user.email ?? null }
        : { type: "system", label: null },
      organizationId,
      ...(p.meta ? { ip: p.meta.ip, userAgent: p.meta.userAgent } : {}),
    },
    p.tx,
  );
}
