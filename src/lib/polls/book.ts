// Booking the final time (SPEC MP-18, MP-19, MP-21, MP-31; research meeting-polls.md B7, B8). Server only.
//
// First booking: booking-core createBooking on the poll's adhoc event type (target event_type, the option's start and
// duration, the first invitee as the main invitee, actor host, pollContext with every selected person). Poll mode in
// booking-core ignores working hours, limits and buffers (0/0), blocks on app meetings by their own times and only
// warns about external events; email confirmation mode always (MP-19: each invitee gets their own email, ICS and cancel
// link; hidden polls send individual ICS invites, MP-20). booking-core calls markPollBookedInTx after the host locks,
// which marks the poll booked inside the same transaction, so two concurrent Book requests create one meeting.
//
// Rebooking a reopened poll (MP-21): the same option keeps the meeting (invitees reconciled); another option moves the
// same scheduled event in place through lifecycle moveScheduledEvent (same row and UID, SEQUENCE + 1, "Updated"
// emails, calendar and conference updated). Removed invitees are canceled first (CANCEL at the old time); added ones
// are inserted after the lifecycle move job ran (polls.rebook_invitees), so they get a plain confirmation at the new
// time. When nobody of the old meeting stays (also at the same time), or the new time is longer than a movable
// meeting, the old meeting is canceled and a new one booked.
import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { invitees, meetingPollParticipants, meetingPolls, scheduledEvents } from "@/db/schema";
import type { ActorCtx } from "@/lib/authz";
import { createBooking } from "@/lib/booking";
import { AppError } from "@/lib/errors";
import { publishEvent } from "@/lib/events";
import { enqueueJob, runJobsAfterResponse } from "@/lib/jobs";
import { cancelInvitee, cancelScheduledEvent, moveScheduledEvent } from "@/lib/lifecycle";
import { log } from "@/lib/logger";
import { now as clockNow } from "@/lib/time/now";
import { normalizeEmail } from "@/lib/validation";
import { requirePollAccess } from "./access";
import { recordActivity } from "./activity";
import { MAX_BOOKABLE_MINUTES, POLL_COPY, POLL_ERRORS, POLL_JOBS, pollJobGroup } from "./constants";
import { hostBusyForPoll, optionHostStatus, optionStatuses } from "./conflicts";
import { runWithBookingIntent } from "./intent";
import { endOf, hostViews, loadOptions, loadParticipants, loadPoll, loadPollHosts, loadVotes, lockPoll, optionView, startOf, statusOf, votesByParticipant, type OptionRow, type PollHostRow, type PollRow } from "./load";
import { consensusOptions, isRespondent } from "./ranking";
import { cancelPollTimers, enqueueHoldsSync, enqueuePollEmail, scheduleMeetingReminders } from "./schedule";
import { bookable } from "./state";
import { locationView } from "./views";
import { BookPollSchema, type BookPollInput } from "./validation";
import type { BookingPreview, BookingPreviewInvitee, BookPollResult } from "./types";

const MAX_MOVE_MINUTES = MAX_BOOKABLE_MINUTES;

type Viewer = { userId: string; organizationId: string };

async function activeMeeting(poll: PollRow) {
  if (!poll.bookedScheduledEventId) return null;
  const db = await getDb();
  const [m] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, poll.bookedScheduledEventId)).limit(1);
  return m && m.status === "active" ? m : null;
}

