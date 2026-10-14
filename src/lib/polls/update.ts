// Editing after publishing (SPEC MP-27; research meeting-polls.md B14). Server only.
//
// Always editable while open or closed: title, description, location, language, results visibility (to a more public
// mode only with the confirm flag: "Voters chose their answers expecting their names to be hidden"), comments, notify,
// reminders, deadline (a past deadline closes voting), hosts (holds updated), the If need be and limits settings within
// their rules, Reserve times. Booked polls: title, description, language, visibility, comments, notify and display
// settings; title and description changes reach the scheduled meeting. Options: add (cap 100, existing respondents see
// "?", optional email to them), remove (votes on them deleted; a confirm flag when they have Yes or If need be votes),
// started options frozen. Link ending edits keep the old link redirecting for 90 days.
import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { isUniqueViolation } from "@/db/helpers";
import { eventTypeHosts, eventTypes, meetingPollOptions, meetingPollParticipants, meetingPolls, meetingPollVotes, pollSlugRedirects, scheduledEvents } from "@/db/schema";
import { assertLocationConnectionsOwnedBy, assertSameOrgUsers, type ActorCtx } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { publishEvent } from "@/lib/events";
import { runJobsAfterResponse } from "@/lib/jobs";
import { now as clockNow } from "@/lib/time/now";
import { canRemoveCohosts, requirePollAccess } from "./access";
import { recordActivity } from "./activity";
import { MAX_POLL_OPTIONS, POLL_ERRORS, SLUG_REDIRECT_DAYS, pollJobGroup } from "./constants";
import { cleanCohostIds, cleanDescription, eventTypeFields, isPollSlugAvailable, optionValues } from "./create";
import { dayStart } from "./grid";
import { lastOptionStart, loadOptions, loadPollHosts, lockPoll, startOf, statusOf, type OptionRow, type PollRow } from "./load";
import { enqueueHoldsSync, enqueuePollEmail, scheduleAnchorReminders, scheduleTimedJobs } from "./schedule";
import { AddOptionsSchema, MORE_PUBLIC_WARNING, RemoveOptionsSchema, UpdatePollSchema, deadlineProblem, isMorePublic, maxVotesProblem, normalizeOptions } from "./validation";

const DAY = 86_400_000;

/** Fields a booked poll may still change (the rest needs "Reopen poll"). */
const BOOKED_EDITABLE = new Set(["title", "descriptionHtml", "locale", "resultsVisibility", "allowComments", "notifyMode", "timeZoneMode", "timezone", "slug", "countHostPreference", "hostPreferences"]);

async function highestAttendingCount(tx: DbOrTx, pollId: string): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(meetingPollVotes)
    .innerJoin(meetingPollOptions, eq(meetingPollOptions.id, meetingPollVotes.optionId))
    .innerJoin(meetingPollParticipants, eq(meetingPollParticipants.id, meetingPollVotes.participantId))
    .where(and(eq(meetingPollVotes.pollId, pollId), inArray(meetingPollVotes.choice, ["yes", "if_need_be"]), isNull(meetingPollOptions.deletedAt), isNull(meetingPollParticipants.deletedAt)))
    .groupBy(meetingPollVotes.optionId);
  return rows.reduce((m, r) => Math.max(m, Number(r.n)), 0);
}

async function ifNeedBeInUse(tx: DbOrTx, pollId: string): Promise<boolean> {
  const [row] = await tx
    .select({ optionId: meetingPollVotes.optionId })
    .from(meetingPollVotes)
    .innerJoin(meetingPollParticipants, eq(meetingPollParticipants.id, meetingPollVotes.participantId))
    .where(and(eq(meetingPollVotes.pollId, pollId), eq(meetingPollVotes.choice, "if_need_be"), isNull(meetingPollParticipants.deletedAt)))
    .limit(1);
  return Boolean(row);
}

