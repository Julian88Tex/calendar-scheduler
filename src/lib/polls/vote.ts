// Voting (SPEC MP-08 to MP-11, MP-17, MP-30; research meeting-polls.md B5): public submits through the link, invite
// links and edit tokens, Decline, duplicate email protection, email verification, host edits on behalf, participant
// management. Server only.
//
// The vote transaction (lock order of load.ts): the poll row FOR SHARE (a concurrent close, delete or booking waits),
// re-check of the effective status and the deadline with the app clock, then the option rows the voter newly selects
// as Yes or If need be FOR UPDATE in ascending id order before counting the other participants' Yes and If need be,
// so "Max votes per option" holds under concurrency (two votes for the last place accept exactly one). Every count
// joins live options and live participants (votes on removed options never count). A voter's own existing selection
// on a full option can be removed, not re-added. Votes on started options are frozen.
import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { isUniqueViolation } from "@/db/helpers";
import { meetingPollActivity, meetingPollComments, meetingPollOptions, meetingPollParticipants, meetingPolls, meetingPollVotes } from "@/db/schema";
import type { ActorCtx } from "@/lib/authz";
import { checkBookingBot } from "@/lib/booking";
import { hashIp } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { publishEvent } from "@/lib/events";
import { newId } from "@/lib/ids";
import { enqueueJob, runJobsAfterResponse } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { rateLimit, rateLimitedError } from "@/lib/rate-limit";
import { now as clockNow } from "@/lib/time/now";
import { normalizeEmail } from "@/lib/validation";
import { requirePollAccess } from "./access";
import { recordActivity, type PollActivityType } from "./activity";
import { MAX_POLL_COMMENTS, MAX_POLL_PARTICIPANTS, POLL_ERRORS, POLL_JOBS, VOTE_SUBMITS_PER_IP_PER_HOUR, pollJobGroup } from "./constants";
import { loadOptions, loadPollBySlug, lockPoll, participantCount, startOf, statusOf, type OptionRow, type ParticipantRow, type PollRow } from "./load";
import { enqueueNotify, enqueuePollEmail, enqueueSubscriberBatch } from "./schedule";
import { editTokenFor, presentedTokenHash, tokenHashesFor } from "./tokens";
import { AddParticipantSchema, RemoveParticipantSchema, SetVotesSchema, SubmitVoteSchema, UpdateParticipantSchema, type SubmitVoteInput } from "./validation";
import { checkVoteCode, codeCheckMessage } from "./verification";
import type { SubmitVoteOutcome, VoteChoice } from "./types";
import { visibilityFlags } from "./visibility";

type Tx = DbOrTx;

/** Thrown inside the vote transaction to roll back with a typed outcome. */
class VoteAbort extends Error {
  readonly outcome: Extract<SubmitVoteOutcome, { ok: false }>;
  constructor(outcome: Extract<SubmitVoteOutcome, { ok: false }>) {
    super(outcome.message);
    this.outcome = outcome;
  }
}

const fail = (code: Extract<SubmitVoteOutcome, { ok: false }>["code"], message: string, fieldErrors?: Record<string, string[]>): Extract<SubmitVoteOutcome, { ok: false }> => ({
  ok: false,
  code,
  message,
  ...(fieldErrors ? { fieldErrors } : {}),
});

// ---------------------------------------------------------------------------------------------------------------
// Shared vote write

type VoteWrite = {
  poll: PollRow;
  options: OptionRow[];
  participantId: string;
  /** The participant's current votes on live options. */
  previous: Record<string, VoteChoice>;
  submitted: readonly { optionId: string; choice: VoteChoice }[];
  declined: boolean;
  at: Date;
};

/**
 * Validates and writes one participant's answers: unknown options rejected, If need be only when allowed, started
 * options keep their previous answer, every future option gets an explicit row (No when not chosen, so No differs from
 * no answer), max choices and capacity enforced under the option locks. Returns the final answers on live options.
 */
