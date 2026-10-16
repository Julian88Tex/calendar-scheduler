// OWNER: golden-path-qa.
//
// Who may open the email outbox page (and see its settings navigation entry): instance admins (the instance owner is
// the first one; ADMIN_EMAILS with a verified email) and organization owners. The page scopes rows further (data.ts).
import "server-only";
import { isOrgOwner, type ActorCtx } from "@/lib/authz";

export function canSeeEmailOutbox(actor: ActorCtx): boolean {
  return actor.isInstanceAdmin || isOrgOwner(actor);
}