const field = (name: string, message: string) => new AppError("validation", message, { fieldErrors: { [name]: [message] } });

export type UpdatePollResult = { pollId: string; slug: string; fields: string[] };

/** Settings edits (see the file header). Only the given fields change. */
export async function updatePoll(actor: ActorCtx, raw: unknown): Promise<UpdatePollResult> {
  const input = UpdatePollSchema.parse(raw);
  const db = await getDb();
  const access = await requirePollAccess(actor, input.pollId, db);
  const at = clockNow();
  try {
    const out = await db.transaction(async (tx) => {
      const poll = await lockPoll(tx, input.pollId, "update");
      if (poll.deletedAt) throw new AppError("not_found", POLL_ERRORS.notFound);
      const options = await loadOptions(tx, poll.id);
      const status = statusOf(poll, options, at);
      const given = Object.entries(input).filter(([k, v]) => v !== undefined && k !== "pollId" && k !== "confirmPublic").map(([k]) => k);
      if (status === "booked") {
        const blocked = given.find((k) => !BOOKED_EDITABLE.has(k));
        if (blocked) throw field(blocked, blocked === "location" ? POLL_ERRORS.bookedLocationLocked : "Reopen the poll to change this setting.");
      }
      const patch: Partial<typeof meetingPolls.$inferInsert> = {};
      const changed: string[] = [];
      const same = (a: unknown, b: unknown) =>
        a instanceof Date || b instanceof Date
          ? (a instanceof Date ? a.getTime() : null) === (b instanceof Date ? b.getTime() : null)
          : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
      const set = <K extends keyof typeof meetingPolls.$inferInsert>(k: K, v: (typeof meetingPolls.$inferInsert)[K]) => {
        if (!same((poll as Record<string, unknown>)[k], v)) {
          patch[k] = v;
          changed.push(k);
        }
      };
      if (input.title !== undefined) set("title", input.title);
      let description: { html: string | null; plain: string | null } | null = null;
      if (input.descriptionHtml !== undefined) {
        description = cleanDescription(input.descriptionHtml);
        set("descriptionHtml", description.html);
      }
      if (input.location !== undefined) set("location", input.location ?? null);
      if (input.locale !== undefined) set("locale", input.locale || "en");
      if (input.timezone !== undefined) set("timezone", input.timezone);
      if (input.timeZoneMode !== undefined) set("timeZoneMode", input.timeZoneMode);
      if (input.defaultDurationMinutes !== undefined) set("defaultDurationMinutes", input.defaultDurationMinutes);
      if (input.resultsVisibility !== undefined) {
        if (isMorePublic(poll.resultsVisibility, input.resultsVisibility) && !input.confirmPublic && (await hasRespondents(tx, poll.id))) {
          throw new AppError("validation", MORE_PUBLIC_WARNING, { fieldErrors: { resultsVisibility: [MORE_PUBLIC_WARNING] }, details: { requiresConfirm: true } });
        }
        set("resultsVisibility", input.resultsVisibility);
      }
      if (input.allowIfNeedBe !== undefined) {
        if (!input.allowIfNeedBe && poll.allowIfNeedBe && (await ifNeedBeInUse(tx, poll.id))) throw field("allowIfNeedBe", POLL_ERRORS.ifNeedBeInUse);
        set("allowIfNeedBe", input.allowIfNeedBe);
      }
      if (input.hideInvitees !== undefined) set("hideInvitees", input.hideInvitees);
      if (input.verifyEmail !== undefined) {
        set("verifyEmail", input.verifyEmail);
        if (input.verifyEmail) set("requireEmail", true);
      }
      if (input.requireEmail !== undefined) {
        set("requireEmail", input.requireEmail || Boolean(input.verifyEmail ?? poll.verifyEmail));
        if (!input.requireEmail && !(input.verifyEmail ?? false)) set("verifyEmail", false);
      }
      if (input.allowComments !== undefined) set("allowComments", input.allowComments);
      if (input.maxVotesPerOption !== undefined) {
        const problem = maxVotesProblem(input.maxVotesPerOption, await highestAttendingCount(tx, poll.id));
        if (problem) throw field("maxVotesPerOption", problem);
        set("maxVotesPerOption", input.maxVotesPerOption);
      }
      if (input.maxChoicesPerParticipant !== undefined) {
        if (input.maxChoicesPerParticipant && input.maxChoicesPerParticipant > options.length) throw field("maxChoicesPerParticipant", `Use ${options.length} or fewer.`);
        set("maxChoicesPerParticipant", input.maxChoicesPerParticipant);
      }
      let closeNow = false;
      if (input.deadline !== undefined) {
        const d = input.deadline ? new Date(input.deadline) : null;
        const problem = deadlineProblem(d, { now: at, lastOptionStart: lastOptionStart(options, poll.timezone), allowPast: true });
        if (problem) throw field("deadline", problem);
        set("deadlineAt", d);
        // A deadline in the past closes voting (B14).
        if (d && d.getTime() <= at.getTime() && poll.status === "open") closeNow = true;
      }
      if (input.reserveTimes !== undefined) set("reserveTimes", input.reserveTimes);
      if (input.notifyMode !== undefined) set("notifyMode", input.notifyMode);
      if (input.reminderMode !== undefined) set("reminderMode", input.reminderMode);
      if (input.reminderOffsets !== undefined) set("reminderOffsets", input.reminderOffsets);
      if (input.autoBook !== undefined) set("autoBook", input.autoBook);
      if (input.countHostPreference !== undefined) set("countHostPreference", input.countHostPreference);
      if (input.sendMeetingReminders !== undefined) set("sendMeetingReminders", input.sendMeetingReminders);
      if (input.hostPreferences !== undefined) {
        const live = new Set(options.map((o) => o.id));
        const prefs = input.hostPreferences ? Object.fromEntries(Object.entries(input.hostPreferences).filter(([id]) => live.has(id))) : null;
        patch.hostPreferences = prefs;
        changed.push("hostPreferences");
      }
      if (input.slug !== undefined && input.slug !== poll.slug) {
        if (!(await isPollSlugAvailable(tx, input.slug, poll.id))) throw field("slug", POLL_ERRORS.slugTaken);
        await tx.delete(pollSlugRedirects).where(eq(pollSlugRedirects.oldSlug, input.slug));
        await tx
          .insert(pollSlugRedirects)
          .values({ oldSlug: poll.slug, pollId: poll.id, expiresAt: new Date(at.getTime() + SLUG_REDIRECT_DAYS * DAY) })
          .onConflictDoUpdate({ target: pollSlugRedirects.oldSlug, set: { pollId: poll.id, expiresAt: new Date(at.getTime() + SLUG_REDIRECT_DAYS * DAY) } });
        patch.slug = input.slug;
        changed.push("slug");
      }

      // Hosts (co-hosts list replaces the current one).
      let hostsChanged = false;
      if (input.coHostIds !== undefined) {
        const hosts = await loadPollHosts(tx, poll);
        const current = hosts.filter((h) => h.role === "cohost").map((h) => h.userId);
        const next = cleanCohostIds(input.coHostIds, poll.ownerUserId);
        const removed = current.filter((id) => !next.includes(id));
        const added = next.filter((id) => !current.includes(id));
        if (removed.length && !canRemoveCohosts(actor, access.access)) throw new AppError("forbidden", POLL_ERRORS.cohostRemoveOwnerOnly);
        if (added.length) await assertSameOrgUsers(tx, poll.organizationId, added);
        if (removed.length) await tx.delete(eventTypeHosts).where(and(eq(eventTypeHosts.eventTypeId, poll.eventTypeId), inArray(eventTypeHosts.userId, removed)));
        if (added.length) {
          await tx.insert(eventTypeHosts).values(added.map((userId, i) => ({ eventTypeId: poll.eventTypeId, userId, poolId: null, position: current.length + i + 1 })));
        }
        if (removed.length || added.length) {
          hostsChanged = true;
          changed.push("coHostIds");
        }
      }
      const location = input.location !== undefined ? (input.location ?? null) : poll.location;
      if (input.location !== undefined || hostsChanged) {
        const hosts = await loadPollHosts(tx, poll);
        await assertLocationConnectionsOwnedBy(tx, [location], hosts.map((h) => h.userId));
      }

      if (closeNow) {
        patch.status = "closed";
        patch.votingClosedAt = at;
      }
      if (Object.keys(patch).length) {
        await tx.update(meetingPolls).set({ ...patch, updatedAt: at }).where(eq(meetingPolls.id, poll.id));
      }
      const next: PollRow = { ...poll, ...(patch as Partial<PollRow>) };
      // The adhoc event type mirrors the shared fields (C2).
      const cohosts = (await loadPollHosts(tx, poll)).filter((h) => h.role === "cohost").length;
      await tx
        .update(eventTypes)
        .set({
          ...eventTypeFields({
            title: next.title,
            description: description ?? cleanDescription(next.descriptionHtml),
            location: next.location,
            locale: next.locale,
            defaultDurationMinutes: next.defaultDurationMinutes,
            cohosts,
          }),
          ...(patch.slug ? { slug: `poll-${patch.slug}` } : {}),
          updatedAt: at,
        })
        .where(eq(eventTypes.id, poll.eventTypeId));

      // A booked meeting follows title changes (the provider event is rewritten).
      if (status === "booked" && patch.title && poll.bookedScheduledEventId) {
        const rows = await tx
          .update(scheduledEvents)
          .set({ name: patch.title, updatedAt: at })
          .where(and(eq(scheduledEvents.id, poll.bookedScheduledEventId), eq(scheduledEvents.status, "active")))
          .returning({ id: scheduledEvents.id });
        if (rows.length) await publishEvent(tx, "meeting.updated", { scheduledEventId: rows[0]!.id, fields: ["location"] }, { organizationId: poll.organizationId, actor: { type: "user", userId: actor.user.id } });
      }

      const fields = [...new Set(changed)];
      if (fields.length) await recordActivity(tx, { pollId: poll.id, type: "edited", actorUserId: actor.user.id, data: { fields }, at });
      if (closeNow) await recordActivity(tx, { pollId: poll.id, type: "voting_closed", actorUserId: actor.user.id, data: { reason: "host" }, at });
      const timing = ["deadlineAt", "reminderMode", "reminderOffsets", "status"].some((k) => k in patch) || closeNow;
      if (timing) {
        await scheduleTimedJobs(tx, next, options, at);
        await scheduleAnchorReminders(tx, next, options, at);
      }
      if (next.reserveTimes && (hostsChanged || "title" in patch || "reserveTimes" in patch) || (!next.reserveTimes && "reserveTimes" in patch)) {
        await enqueueHoldsSync(tx, poll.id, at);
      }
      return { pollId: poll.id, slug: next.slug, fields };
    });
    runJobsAfterResponse({ groupKeys: [pollJobGroup(input.pollId)] });
    return out;
  } catch (e) {
    if (isUniqueViolation(e, "polls_slug_uq")) throw field("slug", POLL_ERRORS.slugTaken);
    throw e;
  }
}