/** The Book dialog (MP-18): summary, live conflict check and the default invitee selection. */
export async function bookingPreview(actor: ActorCtx, pollId: string, optionId: string): Promise<BookingPreview> {
  const db = await getDb();
  const { poll } = await requirePollAccess(actor, pollId, db);
  const at = clockNow();
  const options = await loadOptions(db, poll.id);
  const option = options.find((o) => o.id === optionId);
  if (!option) throw new AppError("not_found", POLL_ERRORS.optionNotFound);
  const hosts = await loadPollHosts(db, poll);
  const busy = await hostBusyForPoll({ userId: actor.user.id, organizationId: actor.orgId }, poll, hosts.map((h) => h.userId), [option], at);
  const range = { start: startOf(option, poll.timezone), end: endOf(option, poll.timezone) };
  const blocking: BookingPreview["blocking"] = [];
  const warnings: BookingPreview["warnings"] = [];
  for (const h of hosts) {
    const s = optionHostStatus(range, busy ? { [h.userId]: busy[h.userId] ?? [] } : null, [h], poll.bookedScheduledEventId);
    if (s.state === "booked") blocking.push({ title: s.title, hostName: s.hostName, meetingId: s.meetingId });
    else if (s.state === "conflict") warnings.push({ kind: "calendar", title: s.title, hostName: s.hostName });
    else if (s.state === "hold") warnings.push({ kind: "hold", title: s.title, hostName: s.hostName });
  }
  const participants = await loadParticipants(db, poll.id);
  const votes = votesByParticipant(await loadVotes(db, poll.id));
  const list: BookingPreviewInvitee[] = participants.map((p) => {
    const answer = votes.get(p.id)?.[option.id] ?? null;
    const responded = isRespondent(p);
    const section = !responded ? "no_response" : answer === "yes" || answer === "if_need_be" ? "can_attend" : "cannot_attend";
    return {
      participantId: p.id,
      name: p.name || p.email || "",
      email: p.email,
      status: p.status,
      answer,
      section,
      // Respondents are invited by default (Doodle sends the invite to all participants), non-respondents are not.
      checked: Boolean(p.email) && responded,
      disabledReason: p.email ? null : POLL_ERRORS.inviteeNoEmail,
      timezone: p.timezone,
    };
  });
  const meeting = await activeMeeting(poll);
  return {
    pollId: poll.id,
    option: optionView(option, poll.timezone, at),
    title: poll.title,
    location: locationView(poll.location),
    hosts: hostViews(hosts),
    timezone: poll.timezone,
    otherZones: participants.filter((p) => isRespondent(p) && p.timezone && p.timezone !== poll.timezone).length,
    blocking,
    warnings,
    invitees: list,
    hideInvitees: poll.hideInvitees,
    rebook: meeting ? { scheduledEventId: meeting.id, start: meeting.startAt.toISOString(), end: meeting.endAt.toISOString(), sameOption: poll.bookedOptionId === option.id } : null,
    sendMeetingReminders: poll.sendMeetingReminders,
    unbookableReason:
      range.start <= at.getTime() ? POLL_ERRORS.optionPast : (range.end - range.start) / 60_000 > MAX_BOOKABLE_MINUTES ? POLL_ERRORS.bookTooLong : null,
  };
}

type Person = { participantId: string | null; name: string; email: string; timezone: string | null };

/** Validated invitees: participants of this poll with their stored email, plus added people; deduped by email. */
async function resolveInvitees(poll: PollRow, list: BookPollInput["invitees"]): Promise<Person[]> {
  const db = await getDb();
  const ids = list.map((i) => i.participantId).filter((v): v is string => Boolean(v));
  const rows = ids.length
    ? await db
        .select()
        .from(meetingPollParticipants)
        .where(and(eq(meetingPollParticipants.pollId, poll.id), inArray(meetingPollParticipants.id, ids), isNull(meetingPollParticipants.deletedAt)))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Person[] = [];
  const seen = new Set<string>();
  for (const i of list) {
    let person: Person;
    if (i.participantId) {
      const p = byId.get(i.participantId);
      if (!p) throw new AppError("validation", "One of the selected people is no longer part of the poll.");
      if (!p.email) throw new AppError("validation", POLL_ERRORS.inviteeNoEmail);
      person = { participantId: p.id, name: p.name || p.email, email: p.email, timezone: p.timezone };
    } else {
      person = { participantId: null, name: i.name?.trim() || i.email, email: i.email, timezone: null };
    }
    const key = normalizeEmail(person.email);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(person);
  }
  if (!out.length) throw new AppError("validation", POLL_ERRORS.noInvitees);
  return out;
}

function assertNoAppConflict(status: ReturnType<typeof optionHostStatus>): void {
  if (status.state !== "booked") return;
  throw new AppError("slot_unavailable", status.title ? POLL_ERRORS.appConflict.replace("{event}", status.title) : POLL_ERRORS.appConflictUntitled, {
    details: { meetingId: status.meetingId },
  });
}

