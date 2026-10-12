// Email invitations, reminders and unsubscribes (SPEC MP-06, MP-16, MP-23, MP-24; research meeting-polls.md B4.2,
// B11). Server only.
//
// - invitePeople: each recipient becomes a participant with status invited and a personal link /p/{slug}?i={token}
//   (prefills name and email read-only and ties the votes to the row). Limits: 200 recipients per send, 1,000
//   participants per poll, 200 invite emails per host per day. Already invited people are sent the invitation again;
//   people who already responded are skipped. The first send starts the smart reminders.
// - sendReminders: "Send reminder now" for every (or the selected) invited non-respondents, throttled to once per
//   participant per 12 hours; "Resend invite" is the same for one row.
// - unsubscribe: stops invites, reminders and update emails for one poll (never booking invites). GET of the link
//   changes nothing (the page shows a button that POSTs), the POST is one-click compatible (RFC 8058).
import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { meetingPollParticipants, meetingPolls, users } from "@/db/schema";
import type { ActorCtx } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { runJobsAfterResponse } from "@/lib/jobs";
import { rateLimit } from "@/lib/rate-limit";
import { now as clockNow } from "@/lib/time/now";
import { normalizeEmail } from "@/lib/validation";
import { requirePollAccess } from "./access";
import { recordActivity } from "./activity";
import { MANUAL_REMINDER_THROTTLE_MS, MAX_INVITE_EMAILS_PER_DAY, MAX_POLL_PARTICIPANTS, POLL_ERRORS, pollJobGroup } from "./constants";
import { loadOptions, loadPollBySlug, lockPoll, participantCount, statusOf } from "./load";
import { enqueuePollEmail, scheduleAnchorReminders, scheduleInviteReminders } from "./schedule";
import { tokenHashesFor, verifyUnsubscribeToken } from "./tokens";
import { InviteSchema, RemindSchema } from "./validation";

export type InviteResult = { invited: number; resent: number; skipped: { email: string; reason: "responded" }[] };

