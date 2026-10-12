// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Page and action guards on top of the sessions core (src/lib/auth/session.ts) and src/lib/authz.ts.
import "server-only";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { canSeeAdminCenter, getActorCtx, isOrgAdmin, type ActorCtx } from "@/lib/authz";
import { safeNextPath } from "@/lib/url";
import { isPendingTwoFactorExpired } from "./flows/two-factor";
import { getCurrentUser, getSession, type SessionData } from "./session";

/** Auth pages: a signed-in user goes to `next` (same-site only) or /app/scheduling. */
export async function redirectIfSignedIn(next?: string | null): Promise<void> {
  const user = await getCurrentUser();
  if (user) redirect(safeNextPath(next) as Route);
}

/** /login?error=expired&next=... ("Your sign in attempt expired. Please try again.") after a stale second factor. */
export function twoFactorExpiredLoginPath(next?: string | null): string {
  return `/login?error=expired&next=${encodeURIComponent(safeNextPath(next))}`;
}

/**
 * /login/two-factor: the two_factor_pending session (AU-09). Without a session the visitor goes to /login; a fully
 * signed-in user goes on to `next`; a pending session older than PENDING_TWO_FACTOR_TTL_MS goes back to /login with
 * the "expired" message (the challenge action revokes it).
 */
export async function requirePendingTwoFactorSession(next?: string | null): Promise<SessionData> {
  const data = await getSession();
  if (!data) redirect("/login" as Route);
  if (!data.session.twoFactorPending) redirect(safeNextPath(next) as Route);
  if (isPendingTwoFactorExpired(data.session)) redirect(twoFactorExpiredLoginPath(next) as Route);
  return data;
}

/** Admin center pages (ADM-01): owners, admins and instance admins; everyone else gets the 404 page. */
export async function requireAdminCenter(): Promise<ActorCtx> {
  const actor = await getActorCtx();
  if (!canSeeAdminCenter(actor)) notFound();
  return actor;
}

/** Organization owner or admin; everyone else gets the 404 page. */
export async function requireOrgAdmin(): Promise<ActorCtx> {
  const actor = await getActorCtx();
  if (!isOrgAdmin(actor)) notFound();
  return actor;
}

/** Instance admin only (instance settings, outbox, jobs); everyone else gets the 404 page. */
export async function requireInstanceAdmin(): Promise<ActorCtx> {
  const actor = await getActorCtx();
  if (!actor.isInstanceAdmin) notFound();
  return actor;
}
