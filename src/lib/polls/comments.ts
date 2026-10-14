// Poll comments (SPEC MP-14; research meeting-polls.md B5.8): plain text up to 2,000 characters, 200 per poll, 20 per
// IP per hour. Posting without voting is allowed (no participant is created). In host_only polls a comment is visible
// only to hosts and its author ("Only the host can see comments"). Authors delete their own comment through their
// edit token; hosts delete any. Hosts comment with a "Host" badge. Server only.
import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { meetingPollComments } from "@/db/schema";
import type { ActorCtx } from "@/lib/authz";
import { hashIp } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { runJobsAfterResponse } from "@/lib/jobs";
import { rateLimit, rateLimitedError } from "@/lib/rate-limit";
import { now as clockNow } from "@/lib/time/now";
import { requirePollAccess } from "./access";
import { recordActivity } from "./activity";
import { COMMENTS_PER_IP_PER_HOUR, MAX_POLL_COMMENTS, POLL_ERRORS, pollJobGroup } from "./constants";
import { loadPollBySlug, lockPoll } from "./load";
import { enqueueNotify } from "./schedule";
import { CommentSchema } from "./validation";
import { identifyParticipant, type VoterIdentity } from "./vote";

async function assertRoom(tx: Parameters<typeof lockPoll>[0], pollId: string): Promise<void> {
  const [c] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(meetingPollComments)
    .where(and(eq(meetingPollComments.pollId, pollId), isNull(meetingPollComments.deletedAt)));
  if (Number(c?.n ?? 0) >= MAX_POLL_COMMENTS) throw new AppError("validation", POLL_ERRORS.tooManyComments);
}

/** A voter's comment (MP-14). The name is the participant's when they voted, else required. */
export async function addPublicComment(slug: string, raw: unknown, ctx: VoterIdentity & { ip?: string | null } = {}): Promise<{ commentId: string }> {
  const input = CommentSchema.parse(raw);
  const db = await getDb();
  const at = clockNow();
  const found = await loadPollBySlug(db, slug, at);
  if (!found || found.poll.deletedAt) throw new AppError("not_found", POLL_ERRORS.notFound);
  const limit = await rateLimit(`poll-comment:ip:${await hashIp(ctx.ip)}`, COMMENTS_PER_IP_PER_HOUR, 3600, { nowMs: at.getTime() });
  if (!limit.ok) throw rateLimitedError(limit);
  const out = await db.transaction(async (tx) => {
    const poll = await lockPoll(tx, found.poll.id, "share");
    if (poll.deletedAt || poll.status === "canceled") throw new AppError("not_found", POLL_ERRORS.notFound);
    if (!poll.allowComments) throw new AppError("validation", POLL_ERRORS.commentsOff);
    await assertRoom(tx, poll.id);
    const me = await identifyParticipant(tx, poll.id, ctx);
    const name = me?.participant.name?.trim() || input.name?.trim();
    if (!name) throw new AppError("validation", POLL_ERRORS.nameRequired, { fieldErrors: { name: [POLL_ERRORS.nameRequired] } });
    const hostOnly = poll.resultsVisibility === "host_only";
    const [row] = await tx
      .insert(meetingPollComments)
      .values({ pollId: poll.id, participantId: me?.participant.id ?? null, authorName: name.slice(0, 100), body: input.body, visibility: hostOnly ? "host_only" : "public", createdAt: at })
      .returning({ id: meetingPollComments.id });
    const activityId = await recordActivity(tx, { pollId: poll.id, type: "commented", participantId: me?.participant.id ?? null, data: { commentId: row!.id, hostOnly, name }, at });
    await enqueueNotify(tx, poll.id, activityId, at);
    return { commentId: row!.id, pollId: poll.id };
  });
  runJobsAfterResponse({ groupKeys: [pollJobGroup(out.pollId)] });
  return { commentId: out.commentId };
}

/** A voter deletes their own comment (identified like the page: invite link, edit token or signed-in user). */
export async function deletePublicComment(slug: string, commentId: string, ctx: VoterIdentity): Promise<void> {
  const db = await getDb();
  const at = clockNow();
  const found = await loadPollBySlug(db, slug, at);
  if (!found || found.poll.deletedAt) throw new AppError("not_found", POLL_ERRORS.notFound);
  const me = await identifyParticipant(db, found.poll.id, { editToken: ctx.editToken, inviteToken: ctx.inviteToken, userId: ctx.userId });
  if (!me) throw new AppError("forbidden", "You can only delete your own comments.");
  const rows = await db
    .update(meetingPollComments)
    .set({ deletedAt: at, deletedBy: `participant:${me.participant.id}` })
    .where(and(eq(meetingPollComments.id, commentId), eq(meetingPollComments.pollId, found.poll.id), eq(meetingPollComments.participantId, me.participant.id), isNull(meetingPollComments.authorUserId), isNull(meetingPollComments.deletedAt)))
    .returning({ id: meetingPollComments.id });
  if (!rows.length) throw new AppError("not_found", "This comment no longer exists.");
  await recordActivity(db, { pollId: found.poll.id, type: "comment_deleted", participantId: me.participant.id, data: { commentId }, at });
}

/** A host comment ("Host" badge, MP-14 "the host can reply as Host"). */
export async function addHostComment(actor: ActorCtx, pollId: string, raw: unknown): Promise<{ commentId: string }> {
  const input = CommentSchema.parse(raw);
  const db = await getDb();
  await requirePollAccess(actor, pollId, db);
  const at = clockNow();
  const id = await db.transaction(async (tx) => {
    const poll = await lockPoll(tx, pollId, "share");
    await assertRoom(tx, poll.id);
    const hostOnly = poll.resultsVisibility === "host_only";
    const [row] = await tx
      .insert(meetingPollComments)
      .values({ pollId: poll.id, authorUserId: actor.user.id, authorName: actor.user.name, body: input.body, visibility: hostOnly ? "host_only" : "public", createdAt: at })
      .returning({ id: meetingPollComments.id });
    const activityId = await recordActivity(tx, { pollId: poll.id, type: "commented", actorUserId: actor.user.id, data: { commentId: row!.id, hostOnly, name: actor.user.name, byHost: true }, at });
    await enqueueNotify(tx, poll.id, activityId, at);
    return row!.id;
  });
  runJobsAfterResponse({ groupKeys: [pollJobGroup(pollId)] });
  return { commentId: id };
}

/** Hosts delete any comment. */
export async function deleteHostComment(actor: ActorCtx, pollId: string, commentId: string): Promise<void> {
  const db = await getDb();
  await requirePollAccess(actor, pollId, db);
  const at = clockNow();
  const rows = await db
    .update(meetingPollComments)
    .set({ deletedAt: at, deletedBy: `user:${actor.user.id}` })
    .where(and(eq(meetingPollComments.id, commentId), eq(meetingPollComments.pollId, pollId), isNull(meetingPollComments.deletedAt)))
    .returning({ id: meetingPollComments.id });
  if (!rows.length) throw new AppError("not_found", "This comment no longer exists.");
  await recordActivity(db, { pollId, type: "comment_deleted", actorUserId: actor.user.id, data: { commentId }, at });
}
