// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Page and action guards on top of the sessions core (src/lib/auth/session.ts) and src/lib/authz.ts.
import "server-only";
import type { Route } from "next";
import { notFound, redirect } from "next/navigation";
import { canSeeAdminCenter, getActorCtx, isOrgAdmin, type ActorCtx } from "@/lib/authz";
import { safeNextPath } from "@/lib/url";
import { getCurrentUser } from "./session";

/** Auth pages: a signed-in user goes to `next` (same-site only) or /app/scheduling. */
export async function redirectIfSignedIn(next?: string | null): Promise<void> {
  const user = await getCurrentUser();
  if (user) redirect(safeNextPath(next) as Route);
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
