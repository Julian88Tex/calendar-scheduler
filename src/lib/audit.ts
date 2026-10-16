// Audit log (SPEC GEN-17, ADM-07; ARCHITECTURE section 21).
//
//   await audit({ action: "role.changed", namespace: "org", targetType: "user", targetId: member.id,
//                 details: { from: "user", to: "admin" }, actor }, tx);
//
// Security and configuration actions write one row: actor, action, namespace, target, details, IP, user agent, time.
// Pass the write transaction as the second argument so the entry commits (or rolls back) with the change; without a
// transaction a failure is logged and never breaks the caller. IP and user agent are read from the current request
// when not given.
import "server-only";
import { getDb, type DbOrTx } from "@/db";
import { auditLog } from "@/db/schema";
import type { ActorCtx } from "./authz";
import { log } from "./logger";
import { now } from "./time/now";

export type AuditActor =
  | ActorCtx
  | { type: "user"; userId: string; organizationId?: string | null; label?: string | null }
  | { type: "system" | "api" | "invitee"; userId?: string | null; organizationId?: string | null; label?: string | null };

export type AuditEntry = {
  /** "user.login", "role.changed", "webhook.created", ... */
  action: string;
  /** "auth", "org", "event_types", "calendars", "integrations", "developer", "admin", ... */
  namespace: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: Record<string, unknown>;
  actor?: AuditActor | null;
  /** Defaults to the actor's organization. */
  organizationId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
};

function isActorCtx(a: AuditActor): a is ActorCtx {
  return "orgId" in a && "user" in a;
}

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const fwd = h.get("x-vercel-forwarded-for") ?? h.get("x-forwarded-for") ?? h.get("x-real-ip");
    return { ip: fwd?.split(",")[0]?.trim() || null, userAgent: h.get("user-agent")?.slice(0, 512) ?? null };
  } catch {
    return { ip: null, userAgent: null }; // jobs, scripts and tests run outside a request
  }
}

/** The audit_log row values for an entry (exported for tests). */
export function auditValues(entry: AuditEntry, meta: { ip: string | null; userAgent: string | null }) {
  const actor = entry.actor ?? null;
  let actorType: "user" | "system" | "api" | "invitee" = "system";
  let actorUserId: string | null = null;
  let actorLabel: string | null = null;
  let organizationId: string | null = entry.organizationId ?? null;
  if (actor) {
    if (isActorCtx(actor)) {
      actorType = "user";
      actorUserId = actor.user.id;
      actorLabel = actor.user.name ?? actor.user.email ?? null;
      organizationId ??= actor.orgId;
    } else {
      actorType = actor.type;
      actorUserId = actor.userId ?? null;
      actorLabel = actor.label ?? null;
      organizationId ??= actor.organizationId ?? null;
    }
  }
  return {
    organizationId,
    actorType,
    actorUserId,
    actorLabel,
    action: entry.action,
    namespace: entry.namespace,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    details: entry.details ?? {},
    ip: entry.ip ?? meta.ip,
    userAgent: entry.userAgent ?? meta.userAgent,
    occurredAt: now(),
  };
}

/** Writes an audit entry (see the file header). Returns the entry id, or null when it could not be written. */
export async function audit(entry: AuditEntry, tx?: DbOrTx): Promise<string | null> {
  const meta = entry.ip !== undefined && entry.userAgent !== undefined ? { ip: null, userAgent: null } : await requestMeta();
  const values = auditValues(entry, meta);
  if (tx) {
    const [row] = await tx.insert(auditLog).values(values).returning({ id: auditLog.id });
    return row?.id ?? null;
  }
  try {
    const db = await getDb();
    const [row] = await db.insert(auditLog).values(values).returning({ id: auditLog.id });
    return row?.id ?? null;
  } catch (e) {
    log.error("audit.write_failed", { action: entry.action, namespace: entry.namespace, error: e });
    return null;
  }
}