/** "Invite people" (MP-06). */
export async function invitePeople(actor: ActorCtx, raw: unknown): Promise<InviteResult> {
  const input = InviteSchema.parse(raw);
  const db = await getDb();
  await requirePollAccess(actor, input.pollId, db);
  const at = clockNow();
  // Dedupe by email (first entry wins).
  const seen = new Set<string>();
  const recipients = input.recipients.filter((r) => {
    const k = normalizeEmail(r.email);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const limit = await rateLimit(`poll-invites:user:${actor.user.id}`, MAX_INVITE_EMAILS_PER_DAY, 86_400, { nowMs: at.getTime(), cost: recipients.length });
  if (!limit.ok) throw new AppError("rate_limited", POLL_ERRORS.inviteDailyLimit);

  const out = await db.transaction(async (tx) => {
    const poll = await lockPoll(tx, input.pollId, "update");
    if (poll.deletedAt) throw new AppError("not_found", POLL_ERRORS.notFound);
    const options = await loadOptions(tx, poll.id);
    const status = statusOf(poll, options, at);
    if (status !== "open") throw new AppError("conflict", status === "booked" ? POLL_ERRORS.pollBooked : status === "expired" ? POLL_ERRORS.pollEnded : POLL_ERRORS.votingClosed);
    const emails = recipients.map((r) => normalizeEmail(r.email));
    const existing = emails.length
      ? await tx
          .select()
          .from(meetingPollParticipants)
          .where(and(eq(meetingPollParticipants.pollId, poll.id), inArray(meetingPollParticipants.emailNormalized, emails), isNull(meetingPollParticipants.deletedAt)))
      : [];
    const byEmail = new Map(existing.map((p) => [p.emailNormalized!, p]));
    const fresh = recipients.filter((r) => !byEmail.has(normalizeEmail(r.email)));
    if ((await participantCount(tx, poll.id)) + fresh.length > MAX_POLL_PARTICIPANTS) throw new AppError("validation", POLL_ERRORS.tooManyParticipants);
    const result: InviteResult = { invited: 0, resent: 0, skipped: [] };
    const sendTo: string[] = [];
    for (const r of recipients) {
      const prev = byEmail.get(normalizeEmail(r.email));
      if (prev) {
        if (prev.status !== "invited") {
          result.skipped.push({ email: r.email, reason: "responded" });
          continue;
        }
        // Invited again: refresh the invitation (and the required flag when asked), never resubscribe silently.
        const hashes = await tokenHashesFor(prev.id);
        await tx
          .update(meetingPollParticipants)
          .set({ inviteTokenHash: hashes.inviteTokenHash, invitedAt: at, isRequired: prev.isRequired || r.required, name: prev.name || r.name?.trim() || "", updatedAt: at })
          .where(eq(meetingPollParticipants.id, prev.id));
        if (!prev.unsubscribedAt) sendTo.push(prev.id);
        result.resent++;
        continue;
      }
      const id = newId();
      const hashes = await tokenHashesFor(id);
      await tx.insert(meetingPollParticipants).values({
        id,
        pollId: poll.id,
        name: r.name?.trim() ?? "",
        email: r.email,
        emailNormalized: normalizeEmail(r.email),
        status: "invited",
        source: "invite",
        isRequired: r.required,
        editTokenHash: hashes.editTokenHash,
        inviteTokenHash: hashes.inviteTokenHash,
        invitedAt: at,
        createdByUserId: actor.user.id,
        createdAt: at,
        updatedAt: at,
      });
      sendTo.push(id);
      result.invited++;
    }
    for (const id of sendTo) {
      await enqueuePollEmail(
        tx,
        { template: "invitation", pollId: poll.id, participantId: id, userId: actor.user.id, data: { subject: input.subject ?? null, message: input.message ?? null } },
        `${poll.id}:invitation:${id}:${at.getTime()}`,
        at,
      );
    }
    if (sendTo.length) {
      const firstInviteSentAt = poll.firstInviteSentAt ?? at;
      if (!poll.firstInviteSentAt) await tx.update(meetingPolls).set({ firstInviteSentAt, updatedAt: at }).where(eq(meetingPolls.id, poll.id));
      await recordActivity(tx, { pollId: poll.id, type: "invited", actorUserId: actor.user.id, data: { count: sendTo.length, participantIds: sendTo }, at });
      const timed = { ...poll, firstInviteSentAt };
      await scheduleAnchorReminders(tx, timed, options, at);
      await scheduleInviteReminders(tx, timed, options, { invitedAt: at, participantIds: sendTo }, at);
    }
    return result;
  });
  runJobsAfterResponse({ groupKeys: [pollJobGroup(input.pollId)] });
  return out;
}

export type RemindResult = { sent: number; throttled: number };

/** "Send reminder now" / "Resend invite" (MP-16): invited non-respondents only, once per participant per 12 hours. */
export async function sendReminders(actor: ActorCtx, raw: unknown): Promise<RemindResult> {
  const input = RemindSchema.parse(raw);
  const db = await getDb();
  await requirePollAccess(actor, input.pollId, db);
  const at = clockNow();
  const out = await db.transaction(async (tx) => {
    const poll = await lockPoll(tx, input.pollId, "update");
    const options = await loadOptions(tx, poll.id);
    if (statusOf(poll, options, at) !== "open") throw new AppError("conflict", POLL_ERRORS.votingClosed);
    const rows = await tx
      .select()
      .from(meetingPollParticipants)
      .where(
        and(
          eq(meetingPollParticipants.pollId, poll.id),
          eq(meetingPollParticipants.status, "invited"),
          isNull(meetingPollParticipants.deletedAt),
          isNull(meetingPollParticipants.unsubscribedAt),
          input.participantIds ? inArray(meetingPollParticipants.id, input.participantIds.length ? input.participantIds : [poll.id]) : undefined,
        ),
      );
    const result: RemindResult = { sent: 0, throttled: 0 };
    for (const p of rows) {
      if (!p.email) continue;
      const last = Math.max(p.lastRemindedAt?.getTime() ?? 0, p.invitedAt?.getTime() ?? 0);
      if (at.getTime() - last < MANUAL_REMINDER_THROTTLE_MS) {
        result.throttled++;
        continue;
      }
      await tx.update(meetingPollParticipants).set({ lastRemindedAt: at, updatedAt: at }).where(eq(meetingPollParticipants.id, p.id));
      await enqueuePollEmail(tx, { template: "reminder", pollId: poll.id, participantId: p.id, userId: actor.user.id }, `${poll.id}:manual_reminder:${p.id}:${at.getTime()}`, at);
      result.sent++;
    }
    if (result.sent) await recordActivity(tx, { pollId: poll.id, type: "reminder_sent", actorUserId: actor.user.id, data: { count: result.sent, manual: true }, at });
    return result;
  });
  if (out.sent === 0 && out.throttled > 0) throw new AppError("rate_limited", POLL_ERRORS.reminderThrottled);
  runJobsAfterResponse({ groupKeys: [pollJobGroup(input.pollId)] });
  return out;
}

export type UnsubscribeContext = { pollTitle: string; hostName: string; participantName: string; unsubscribed: boolean };

/** What the unsubscribe page shows (GET: nothing changes). Null for an invalid link. */
export async function getUnsubscribeContext(slug: string, token: string | null | undefined): Promise<UnsubscribeContext | null> {
  const participantId = await verifyUnsubscribeToken(token);
  if (!participantId) return null;
  const db = await getDb();
  const found = await loadPollBySlug(db, slug, clockNow());
  if (!found) return null;
  const [row] = await db
    .select({ name: meetingPollParticipants.name, pollId: meetingPollParticipants.pollId, unsubscribedAt: meetingPollParticipants.unsubscribedAt, hostName: users.name })
    .from(meetingPollParticipants)
    .innerJoin(meetingPolls, eq(meetingPolls.id, meetingPollParticipants.pollId))
    .innerJoin(users, eq(users.id, meetingPolls.ownerUserId))
    .where(eq(meetingPollParticipants.id, participantId))
    .limit(1);
  if (!row || row.pollId !== found.poll.id) return null;
  return { pollTitle: found.poll.title, hostName: row.hostName, participantName: row.name, unsubscribed: Boolean(row.unsubscribedAt) };
}

/** POST unsubscribe (one-click compatible). Idempotent; false for an invalid link. */
export async function unsubscribe(slug: string, token: string | null | undefined): Promise<boolean> {
  const participantId = await verifyUnsubscribeToken(token);
  if (!participantId) return false;
  const db = await getDb();
  const at = clockNow();
  const found = await loadPollBySlug(db, slug, at);
  const poll = found?.poll ?? null;
  if (!poll) return false;
  const rows = await db
    .update(meetingPollParticipants)
    .set({ unsubscribedAt: at, subscribedToUpdates: false, updatedAt: at })
    .where(and(eq(meetingPollParticipants.id, participantId), eq(meetingPollParticipants.pollId, poll.id), isNull(meetingPollParticipants.unsubscribedAt)))
    .returning({ id: meetingPollParticipants.id });
  if (!rows.length) {
    // Already unsubscribed (or removed): still a success for the one-click POST.
    const [p] = await db.select({ id: meetingPollParticipants.id }).from(meetingPollParticipants).where(and(eq(meetingPollParticipants.id, participantId), eq(meetingPollParticipants.pollId, poll.id))).limit(1);
    return Boolean(p);
  }
  return true;
}