/** createBooking for a first booking (or a fresh meeting after a rebook that cannot move). */
async function bookFresh(
  poll: PollRow,
  option: OptionRow,
  people: Person[],
  booker: { userId: string },
  intent: { message: string | null; sendMeetingReminders: boolean; notifyExcluded: boolean; auto: boolean },
): Promise<string> {
  const start = startOf(option, poll.timezone);
  const minutes = Math.round((endOf(option, poll.timezone) - start) / 60_000);
  const first = people[0]!;
  const result = await runWithBookingIntent({ pollId: poll.id, ...intent }, () =>
    createBooking(
      {
        target: { kind: "event_type", eventTypeId: poll.eventTypeId },
        start: new Date(start).toISOString(),
        durationMinutes: minutes,
        invitee: { name: first.name, email: first.email, timezone: first.timezone ?? poll.timezone, locale: poll.locale },
        actor: { type: "host", userId: booker.userId },
        pollContext: {
          pollId: poll.id,
          optionId: option.id,
          bookedByUserId: booker.userId,
          participants: people.map((p) => ({ participantId: p.participantId, name: p.name, email: p.email, timezone: p.timezone ?? poll.timezone })),
        },
      },
      {},
    ),
  );
  if (!result.ok) {
    // A double click: the first request already booked this option.
    const fresh = await loadPoll(await getDb(), poll.id);
    if (fresh?.status === "booked" && fresh.bookedOptionId === option.id && fresh.bookedScheduledEventId) return fresh.bookedScheduledEventId;
    if (result.code === "validation") throw new AppError("validation", result.message, { fieldErrors: result.fieldErrors });
    throw new AppError("slot_unavailable", result.message);
  }
  return result.scheduledEventId;
}

/** "Book meeting" (MP-18, MP-19) and rebooking a reopened poll (MP-21). */
export async function bookPoll(actor: ActorCtx, raw: BookPollInput | unknown, opts: { auto?: boolean } = {}): Promise<BookPollResult> {
  const input = BookPollSchema.parse(raw);
  const db = await getDb();
  const { poll } = await requirePollAccess(actor, input.pollId, db);
  return bookPollAs({ userId: actor.user.id, organizationId: actor.orgId }, poll, input, { actorCtx: actor, auto: opts.auto ?? false });
}

async function bookPollAs(
  viewer: Viewer,
  poll0: PollRow,
  input: ReturnType<typeof BookPollSchema.parse>,
  opts: { actorCtx: ActorCtx | null; auto: boolean },
): Promise<BookPollResult> {
  const db = await getDb();
  const at = clockNow();
  const options = await loadOptions(db, poll0.id);
  const option = options.find((o) => o.id === input.optionId);
  if (!option) throw new AppError("not_found", POLL_ERRORS.optionNotFound);
  if (startOf(option, poll0.timezone) <= at.getTime()) throw new AppError("validation", POLL_ERRORS.optionPast);
  if ((endOf(option, poll0.timezone) - startOf(option, poll0.timezone)) / 60_000 > MAX_BOOKABLE_MINUTES) throw new AppError("validation", POLL_ERRORS.bookTooLong);
  const status = statusOf(poll0, options, at);
  if (!bookable(status)) {
    if (status === "booked") {
      // A second click on the booked time answers the same meeting; once that meeting was canceled (from Meetings),
      // the host reopens the poll first (MP-21 "Meeting canceled" with "Reopen poll").
      const current = await activeMeeting(poll0);
      if (current && poll0.bookedOptionId === option.id) return { scheduledEventId: current.id, mode: "unchanged" };
      throw new AppError("conflict", POLL_ERRORS.rebookReopen);
    }
    throw new AppError("conflict", status === "expired" ? POLL_ERRORS.pollEnded : POLL_ERRORS.notFound);
  }
  const people = await resolveInvitees(poll0, input.invitees);
  const hosts = await loadPollHosts(db, poll0);
  const busy = await hostBusyForPoll(viewer, poll0, hosts.map((h) => h.userId), [option], at);
  assertNoAppConflict(optionHostStatus({ start: startOf(option, poll0.timezone), end: endOf(option, poll0.timezone) }, busy, hosts, poll0.bookedScheduledEventId));
  const intent = { message: input.message?.trim() || null, sendMeetingReminders: input.sendMeetingReminders, notifyExcluded: input.notifyExcluded, auto: opts.auto };
  const booker = { userId: viewer.userId };

  const meeting = await activeMeeting(poll0);
  if (!meeting) {
    const scheduledEventId = await bookFresh(poll0, option, people, booker, intent);
    // booking-core runs the booking.created jobs; the poll's own side effects (holds, reminders, emails) run here.
    runJobsAfterResponse({ groupKeys: [pollJobGroup(poll0.id)] });
    return { scheduledEventId, mode: "booked" };
  }
  if (!opts.actorCtx) throw new AppError("conflict", POLL_ERRORS.pollBooked); // auto-book never rebooks
  return rebook(opts.actorCtx, poll0, option, people, meeting, hosts, intent);
}