async function hasRespondents(tx: DbOrTx, pollId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: meetingPollParticipants.id })
    .from(meetingPollParticipants)
    .where(and(eq(meetingPollParticipants.pollId, pollId), isNull(meetingPollParticipants.deletedAt), inArray(meetingPollParticipants.status, ["responded", "declined"])))
    .limit(1);
  return Boolean(row);
}

/** Options can change while open, closed or expired (adding future options to an expired poll reopens it). */
function assertOptionsEditable(poll: PollRow, options: readonly OptionRow[], at: Date): ReturnType<typeof statusOf> {
  if (poll.deletedAt || poll.status === "canceled") throw new AppError("not_found", POLL_ERRORS.notFound);
  const status = statusOf(poll, options, at);
  if (status === "booked") throw new AppError("conflict", POLL_ERRORS.optionsLocked);
  return status;
}

export type AddOptionsResult = { added: number; optionIds: string[]; notified: number };

/** "Add times" after publishing (MP-27). */
export async function addOptions(actor: ActorCtx, raw: unknown): Promise<AddOptionsResult> {
  const input = AddOptionsSchema.parse(raw);
  const db = await getDb();
  await requirePollAccess(actor, input.pollId, db);
  const at = clockNow();
  const out = await db.transaction(async (tx) => {
    const poll = await lockPoll(tx, input.pollId, "update");
    const options = await loadOptions(tx, poll.id);
    const status = assertOptionsEditable(poll, options, at);
    const checked = normalizeOptions(input.options, { now: at, dayStart: (d) => new Date(dayStart(d, poll.timezone)) });
    if (!checked.ok) throw new AppError("validation", checked.error, { fieldErrors: { [`options.${checked.index}`]: [checked.error], options: [checked.error] } });
    const keyOf = (o: OptionRow) => (o.allDayDate ? `d:${o.allDayDate}` : `t:${o.startsAt!.getTime()}:${o.endsAt!.getTime()}`);
    const existing = new Set(options.map(keyOf));
    const fresh = checked.options.filter((o) => !existing.has(o.key));
    if (!fresh.length) return { added: 0, optionIds: [], notified: 0 };
    if (options.length + fresh.length > MAX_POLL_OPTIONS) throw new AppError("validation", POLL_ERRORS.tooManyOptions, { fieldErrors: { options: [POLL_ERRORS.tooManyOptions] } });
    const maxPosition = options.reduce((m, o) => Math.max(m, o.position), -1);
    const rows = optionValues(poll.id, fresh, maxPosition + 1, at);
    await tx.insert(meetingPollOptions).values(rows);
    const all = [...options, ...rows.map((r) => ({ ...r, deletedAt: null, suggestedByParticipantId: null }) as OptionRow)];
    let next: PollRow = poll;
    if (status === "expired" && poll.status === "expired") {
      // expired -> open once future options exist (MP-22).
      await tx.update(meetingPolls).set({ status: "open", votingClosedAt: null, updatedAt: at }).where(eq(meetingPolls.id, poll.id));
      next = { ...poll, status: "open", votingClosedAt: null };
    }
    await recordActivity(tx, { pollId: poll.id, type: "options_added", actorUserId: actor.user.id, data: { count: rows.length, optionIds: rows.map((r) => r.id) }, at });
    await scheduleTimedJobs(tx, next, all, at);
    await scheduleAnchorReminders(tx, next, all, at);
    if (poll.reserveTimes) await enqueueHoldsSync(tx, poll.id, at);
    let notified = 0;
    if (input.notifyParticipants) {
      const respondents = await tx
        .select({ id: meetingPollParticipants.id, email: meetingPollParticipants.email, unsubscribedAt: meetingPollParticipants.unsubscribedAt })
        .from(meetingPollParticipants)
        .where(and(eq(meetingPollParticipants.pollId, poll.id), isNull(meetingPollParticipants.deletedAt), inArray(meetingPollParticipants.status, ["responded", "declined"])));
      for (const r of respondents) {
        if (!r.email || r.unsubscribedAt) continue;
        await enqueuePollEmail(tx, { template: "poll_updated", pollId: poll.id, participantId: r.id, userId: actor.user.id, data: { optionIds: rows.map((x) => x.id) } }, `${poll.id}:updated:${r.id}:${at.getTime()}`, at);
        notified++;
      }
    }
    return { added: rows.length, optionIds: rows.map((r) => r.id), notified };
  });
  runJobsAfterResponse({ groupKeys: [pollJobGroup(input.pollId)] });
  return out;
}