async function writeVotes(tx: Tx, w: VoteWrite): Promise<Record<string, VoteChoice>> {
  const live = new Map(w.options.map((o) => [o.id, o]));
  const given = new Map<string, VoteChoice>();
  for (const v of w.submitted) {
    if (!live.has(v.optionId)) throw new VoteAbort(fail("validation", POLL_ERRORS.optionNotFound, { votes: [POLL_ERRORS.optionNotFound] }));
    if (v.choice === "if_need_be" && !w.poll.allowIfNeedBe) throw new VoteAbort(fail("validation", POLL_ERRORS.ifNeedBeOff, { votes: [POLL_ERRORS.ifNeedBeOff] }));
    given.set(v.optionId, v.choice);
  }
  const final: Record<string, VoteChoice> = {};
  const future: string[] = [];
  for (const o of w.options) {
    if (startOf(o, w.poll.timezone) <= w.at.getTime()) {
      if (w.previous[o.id]) final[o.id] = w.previous[o.id]!; // frozen
      continue;
    }
    future.push(o.id);
    final[o.id] = w.declined ? "no" : (given.get(o.id) ?? "no");
  }
  const attending = (c: VoteChoice | undefined) => c === "yes" || c === "if_need_be";
  const chosen = Object.values(final).filter(attending).length;
  const max = w.poll.maxChoicesPerParticipant;
  if (max && chosen > max) {
    const msg = POLL_ERRORS.maxChoices.replace("{n}", String(max));
    throw new VoteAbort(fail("max_choices", msg, { votes: [msg] }));
  }
  // Capacity: newly selected options, locked in a stable order, then counted (other participants only).
  const newlySelected = future.filter((id) => attending(final[id]) && !attending(w.previous[id])).sort();
  if (w.poll.maxVotesPerOption && newlySelected.length) {
    await tx.select({ id: meetingPollOptions.id }).from(meetingPollOptions).where(inArray(meetingPollOptions.id, newlySelected)).orderBy(asc(meetingPollOptions.id)).for("update");
    const counts = await tx
      .select({ optionId: meetingPollVotes.optionId, n: sql<number>`count(*)::int` })
      .from(meetingPollVotes)
      .innerJoin(meetingPollParticipants, eq(meetingPollParticipants.id, meetingPollVotes.participantId))
      .innerJoin(meetingPollOptions, eq(meetingPollOptions.id, meetingPollVotes.optionId))
      .where(
        and(
          inArray(meetingPollVotes.optionId, newlySelected),
          inArray(meetingPollVotes.choice, ["yes", "if_need_be"]),
          isNull(meetingPollParticipants.deletedAt),
          isNull(meetingPollOptions.deletedAt),
          sql`${meetingPollVotes.participantId} <> ${w.participantId}`,
        ),
      )
      .groupBy(meetingPollVotes.optionId);
    const full = counts.find((c) => Number(c.n) >= w.poll.maxVotesPerOption!);
    if (full) throw new VoteAbort(fail("full", POLL_ERRORS.optionFull, { [`votes.${full.optionId}`]: [POLL_ERRORS.optionFull] }));
  }
  if (future.length) {
    await tx.delete(meetingPollVotes).where(and(eq(meetingPollVotes.participantId, w.participantId), inArray(meetingPollVotes.optionId, future)));
    await tx.insert(meetingPollVotes).values(future.map((optionId) => ({ participantId: w.participantId, optionId, pollId: w.poll.id, choice: final[optionId]!, createdAt: w.at, updatedAt: w.at })));
  }
  return final;
}

async function currentVotes(tx: Tx, participantId: string): Promise<Record<string, VoteChoice>> {
  const rows = await tx
    .select({ optionId: meetingPollVotes.optionId, choice: meetingPollVotes.choice })
    .from(meetingPollVotes)
    .innerJoin(meetingPollOptions, eq(meetingPollOptions.id, meetingPollVotes.optionId))
    .where(and(eq(meetingPollVotes.participantId, participantId), isNull(meetingPollOptions.deletedAt)));
  return Object.fromEntries(rows.map((r) => [r.optionId, r.choice]));
}

/** Finds a live participant of the poll by a presented token hash (edit or invite). */
async function participantByToken(tx: Tx, pollId: string, column: "edit" | "invite", token: string | null | undefined): Promise<ParticipantRow | null> {
  const hash = presentedTokenHash(token);
  if (!hash) return null;
  const col = column === "edit" ? meetingPollParticipants.editTokenHash : meetingPollParticipants.inviteTokenHash;
  const [row] = await tx
    .select()
    .from(meetingPollParticipants)
    .where(and(eq(col, hash), eq(meetingPollParticipants.pollId, pollId), isNull(meetingPollParticipants.deletedAt)))
    .limit(1);
  return row ?? null;
}

