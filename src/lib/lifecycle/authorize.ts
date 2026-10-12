// Authorization of lifecycle actors (ARCHITECTURE 18.7, 26 rule 5): "user" and "api" actors need manage access to the
// meeting (organizer, a host, an editor of its event type or an org admin, meetingAccess); "invitee" actors hold the
// capability URL and only reach the invitee services; "system" actors are jobs and connected calendar changes.
import "server-only";
import type { DbOrTx } from "@/db";
import { meetingAccess } from "@/lib/authz";
import type { Actor as DomainActor } from "@/lib/events";
import { AppError } from "@/lib/errors";
import messages from "@/lib/i18n/messages/en/lifecycle";
import type { LifecycleActor } from "./types";

/** Throws unless the actor may manage the meeting (hosts' actions). Unknown or other-tenant meetings are not found. */
export async function assertCanManageMeeting(db: DbOrTx, actor: LifecycleActor, scheduledEventId: string): Promise<void> {
  if (actor.type === "system") return;
  if (actor.type === "invitee") throw new AppError("forbidden", messages.errors.forbidden);
  const access = await meetingAccess(actor.ctx, scheduledEventId, db);
  if (!access) throw new AppError("not_found", messages.errors.notFound);
  if (access !== "manage") throw new AppError("forbidden", messages.errors.forbidden);
}

/** The user behind a user or api actor (null for invitees and jobs). */
export function actorUser(actor: LifecycleActor): { id: string; name: string } | null {
  return actor.type === "user" || actor.type === "api" ? { id: actor.ctx.user.id, name: actor.ctx.user.name } : null;
}

/** The domain event actor (ARCHITECTURE 12.1). */
export function domainActorOf(actor: LifecycleActor, fallbackName?: string | null): DomainActor {
  switch (actor.type) {
    case "user":
      return { type: "user", userId: actor.ctx.user.id };
    case "api":
      return { type: "api", userId: actor.ctx.user.id };
    case "invitee":
      return { type: "invitee", ...(actor.name ?? fallbackName ? { name: (actor.name ?? fallbackName) as string } : {}) };
    default:
      return { type: "system", ...(actor.name ? { name: actor.name } : {}) };
  }
}
