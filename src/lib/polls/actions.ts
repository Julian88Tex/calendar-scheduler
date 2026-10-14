"use server";
// OWNER: polls-core.
//
// Meeting poll Server Actions for polls-ui (ARCHITECTURE section 26 rule 3): thin runAction wrappers over the services
// (which authorize the actor and validate again), revalidating the polls list, the results page and the voter page.
// Every action answers ActionResult<T>: { ok: true, data } or { ok: false, error: { code, message, fieldErrors? } }.
//
// Host actions (signed in): createPollAction, updatePollAction (ConfirmableResult), addPollOptionsAction,
// removePollOptionsAction (ConfirmableResult), invitePeopleAction, sendRemindersAction, addParticipantAction,
// updateParticipantAction, removeParticipantAction, setParticipantVotesAction, closeVotingAction, reopenVotingAction,
// reopenPollAction, deletePollAction, duplicatePollAction, clearHoldsAction, retryHoldsAction, bookingPreviewAction,
// bookPollAction, addHostCommentAction, deleteHostCommentAction, checkPollSlugAction, pollGridOverlayAction,
// pollActivityAction, listPollsAction, markPollViewedAction, getHostPollAction.
//
// Voter actions (public, posted from /p/{slug}): submitVoteAction (sets the edit cookies), requestVoteCodeAction,
// addPublicCommentAction, deletePublicCommentAction, unsubscribeAction, checkIcsCalendarAction,
// checkAccountCalendarAction, clearCalendarCheckAction.
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { runAction } from "@/lib/actions";
import { isAppError } from "@/lib/errors";
import { getClientIp } from "@/lib/http";
import { bookingPreview, bookPoll } from "./book";
import { addHostComment, addPublicComment, deleteHostComment, deletePublicComment } from "./comments";
import { createPoll, duplicatePoll } from "./create";
import { deleteCheckCookie, setCheckCookie } from "./freebusy";
import { invitePeople, sendReminders, unsubscribe } from "./invites";
import { clearHolds, closeVoting, deletePoll, reopenPoll, reopenVoting, retryHolds } from "./manage";
import { getPollGridOverlay } from "./overlay";
import { getHostPoll, getPollActivity, listPolls } from "./queries";
import { readEditTokenFromHeaders, setEditCookie } from "./tokens";
import type { ConfirmableResult, SubmitVoteActionResult } from "./types";
import { addOptions, checkSlugAvailable, removeOptions, updatePoll } from "./update";
import {
  AddOptionsSchema,
  AddParticipantSchema,
  BookPollSchema,
  CommentSchema,
  CreatePollSchema,
  DeletePollSchema,
  IcsCheckSchema,
  InviteSchema,
  ListPollsSchema,
  RemindSchema,
  RemoveOptionsSchema,
  RemoveParticipantSchema,
  ReopenPollSchema,
  SetVotesSchema,
  SubmitVoteSchema,
  UpdateParticipantSchema,
  UpdatePollSchema,
  VerifyEmailSchema,
} from "./validation";
import { checkVoterCalendar } from "./voter-calendar";
import { addParticipant, markPollViewed, removeParticipant, requestVoteCode, setParticipantVotes, submitVote, updateParticipant } from "./vote";

const zPollRef = z.object({ pollId: z.uuid() });
const zSlug = z.string().trim().min(1).max(100);
const zSlugRef = z.object({ slug: zSlug, embed: z.boolean().default(false) });

const LIST_PATH = "/app/scheduling/meeting-polls";

function refreshHost(pollId?: string, slug?: string): void {
  revalidatePath(LIST_PATH);
  if (pollId) revalidatePath(`/app/polls/${pollId}`);
  if (slug) revalidatePath(`/p/${slug}`);
}

function refreshVoter(slug: string): void {
  revalidatePath(`/p/${slug}`);
}

async function clientIp(): Promise<string | null> {
  return getClientIp(new Headers(await headers()));
}

