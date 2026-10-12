// Host authorization for polls (SPEC MP-01; ARCHITECTURE 18.7 pollAccess): the creator is "owner"; co-hosts (the
// adhoc event type's hosts) and org owners and admins "manage". Managers view results, edit, invite, close or reopen
// voting and book; only the creator and org owners and admins delete the poll or remove co-hosts. Every host service
// calls one of these first (inside its write transaction when the check guards the write). Server only.
import "server-only";
import type { DbOrTx } from "@/db";
import { getDb } from "@/db";
import { isOrgAdmin, pollAccess, type ActorCtx } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { POLL_ERRORS } from "./constants";
import { loadPoll, type PollRow } from "./load";
import type { PollAccessLevel } from "./types";

export type PollActorAccess = { poll: PollRow; access: PollAccessLevel; canDelete: boolean };

/** The poll and the actor's access, or AppError not_found (also for other organizations' polls, GEN-08). */
export async function requirePollAccess(actor: ActorCtx, pollId: string, db?: DbOrTx): Promise<PollActorAccess> {
  const d = db ?? (await getDb());
  const access = await pollAccess(actor, pollId, d);
  if (!access) throw new AppError("not_found", POLL_ERRORS.notFound);
  const poll = await loadPoll(d, pollId);
  if (!poll || poll.deletedAt) throw new AppError("not_found", POLL_ERRORS.notFound);
  return { poll, access, canDelete: access === "owner" || isOrgAdmin(actor) };
}

/** Delete and co-host removal: the creator or an org owner or admin (a co-host gets 403, MP-01). */
export async function requirePollOwner(actor: ActorCtx, pollId: string, db?: DbOrTx): Promise<PollActorAccess> {
  const a = await requirePollAccess(actor, pollId, db);
  if (!a.canDelete) throw new AppError("forbidden", POLL_ERRORS.ownerOnly);
  return a;
}

/** Whether the actor may remove co-hosts (same rule as delete). */
export function canRemoveCohosts(actor: ActorCtx, access: PollAccessLevel): boolean {
  return access === "owner" || isOrgAdmin(actor);
}