export type RemoveOptionsResult = { removed: number; votesRemoved: number };

/**
 * Removes options (MP-27). Started options are frozen; options with Yes or If need be votes need `confirm` (the
 * error lists the affected voters in details.voters); the last live option can't be removed.
 */
export async function removeOptions(actor: ActorCtx, raw: unknown): Promise<RemoveOptionsResult> {
  const input = RemoveOptionsSchema.parse(raw);
  const db = await getDb();
  await requirePollAccess(actor, input.pollId, db);
  const at = clockNow();
  const out = await db.transaction(async (tx) => {
    const poll = await lockPoll(tx, input.pollId, "update");
    const options = await loadOptions(tx, poll.id);
    assertOptionsEditable(poll, options, at);
    const ids = [...new Set(input.optionIds)];
    const targets = options.filter((o) => ids.includes(o.id));
    if (targets.length !== ids.length) throw new AppError("not_found", POLL_ERRORS.optionNotFound);
    if (targets.some((o) => startOf(o, poll.timezone) <= at.getTime())) throw new AppError("validation", POLL_ERRORS.pastOptionFrozen);
    if (options.length - targets.length < 1) throw new AppError("validation", POLL_ERRORS.lastOption);
    const voters = await tx
      .select({ name: meetingPollParticipants.name, optionId: meetingPollVotes.optionId })
      .from(meetingPollVotes)
      .innerJoin(meetingPollParticipants, eq(meetingPollParticipants.id, meetingPollVotes.participantId))
      .where(and(inArray(meetingPollVotes.optionId, ids), inArray(meetingPollVotes.choice, ["yes", "if_need_be"]), isNull(meetingPollParticipants.deletedAt)));
    if (voters.length && !input.confirm) {
      throw new AppError("conflict", POLL_ERRORS.confirmRemove, { details: { requiresConfirm: true, voters: [...new Set(voters.map((v) => v.name))] } });
    }
    const deleted = await tx.delete(meetingPollVotes).where(inArray(meetingPollVotes.optionId, ids)).returning({ participantId: meetingPollVotes.participantId });
    await tx.update(meetingPollOptions).set({ deletedAt: at }).where(inArray(meetingPollOptions.id, ids));
    const rest = options.filter((o) => !ids.includes(o.id));
    const prefs = poll.hostPreferences ? Object.fromEntries(Object.entries(poll.hostPreferences).filter(([id]) => !ids.includes(id))) : null;
    const maxChoices = poll.maxChoicesPerParticipant && poll.maxChoicesPerParticipant > rest.length ? rest.length : poll.maxChoicesPerParticipant;
    await tx.update(meetingPolls).set({ hostPreferences: prefs, maxChoicesPerParticipant: maxChoices, updatedAt: at }).where(eq(meetingPolls.id, poll.id));
    await recordActivity(tx, { pollId: poll.id, type: "options_removed", actorUserId: actor.user.id, data: { count: ids.length, optionIds: ids, votesRemoved: deleted.length }, at });
    await scheduleTimedJobs(tx, poll, rest, at);
    await scheduleAnchorReminders(tx, poll, rest, at);
    if (poll.reserveTimes) await enqueueHoldsSync(tx, poll.id, at);
    return { removed: ids.length, votesRemoved: deleted.length };
  });
  runJobsAfterResponse({ groupKeys: [pollJobGroup(input.pollId)] });
  return out;
}

/** Live link ending check for the share screen (MP-05). */
export async function checkSlugAvailable(actor: ActorCtx, slug: string, pollId?: string): Promise<boolean> {
  void actor;
  const db = await getDb();
  return isPollSlugAvailable(db, slug, pollId);
}