/** A thrown confirmation request (details.requiresConfirm) becomes { done: false, confirm }. */
async function confirmable<T>(run: () => Promise<T>): Promise<ConfirmableResult<T>> {
  try {
    return { done: true, result: await run() };
  } catch (e) {
    if (isAppError(e) && e.details?.requiresConfirm) {
      const voters = Array.isArray(e.details.voters) ? e.details.voters.filter((v): v is string => typeof v === "string") : [];
      return { done: false, confirm: { message: e.message, voters } };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Host

/** "Share meeting poll" (MP-03) -> { pollId, slug, link, eventTypeId }. */
export async function createPollAction(raw: unknown) {
  return runAction(CreatePollSchema, raw, async (input, { actor }) => {
    const out = await createPoll(actor, input);
    refreshHost(out.pollId);
    return out;
  });
}

/** Edit after publish (MP-27); a more public results visibility with respondents needs confirmPublic. */
export async function updatePollAction(raw: unknown) {
  return runAction(UpdatePollSchema, raw, async (input, { actor }) => {
    const out = await confirmable(() => updatePoll(actor, input));
    if (out.done) refreshHost(out.result.pollId, out.result.slug);
    return out;
  });
}

/** "Add times" (MP-27) -> { added, optionIds, notified }. */
export async function addPollOptionsAction(raw: unknown) {
  return runAction(AddOptionsSchema, raw, async (input, { actor }) => {
    const out = await addOptions(actor, input);
    refreshHost(input.pollId);
    return out;
  });
}

/** Remove times; times with Yes or If need be votes need confirm (the warning lists the voters). */
export async function removePollOptionsAction(raw: unknown) {
  return runAction(RemoveOptionsSchema, raw, async (input, { actor }) => {
    const out = await confirmable(() => removeOptions(actor, input));
    if (out.done) refreshHost(input.pollId);
    return out;
  });
}

/** "Invite people" (MP-06) -> { invited, resent, skipped }. */
export async function invitePeopleAction(raw: unknown) {
  return runAction(InviteSchema, raw, async (input, { actor }) => {
    const out = await invitePeople(actor, input);
    refreshHost(input.pollId);
    return out;
  });
}

/** "Send reminder" to everyone who has not responded, or to the given participants (MP-24). */
export async function sendRemindersAction(raw: unknown) {
  return runAction(RemindSchema, raw, async (input, { actor }) => {
    const out = await sendReminders(actor, input);
    refreshHost(input.pollId);
    return out;
  });
}

/** "Add participant" with votes on their behalf (MP-17). */
export async function addParticipantAction(raw: unknown) {
  return runAction(AddParticipantSchema, raw, async (input, { actor }) => {
    const out = await addParticipant(actor, input);
    refreshHost(input.pollId);
    return out;
  });
}

/** Rename or mark a participant required (MP-17). */
export async function updateParticipantAction(raw: unknown) {
  return runAction(UpdateParticipantSchema, raw, async (input, { actor }) => {
    await updateParticipant(actor, input);
    refreshHost(input.pollId);
    return { participantId: input.participantId };
  });
}

/** "Remove from poll" (MP-17). */
export async function removeParticipantAction(raw: unknown) {
  return runAction(RemoveParticipantSchema, raw, async (input, { actor }) => {
    await removeParticipant(actor, input);
    refreshHost(input.pollId);
    return { participantId: input.participantId };
  });
}

/** "Edit votes" on behalf of a participant (MP-17). */
export async function setParticipantVotesAction(raw: unknown) {
  return runAction(SetVotesSchema, raw, async (input, { actor }) => {
    const out = await setParticipantVotes(actor, input);
    refreshHost(input.pollId);
    return out;
  });
}

/** "Close voting" (MP-22). */
export async function closeVotingAction(raw: unknown) {
  return runAction(zPollRef, raw, async (input, { actor }) => {
    await closeVoting(actor, input.pollId);
    refreshHost(input.pollId);
    return { pollId: input.pollId };
  });
}

/** "Reopen voting" with an optional new deadline (MP-22). */
export async function reopenVotingAction(raw: unknown) {
  return runAction(ReopenPollSchema, raw, async (input, { actor }) => {
    await reopenVoting(actor, input);
    refreshHost(input.pollId);
    return { pollId: input.pollId };
  });
}

/** "Reopen poll" after booking (MP-21): the meeting stays until the host rebooks. */
export async function reopenPollAction(raw: unknown) {
  return runAction(ReopenPollSchema, raw, async (input, { actor }) => {
    await reopenPoll(actor, input);
    refreshHost(input.pollId);
    return { pollId: input.pollId };
  });
}

/** "Delete poll" (owner or org admin; MP-21, MP-22). */
export async function deletePollAction(raw: unknown) {
  return runAction(DeletePollSchema, raw, async (input, { actor }) => {
    await deletePoll(actor, input);
    refreshHost(input.pollId);
    return { pollId: input.pollId };
  });
}

/** "Duplicate" (MP-32) -> the copy { pollId, slug, link, eventTypeId }. */
export async function duplicatePollAction(raw: unknown) {
  return runAction(zPollRef, raw, async (input, { actor }) => {
    const out = await duplicatePoll(actor, input.pollId);
    refreshHost(out.pollId);
    return out;
  });
}

/** "Release held times" (MP-25). */
export async function clearHoldsAction(raw: unknown) {
  return runAction(zPollRef, raw, async (input, { actor }) => {
    await clearHolds(actor, input.pollId);
    refreshHost(input.pollId);
    return { pollId: input.pollId };
  });
}

/** "Try again" for holds that failed to sync (MP-25). */
export async function retryHoldsAction(raw: unknown) {
  return runAction(zPollRef, raw, async (input, { actor }) => {
    await retryHolds(actor, input.pollId);
    refreshHost(input.pollId);
    return { pollId: input.pollId };
  });
}

/** The Book dialog data for one option (MP-18). */
export async function bookingPreviewAction(raw: unknown) {
  return runAction(z.object({ pollId: z.uuid(), optionId: z.uuid() }), raw, async (input, { actor }) => bookingPreview(actor, input.pollId, input.optionId));
}

/** "Book meeting" (MP-18, MP-19, MP-21 rebook) -> { scheduledEventId, ... }. */
export async function bookPollAction(raw: unknown) {
  return runAction(BookPollSchema, raw, async (input, { actor }) => {
    const out = await bookPoll(actor, input);
    refreshHost(input.pollId);
    revalidatePath("/app/meetings");
    return out;
  });
}

/** Host reply in comments ("Host" badge, MP-14). */
export async function addHostCommentAction(raw: unknown) {
  return runAction(CommentSchema.extend({ pollId: z.uuid() }), raw, async (input, { actor }) => {
    const out = await addHostComment(actor, input.pollId, { body: input.body });
    refreshHost(input.pollId);
    return out;
  });
}

/** Hosts delete any comment (MP-14). */
export async function deleteHostCommentAction(raw: unknown) {
  return runAction(z.object({ pollId: z.uuid(), commentId: z.uuid() }), raw, async (input, { actor }) => {
    await deleteHostComment(actor, input.pollId, input.commentId);
    refreshHost(input.pollId);
    return { commentId: input.commentId };
  });
}

/** "Customize link" availability check -> { available }. */
export async function checkPollSlugAction(raw: unknown) {
  return runAction(z.object({ slug: z.string().trim().max(100), pollId: z.uuid().optional() }), raw, async (input, { actor }) => ({
    available: await checkSlugAvailable(actor, input.slug, input.pollId),
  }));
}

/** Busy overlay and working hours for the creation grid (MP-02). Dates are ISO instants. */
export async function pollGridOverlayAction(raw: unknown) {
  return runAction(
    z.object({ start: z.iso.datetime({ offset: true }), end: z.iso.datetime({ offset: true }), hostIds: z.array(z.uuid()).max(11).optional(), pollId: z.uuid().nullish() }),
    raw,
    async (input, { actor }) => getPollGridOverlay(actor, { start: new Date(input.start), end: new Date(input.end), hostIds: input.hostIds, pollId: input.pollId ?? null }),
  );
}

/** Activity since an ISO instant (live updates on the results page). */
export async function pollActivityAction(raw: unknown) {
  return runAction(z.object({ pollId: z.uuid(), since: z.iso.datetime({ offset: true }).nullish() }), raw, async (input, { actor }) =>
    getPollActivity(actor, input.pollId, input.since ? new Date(input.since) : null),
  );
}

/** The meeting polls list (filters, search, "Load more"). */
export async function listPollsAction(raw: unknown) {
  return runAction(ListPollsSchema, raw, async (input, { actor }) => listPolls(actor, input));
}

/** Clears the "New" dot (MP-26). */
export async function markPollViewedAction(raw: unknown) {
  return runAction(zPollRef, raw, async (input, { actor }) => {
    await markPollViewed(actor, input.pollId);
    revalidatePath(LIST_PATH);
    return { pollId: input.pollId };
  });
}

/** The results page data again (after a live update). */
export async function getHostPollAction(raw: unknown) {
  return runAction(zPollRef, raw, async (input, { actor }) => getHostPoll(actor, input.pollId));
}

// ---------------------------------------------------------------------------------------------------------------
// Voter (public)

/**
 * "Share times" / "None of these work for me" (MP-08 to MP-11). Sets the edit cookies on success; the token itself is
 * returned only inside embeds (the page mirrors it in localStorage when the browser blocks the cookie).
 */
export async function submitVoteAction(raw: unknown) {
  return runAction(
    SubmitVoteSchema.extend({ slug: zSlug }),
    raw,
    async ({ slug, ...input }, { actor }): Promise<SubmitVoteActionResult> => {
      const outcome = await submitVote(slug, input, {
        editToken: await readEditTokenFromHeaders(),
        inviteToken: input.inviteToken ?? null,
        userId: actor?.user.id ?? null,
        ip: await clientIp(),
      });
      if (!outcome.ok) return outcome;
      await setEditCookie(slug, outcome.editToken, { embed: input.embed });
      refreshVoter(slug);
      return { ok: true, participantId: outcome.participantId, status: outcome.status, created: outcome.created, editToken: input.embed ? outcome.editToken : null };
    },
    { auth: "none" },
  );
}

/** Sends the "Verify email" code (MP-04) -> { required, expiresAt }. */
export async function requestVoteCodeAction(raw: unknown) {
  return runAction(VerifyEmailSchema.extend({ slug: zSlug }), raw, async ({ slug, ...input }) => requestVoteCode(slug, input, { ip: await clientIp() }), { auth: "none" });
}

/** A voter's comment (MP-14). */
export async function addPublicCommentAction(raw: unknown) {
  return runAction(
    CommentSchema.extend({ slug: zSlug }),
    raw,
    async ({ slug, ...input }, { actor }) => {
      const out = await addPublicComment(slug, input, { editToken: await readEditTokenFromHeaders(), userId: actor?.user.id ?? null, ip: await clientIp() });
      refreshVoter(slug);
      return out;
    },
    { auth: "none" },
  );
}

/** A voter deletes their own comment. */
export async function deletePublicCommentAction(raw: unknown) {
  return runAction(
    z.object({ slug: zSlug, commentId: z.uuid() }),
    raw,
    async (input, { actor }) => {
      await deletePublicComment(input.slug, input.commentId, { editToken: await readEditTokenFromHeaders(), userId: actor?.user.id ?? null });
      refreshVoter(input.slug);
      return { commentId: input.commentId };
    },
    { auth: "none" },
  );
}

/** The /p/{slug}/unsubscribe page button (MP-23) -> { unsubscribed }. */
export async function unsubscribeAction(raw: unknown) {
  return runAction(z.object({ slug: zSlug, token: z.string().trim().min(1).max(300) }), raw, async (input) => ({ unsubscribed: await unsubscribe(input.slug, input.token) }), {
    auth: "none",
  });
}

/** "Paste an ICS link" (MP-13): the result goes to the voter's browser cookie and back. */
export async function checkIcsCalendarAction(raw: unknown) {
  return runAction(
    IcsCheckSchema.extend({ slug: zSlug, embed: z.boolean().default(false) }),
    raw,
    async (input) => {
      const out = await checkVoterCalendar(input.slug, { icsUrl: input.icsUrl }, { ip: await clientIp() });
      await setCheckCookie(out.slug, out.cookie, { embed: input.embed });
      return out.check;
    },
    { auth: "none" },
  );
}

/** "Use my Kairos calendars" for a signed-in voter (their connected conflict calendars, MP-13). */
export async function checkAccountCalendarAction(raw: unknown) {
  return runAction(zSlugRef, raw, async (input, { actor }) => {
    const out = await checkVoterCalendar(input.slug, { userId: actor.user.id }, { ip: await clientIp() });
    await setCheckCookie(out.slug, out.cookie, { embed: input.embed });
    return out.check;
  });
}

/** "Clear" next to the calendar check. */
export async function clearCalendarCheckAction(raw: unknown) {
  return runAction(
    zSlugRef,
    raw,
    async (input) => {
      await deleteCheckCookie(input.slug, { embed: input.embed });
      return { cleared: true };
    },
    { auth: "none" },
  );
}