async function rebook(
  actor: ActorCtx,
  poll0: PollRow,
  option: OptionRow,
  people: Person[],
  meeting: typeof scheduledEvents.$inferSelect,
  hosts: PollHostRow[],
  intent: { message: string | null; sendMeetingReminders: boolean; notifyExcluded: boolean; auto: boolean },
): Promise<BookPollResult> {
  const db = await getDb();
  const at = clockNow();
  const start = new Date(startOf(option, poll0.timezone));
  const end = new Date(endOf(option, poll0.timezone));
  const sameTime = meeting.startAt.getTime() === start.getTime() && meeting.endAt.getTime() === end.getTime();
  const current = await db.select().from(invitees).where(and(eq(invitees.scheduledEventId, meeting.id), eq(invitees.status, "active")));
  const wanted = new Set(people.map((p) => normalizeEmail(p.email)));
  const removed = current.filter((i) => !wanted.has(i.emailNormalized));
  const have = new Set(current.map((i) => i.emailNormalized));
  const added = people.filter((p) => !have.has(normalizeEmail(p.email)));
  const kept = current.length - removed.length;
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);

  // Nobody stays (whatever the time: canceling the last invitee would cancel the meeting itself, so the new people
  // could never be added to it), or the new time can't be moved to: cancel the old meeting and book a new one.
  if (kept === 0 || (!sameTime && minutes > MAX_MOVE_MINUTES)) {
    await cancelScheduledEvent({ scheduledEventId: meeting.id, actor: { type: "user", ctx: actor }, reason: null, notify: true });
    const fresh = await loadPoll(db, poll0.id);
    if (!fresh) throw new AppError("not_found", POLL_ERRORS.notFound);
    const scheduledEventId = await bookFresh(fresh, option, people, { userId: actor.user.id }, intent);
    return { scheduledEventId, mode: "rebooked" };
  }

  // Claim the rebook (a concurrent second Book sees the poll booked).
  const fromOptionId = poll0.bookedOptionId;
  await db.transaction(async (tx) => {
    const poll = await lockPoll(tx, poll0.id, "update");
    const options = await loadOptions(tx, poll.id);
    if (!bookable(statusOf(poll, options, at)) || poll.bookedScheduledEventId !== meeting.id) throw new AppError("conflict", POLL_ERRORS.pollBooked);
    await tx
      .update(meetingPolls)
      .set({ status: "booked", bookedOptionId: option.id, bookedAt: at, bookedByUserId: actor.user.id, votingClosedAt: poll.votingClosedAt ?? at, sendMeetingReminders: intent.sendMeetingReminders, updatedAt: at })
      .where(eq(meetingPolls.id, poll.id));
  });
  const revert = async () => {
    await db.update(meetingPolls).set({ status: "open", bookedOptionId: fromOptionId, updatedAt: clockNow() }).where(eq(meetingPolls.id, poll0.id));
  };

  try {
    for (const inv of removed) {
      await cancelInvitee({ inviteeId: inv.id, actor: { type: "user", ctx: actor }, reason: POLL_COPY.removedByHostReason, notify: true });
    }
    if (!sameTime) await moveScheduledEvent({ scheduledEventId: meeting.id, start, end, actor: { type: "user", ctx: actor } });
  } catch (e) {
    await revert();
    if (e instanceof AppError && e.code === "validation" && minutes > MAX_MOVE_MINUTES) throw new AppError("validation", POLL_ERRORS.moveTooLong);
    throw e;
  }

  const [moved] = await db.select({ icsSequence: scheduledEvents.icsSequence }).from(scheduledEvents).where(eq(scheduledEvents.id, meeting.id)).limit(1);
  await db.transaction(async (tx) => {
    await recordActivity(tx, { pollId: poll0.id, type: sameTime ? "booked" : "rebooked", actorUserId: actor.user.id, data: { optionId: option.id, fromOptionId, scheduledEventId: meeting.id, added: added.length, removed: removed.length }, at });
    await publishEvent(tx, "poll.booked", { pollId: poll0.id, scheduledEventId: meeting.id }, { organizationId: poll0.organizationId, actor: { type: "user", userId: actor.user.id } });
    await cancelPollTimers(tx, poll0.id);
    if (poll0.reserveTimes) await enqueueHoldsSync(tx, poll0.id, at);
    if (intent.sendMeetingReminders) await scheduleMeetingReminders(tx, poll0.id, meeting.id, start, at);
    if (added.length) {
      await enqueueJob(tx, {
        type: POLL_JOBS.rebookInvitees,
        payload: {
          pollId: poll0.id,
          scheduledEventId: meeting.id,
          sequence: sameTime ? null : (moved?.icsSequence ?? null),
          invitees: added.map((p) => ({ participantId: p.participantId, name: p.name, email: p.email, timezone: p.timezone ?? poll0.timezone })),
          message: intent.message,
          bookedByUserId: actor.user.id,
        },
        runAt: at,
        groupKey: pollJobGroup(poll0.id),
        idempotencyKey: `poll:${poll0.id}:rebook_invitees:${meeting.id}:${at.getTime()}`,
      });
    }
    if (intent.notifyExcluded) {
      const respondents = await tx
        .select({ id: meetingPollParticipants.id, email: meetingPollParticipants.emailNormalized, status: meetingPollParticipants.status, unsubscribedAt: meetingPollParticipants.unsubscribedAt })
        .from(meetingPollParticipants)
        .where(and(eq(meetingPollParticipants.pollId, poll0.id), isNull(meetingPollParticipants.deletedAt)));
      for (const r of respondents) {
        if (r.status === "invited" || !r.email || r.unsubscribedAt || wanted.has(r.email)) continue;
        await enqueuePollEmail(tx, { template: "time_chosen", pollId: poll0.id, participantId: r.id, data: { optionId: option.id } }, `${poll0.id}:time_chosen:${meeting.id}:${option.id}:${r.id}`, at);
      }
    }
  });
  runJobsAfterResponse({ groupKeys: [pollJobGroup(poll0.id)] });
  return { scheduledEventId: meeting.id, mode: sameTime && !added.length && !removed.length ? "unchanged" : "rebooked" };
}