export type VoterIdentity = { editToken?: string | null; inviteToken?: string | null; userId?: string | null };

/** The participant a request speaks for: edit cookie, else invite link, else the signed-in app user. */
export async function identifyParticipant(db: DbOrTx, pollId: string, id: VoterIdentity): Promise<{ participant: ParticipantRow; via: "edit" | "invite" | "user" } | null> {
  const byEdit = await participantByToken(db, pollId, "edit", id.editToken);
  if (byEdit) return { participant: byEdit, via: "edit" };
  const byInvite = await participantByToken(db, pollId, "invite", id.inviteToken);
  if (byInvite) return { participant: byInvite, via: "invite" };
  if (id.userId) {
    const [row] = await db
      .select()
      .from(meetingPollParticipants)
      .where(and(eq(meetingPollParticipants.pollId, pollId), eq(meetingPollParticipants.userId, id.userId), isNull(meetingPollParticipants.deletedAt)))
      .limit(1);
    if (row) return { participant: row, via: "user" };
  }
  return null;
}

/** Enqueues the post-vote work: host notification, subscriber batch, voter confirmation, auto-book. */
async function afterVoteJobs(tx: Tx, p: { poll: PollRow; participant: { id: string; email: string | null }; activityId: string; at: Date; confirm: boolean }): Promise<void> {
  await enqueueNotify(tx, p.poll.id, p.activityId, p.at);
  if (visibilityFlags(p.poll.resultsVisibility, true).showCounts) await enqueueSubscriberBatch(tx, p.poll.id, p.at);
  if (p.confirm && p.participant.email) {
    await enqueuePollEmail(tx, { template: "confirmation", pollId: p.poll.id, participantId: p.participant.id }, `${p.poll.id}:confirmation:${p.activityId}`, p.at, 10);
  }
  if (p.poll.autoBook) {
    await enqueueJob(tx, { type: POLL_JOBS.autoBook, payload: { pollId: p.poll.id }, runAt: p.at, groupKey: pollJobGroup(p.poll.id), idempotencyKey: `poll:${p.poll.id}:auto_book:${p.activityId}` });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Public submit

export type SubmitVoteContext = VoterIdentity & { ip?: string | null; now?: Date; skipBotCheck?: boolean };

/**
 * "Share times" / "None of these work for me" (MP-08 to MP-10). Answers duplicate_email without writing when the email
 * belongs to another participant and the request holds no valid edit token for it (MP-09: typing someone else's email
 * never changes their votes; they get a magic link instead).
 */
export async function submitVote(slug: string, raw: SubmitVoteInput, ctx: SubmitVoteContext = {}): Promise<SubmitVoteOutcome> {
  const parsed = SubmitVoteSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fieldErrors[issue.path.join(".") || "_form"] ??= []).push(issue.message);
    return fail("validation", "Check the highlighted fields and try again.", fieldErrors);
  }
  const input = parsed.data;
  const at = ctx.now ?? clockNow();
  if (!ctx.skipBotCheck) {
    const bot = await checkBookingBot({ honeypot: input.website, formToken: input.formToken, turnstileToken: input.turnstileToken, ip: ctx.ip ?? null, now: at.getTime() });
    if (!bot.ok) return fail("bot", POLL_ERRORS.formExpired);
  }
  const db = await getDb();
  const found = await loadPollBySlug(db, slug, at);
  if (!found || found.poll.deletedAt || found.poll.status === "canceled") throw new AppError("not_found", POLL_ERRORS.notFound);
  const pollId = found.poll.id;
  const limit = await rateLimit(`poll-vote:ip:${await hashIp(ctx.ip)}:${pollId}`, VOTE_SUBMITS_PER_IP_PER_HOUR, 3600, { nowMs: at.getTime() });
  if (!limit.ok) throw rateLimitedError(limit);

  const duplicate: { participant: ParticipantRow | null } = { participant: null };
  try {
    const result = await db.transaction(async (tx) => {
      const poll = await lockPoll(tx, pollId, "share");
      const options = await loadOptions(tx, poll.id);
      if (poll.deletedAt || poll.status === "canceled") throw new AppError("not_found", POLL_ERRORS.notFound);
      const status = statusOf(poll, options, at);
      if (status !== "open" || (poll.deadlineAt && poll.deadlineAt.getTime() <= at.getTime())) {
        throw new VoteAbort(fail("closed", status === "booked" ? POLL_ERRORS.pollBooked : status === "expired" ? POLL_ERRORS.pollEnded : POLL_ERRORS.votingClosed));
      }
      // Double click: the first result again.
      if (input.requestId) {
        const [prev] = await tx
          .select({ participantId: meetingPollActivity.participantId })
          .from(meetingPollActivity)
          .where(and(eq(meetingPollActivity.pollId, poll.id), sql`${meetingPollActivity.data}->>'requestId' = ${input.requestId}`))
          .limit(1);
        if (prev?.participantId) {
          const [p] = await tx.select().from(meetingPollParticipants).where(eq(meetingPollParticipants.id, prev.participantId)).limit(1);
          if (p && !p.deletedAt) return { participant: p, created: false, replay: true as const };
        }
      }

      const identified = await identifyParticipant(tx, poll.id, ctx);
      let participant = identified?.participant ?? null;
      const email = participant?.email ?? input.email ?? null;
      if (!participant && email) {
        const [taken] = await tx
          .select()
          .from(meetingPollParticipants)
          .where(and(eq(meetingPollParticipants.pollId, poll.id), eq(meetingPollParticipants.emailNormalized, normalizeEmail(email)), isNull(meetingPollParticipants.deletedAt)))
          .limit(1);
        if (taken) {
          duplicate.participant = taken;
          throw new VoteAbort(fail("duplicate_email", POLL_ERRORS.duplicateEmail, { email: [POLL_ERRORS.duplicateEmail] }));
        }
      }
      if (poll.requireEmail && !email) throw new VoteAbort(fail("validation", POLL_ERRORS.emailRequired, { email: [POLL_ERRORS.emailRequired] }));
      if (!participant && (await participantCount(tx, poll.id)) >= MAX_POLL_PARTICIPANTS) throw new VoteAbort(fail("validation", POLL_ERRORS.tooManyParticipants));

      // Verify email (MP-04): new emails need the code; a participant proven before (or reached through their own
      // invite link or edit token) does not.
      let verifiedNow = false;
      const proven = Boolean(participant?.emailVerifiedAt) || identified?.via === "invite";
      if (poll.verifyEmail && email && !proven) {
        if (!input.verificationCode) throw new VoteAbort(fail("verification_required", POLL_ERRORS.verificationRequired));
        const check = await checkVoteCode(tx, { pollId: poll.id, email, code: input.verificationCode, at });
        if (check !== "ok") throw new VoteAbort(fail("validation", codeCheckMessage(check), { verificationCode: [codeCheckMessage(check)] }));
        verifiedNow = true;
      }

      const created = !participant;
      if (!participant) {
        const id = newId();
        const hashes = await tokenHashesFor(id);
        const [row] = await tx
          .insert(meetingPollParticipants)
          .values({
            id,
            pollId: poll.id,
            name: input.name,
            email,
            emailNormalized: email ? normalizeEmail(email) : null,
            userId: ctx.userId ?? null,
            timezone: input.timezone,
            locale: input.locale ?? null,
            status: input.declined ? "declined" : "responded",
            source: "link",
            subscribedToUpdates: input.subscribe,
            editTokenHash: hashes.editTokenHash,
            emailVerifiedAt: verifiedNow ? at : null,
            respondedAt: at,
            lastSubmittedAt: at,
            ipHash: await hashIp(ctx.ip),
            createdAt: at,
            updatedAt: at,
          })
          .returning();
        participant = row!;
      }
      const previous = created ? {} : await currentVotes(tx, participant.id);
      await writeVotes(tx, { poll, options, participantId: participant.id, previous, submitted: input.votes, declined: input.declined, at });
      if (!created) {
        const [row] = await tx
          .update(meetingPollParticipants)
          .set({
            // Invite links and signed-in users keep their name and email read-only (MP-06) once a name is known.
            name: identified?.via !== "edit" && participant.name.trim() ? participant.name : input.name,
            email: participant.email ?? email,
            emailNormalized: participant.emailNormalized ?? (email ? normalizeEmail(email) : null),
            timezone: input.timezone,
            locale: input.locale ?? participant.locale,
            status: input.declined ? "declined" : "responded",
            subscribedToUpdates: input.subscribe,
            emailVerifiedAt: participant.emailVerifiedAt ?? (verifiedNow ? at : null),
            respondedAt: participant.respondedAt ?? at,
            lastSubmittedAt: at,
            userId: participant.userId ?? ctx.userId ?? null,
            updatedAt: at,
          })
          .where(eq(meetingPollParticipants.id, participant.id))
          .returning();
        participant = row!;
      }

      if (input.comment?.trim() && poll.allowComments) {
        const [c] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(meetingPollComments)
          .where(and(eq(meetingPollComments.pollId, poll.id), isNull(meetingPollComments.deletedAt)));
        if (Number(c?.n ?? 0) < MAX_POLL_COMMENTS) {
          const [comment] = await tx
            .insert(meetingPollComments)
            .values({ pollId: poll.id, participantId: participant.id, authorName: participant.name, body: input.comment.trim(), visibility: poll.resultsVisibility === "host_only" ? "host_only" : "public", createdAt: at })
            .returning({ id: meetingPollComments.id });
          const commentActivity = await recordActivity(tx, { pollId: poll.id, type: "commented", participantId: participant.id, data: { commentId: comment!.id, hostOnly: poll.resultsVisibility === "host_only" }, at });
          await enqueueNotify(tx, poll.id, commentActivity, at);
        }
      }

      const type: PollActivityType = input.declined ? "declined" : created || !identifiedResponded(identified?.participant) ? "voted" : "vote_changed";
      const activityId = await recordActivity(tx, { pollId: poll.id, type, participantId: participant.id, data: { name: participant.name, ...(input.requestId ? { requestId: input.requestId } : {}) }, at });
      await publishEvent(tx, type === "vote_changed" ? "poll.vote_updated" : "poll.vote_created", { pollId: poll.id, participantId: participant.id }, { organizationId: poll.organizationId, actor: { type: "invitee", name: participant.name } });
      await afterVoteJobs(tx, { poll, participant, activityId, at, confirm: true });
      return { participant, created, replay: false as const };
    });
    runJobsAfterResponse({ groupKeys: [pollJobGroup(pollId)] });
    return { ok: true, participantId: result.participant.id, editToken: await editTokenFor(result.participant.id), status: result.participant.status, created: result.created };
  } catch (e) {
    if (e instanceof VoteAbort) {
      if (e.outcome.code === "duplicate_email" && duplicate.participant) await sendEditLinkFor(pollId, duplicate.participant, at);
      return e.outcome;
    }
    if (isUniqueViolation(e, "poll_participant_email_uq")) {
      // A concurrent first vote with the same email won: same answer as the duplicate case.
      const [taken] = await db
        .select()
        .from(meetingPollParticipants)
        .where(and(eq(meetingPollParticipants.pollId, pollId), eq(meetingPollParticipants.emailNormalized, normalizeEmail(input.email ?? "")), isNull(meetingPollParticipants.deletedAt)))
        .limit(1);
      if (taken) await sendEditLinkFor(pollId, taken, at);
      return fail("duplicate_email", POLL_ERRORS.duplicateEmail, { email: [POLL_ERRORS.duplicateEmail] });
    }
    throw e;
  }
}

function identifiedResponded(p: ParticipantRow | null | undefined): boolean {
  return Boolean(p && (p.status === "responded" || p.status === "declined"));
}

/** The magic link email of an existing participant (at most once per 10 minutes per participant). */
async function sendEditLinkFor(pollId: string, participant: ParticipantRow, at: Date): Promise<void> {
  if (!participant.email) return;
  try {
    const db = await getDb();
    const bucket = Math.floor(at.getTime() / 600_000);
    await enqueuePollEmail(db, { template: "edit_link", pollId, participantId: participant.id }, `${pollId}:edit_link:${participant.id}:${bucket}`, at, 20);
    runJobsAfterResponse({ groupKeys: [pollJobGroup(pollId)] });
  } catch (e) {
    log.warn("polls.edit_link_failed", { pollId, error: e });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Host side (MP-17)

async function hostWritablePoll(tx: Tx, pollId: string, at: Date): Promise<{ poll: PollRow; options: OptionRow[] }> {
  const poll = await lockPoll(tx, pollId, "update");
  if (poll.deletedAt || poll.status === "canceled") throw new AppError("not_found", POLL_ERRORS.notFound);
  const options = await loadOptions(tx, poll.id);
  const status = statusOf(poll, options, at);
  if (status === "booked") throw new AppError("conflict", POLL_ERRORS.rebookReopen);
  if (status === "expired") throw new AppError("conflict", POLL_ERRORS.pollEnded);
  return { poll, options };
}

async function liveParticipant(tx: Tx, pollId: string, participantId: string): Promise<ParticipantRow> {
  const [row] = await tx
    .select()
    .from(meetingPollParticipants)
    .where(and(eq(meetingPollParticipants.id, participantId), eq(meetingPollParticipants.pollId, pollId), isNull(meetingPollParticipants.deletedAt)))
    .limit(1);
  if (!row) throw new AppError("not_found", "This participant is no longer part of the poll.");
  return row;
}

function voteAbortToError(e: unknown): never {
  if (e instanceof VoteAbort) throw new AppError("validation", e.outcome.message, { fieldErrors: e.outcome.fieldErrors });
  throw e;
}

/** "Edit votes" on behalf of a participant (MP-17); the participant is emailed when `notify` and they have an email. */
export async function setParticipantVotes(actor: ActorCtx, raw: unknown): Promise<{ participantId: string }> {
  const input = SetVotesSchema.parse(raw);
  const db = await getDb();
  await requirePollAccess(actor, input.pollId, db);
  const at = clockNow();
  try {
    await db.transaction(async (tx) => {
      const { poll, options } = await hostWritablePoll(tx, input.pollId, at);
      const p = await liveParticipant(tx, poll.id, input.participantId);
      const previous = await currentVotes(tx, p.id);
      await writeVotes(tx, { poll, options, participantId: p.id, previous, submitted: input.votes, declined: false, at });
      await tx
        .update(meetingPollParticipants)
        .set({ status: "responded", respondedAt: p.respondedAt ?? at, lastSubmittedAt: at, updatedAt: at })
        .where(eq(meetingPollParticipants.id, p.id));
      const activityId = await recordActivity(tx, { pollId: poll.id, type: p.respondedAt ? "vote_changed" : "voted", participantId: p.id, actorUserId: actor.user.id, data: { name: p.name, byHost: true }, at });
      await publishEvent(tx, p.respondedAt ? "poll.vote_updated" : "poll.vote_created", { pollId: poll.id, participantId: p.id }, { organizationId: poll.organizationId, actor: { type: "user", userId: actor.user.id } });
      if (input.notify && p.email && !p.unsubscribedAt) {
        await enqueuePollEmail(tx, { template: "votes_edited", pollId: poll.id, participantId: p.id, userId: actor.user.id }, `${poll.id}:votes_edited:${activityId}`, at);
      }
      if (poll.autoBook) await enqueueJob(tx, { type: POLL_JOBS.autoBook, payload: { pollId: poll.id }, runAt: at, groupKey: pollJobGroup(poll.id), idempotencyKey: `poll:${poll.id}:auto_book:${activityId}` });
    });
  } catch (e) {
    voteAbortToError(e);
  }
  runJobsAfterResponse({ groupKeys: [pollJobGroup(input.pollId)] });
  return { participantId: input.participantId };
}

/** "Add participant (vote on behalf)" (MP-17 acceptance: source host_added). */
export async function addParticipant(actor: ActorCtx, raw: unknown): Promise<{ participantId: string }> {
  const input = AddParticipantSchema.parse(raw);
  const db = await getDb();
  await requirePollAccess(actor, input.pollId, db);
  const at = clockNow();
  const id = newId();
  try {
    await db.transaction(async (tx) => {
      const { poll, options } = await hostWritablePoll(tx, input.pollId, at);
      if ((await participantCount(tx, poll.id)) >= MAX_POLL_PARTICIPANTS) throw new AppError("validation", POLL_ERRORS.tooManyParticipants);
      const hashes = await tokenHashesFor(id);
      await tx.insert(meetingPollParticipants).values({
        id,
        pollId: poll.id,
        name: input.name,
        email: input.email,
        emailNormalized: input.email ? normalizeEmail(input.email) : null,
        status: "responded",
        source: "host_added",
        isRequired: input.isRequired,
        editTokenHash: hashes.editTokenHash,
        respondedAt: at,
        lastSubmittedAt: at,
        createdByUserId: actor.user.id,
        timezone: poll.timezone,
        createdAt: at,
        updatedAt: at,
      });
      await writeVotes(tx, { poll, options, participantId: id, previous: {}, submitted: input.votes, declined: false, at });
      const activityId = await recordActivity(tx, { pollId: poll.id, type: "voted", participantId: id, actorUserId: actor.user.id, data: { name: input.name, byHost: true }, at });
      await publishEvent(tx, "poll.vote_created", { pollId: poll.id, participantId: id }, { organizationId: poll.organizationId, actor: { type: "user", userId: actor.user.id } });
      if (input.notify && input.email) {
        await enqueuePollEmail(tx, { template: "added_on_behalf", pollId: poll.id, participantId: id, userId: actor.user.id }, `${poll.id}:added:${id}`, at);
      }
      if (poll.autoBook) await enqueueJob(tx, { type: POLL_JOBS.autoBook, payload: { pollId: poll.id }, runAt: at, groupKey: pollJobGroup(poll.id), idempotencyKey: `poll:${poll.id}:auto_book:${activityId}` });
    });
  } catch (e) {
    if (isUniqueViolation(e, "poll_participant_email_uq")) {
      throw new AppError("conflict", "Someone with this email is already part of the poll.", { fieldErrors: { email: ["Someone with this email is already part of the poll."] } });
    }
    voteAbortToError(e);
  }
  runJobsAfterResponse({ groupKeys: [pollJobGroup(input.pollId)] });
  return { participantId: id };
}

/** "Mark as required" and name corrections (MP-17). */
export async function updateParticipant(actor: ActorCtx, raw: unknown): Promise<void> {
  const input = UpdateParticipantSchema.parse(raw);
  const db = await getDb();
  await requirePollAccess(actor, input.pollId, db);
  const at = clockNow();
  await db.transaction(async (tx) => {
    const poll = await lockPoll(tx, input.pollId, "update");
    const p = await liveParticipant(tx, poll.id, input.participantId);
    await tx
      .update(meetingPollParticipants)
      .set({ ...(input.isRequired !== undefined ? { isRequired: input.isRequired } : {}), ...(input.name ? { name: input.name } : {}), updatedAt: at })
      .where(eq(meetingPollParticipants.id, p.id));
    if (input.isRequired !== undefined && poll.autoBook) {
      await enqueueJob(tx, { type: POLL_JOBS.autoBook, payload: { pollId: poll.id }, runAt: at, groupKey: pollJobGroup(poll.id), idempotencyKey: `poll:${poll.id}:auto_book:required:${p.id}:${at.getTime()}` });
    }
  });
  runJobsAfterResponse({ groupKeys: [pollJobGroup(input.pollId)] });
}

/**
 * "Remove" (MP-17): soft deletes the participant (their tokens stop working) and deletes their votes; they are
 * emailed "removed by host" unless `notify` is off. Removing an invited non-respondent is allowed (MP-06).
 */
export async function removeParticipant(actor: ActorCtx, raw: unknown): Promise<void> {
  const input = RemoveParticipantSchema.parse(raw);
  const db = await getDb();
  await requirePollAccess(actor, input.pollId, db);
  const at = clockNow();
  await db.transaction(async (tx) => {
    const poll = await lockPoll(tx, input.pollId, "update");
    if (poll.deletedAt) throw new AppError("not_found", POLL_ERRORS.notFound);
    const p = await liveParticipant(tx, poll.id, input.participantId);
    await tx.delete(meetingPollVotes).where(eq(meetingPollVotes.participantId, p.id));
    await tx.update(meetingPollParticipants).set({ deletedAt: at, updatedAt: at }).where(eq(meetingPollParticipants.id, p.id));
    await recordActivity(tx, { pollId: poll.id, type: "participant_removed", participantId: p.id, actorUserId: actor.user.id, data: { name: p.name }, at });
    if (input.notify && p.email && p.status !== "invited") {
      await enqueuePollEmail(tx, { template: "removed", pollId: poll.id, participantId: p.id, userId: actor.user.id, email: p.email, data: { name: p.name } }, `${poll.id}:removed:${p.id}`, at);
    }
  });
  runJobsAfterResponse({ groupKeys: [pollJobGroup(input.pollId)] });
}

/** Marks a poll's results as viewed by its host ("New" dot, MP-26). */
export async function markPollViewed(actor: ActorCtx, pollId: string): Promise<void> {
  const db = await getDb();
  await requirePollAccess(actor, pollId, db);
  await db.update(meetingPolls).set({ hostLastViewedAt: clockNow() }).where(eq(meetingPolls.id, pollId));
}