/**
 * Auto-book on consensus (MP-31, job polls.auto_book): while open, when every invited (or every required) participant
 * responded and an option has all of them at a strict Yes with the hosts free, books the earliest such option with
 * the default invitee selection (respondents with an email) and emails the host "We booked {time} because everyone
 * agreed." Never over app conflicts, never a reopened poll with a meeting.
 */
export async function autoBookIfConsensus(pollId: string): Promise<{ booked: boolean; scheduledEventId?: string }> {
  const db = await getDb();
  const poll = await loadPoll(db, pollId);
  if (!poll || poll.deletedAt || !poll.autoBook) return { booked: false };
  const at = clockNow();
  const options = await loadOptions(db, poll.id);
  if (statusOf(poll, options, at) !== "open" || (await activeMeeting(poll))) return { booked: false };
  const participants = await loadParticipants(db, poll.id);
  const votes = await loadVotes(db, poll.id);
  const hosts = await loadPollHosts(db, poll);
  const viewer = { userId: poll.ownerUserId, organizationId: poll.organizationId };
  const busy = await hostBusyForPoll(viewer, poll, hosts.map((h) => h.userId), options, at);
  if (!busy) return { booked: false };
  const { busyIds } = optionStatuses(poll, options, busy, hosts, at);
  const rankOptions = options.map((o) => ({ id: o.id, start: startOf(o, poll.timezone) }));
  const candidates = consensusOptions(
    rankOptions,
    votes,
    participants.map((p) => ({ id: p.id, status: p.status, isRequired: p.isRequired, invited: p.source === "invite" })),
    busyIds,
    at,
  );
  const optionId = candidates[0];
  if (!optionId) return { booked: false };
  const inviteesList = participants.filter((p) => isRespondent(p) && p.email).map((p) => ({ participantId: p.id, name: p.name, email: p.email! }));
  if (!inviteesList.length) return { booked: false };
  try {
    const result = await bookPollAs(viewer, poll, BookPollSchema.parse({ pollId: poll.id, optionId, invitees: inviteesList }), { actorCtx: null, auto: true });
    return { booked: true, scheduledEventId: result.scheduledEventId };
  } catch (e) {
    log.info("polls.auto_book_skipped", { pollId, error: e });
    return { booked: false };
  }
}
