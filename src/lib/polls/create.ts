// Creating and duplicating polls (SPEC MP-02, MP-03, MP-04, MP-32; decision C2: every poll owns an adhoc event type
// with booking_method = 'poll', secret, never on profile pages, hosts = owner plus co-hosts as event_type_hosts with
// pool null, pooling_type collective when co-hosts exist). Defaults follow Calendly (MP-04): results visibility
// host_only, If need be off, invitees not hidden, email required, comments off, notify instant, smart reminders.
// Server only.
import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { isUniqueViolation } from "@/db/helpers";
import { eventTypeHosts, eventTypes, meetingPollOptions, meetingPolls, pollSlugRedirects } from "@/db/schema";
import type { LocationConfig } from "@/db/types";
import { assertLocationConnectionsOwnedBy, assertSameOrgUsers, type ActorCtx } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { publishEvent } from "@/lib/events";
import { richTextToPlain, sanitizeRichText } from "@/lib/html";
import { newId, pollSlug } from "@/lib/ids";
import { runJobsAfterResponse } from "@/lib/jobs";
import { now as clockNow } from "@/lib/time/now";
import { pollUrl } from "@/lib/url";
import { requirePollAccess } from "./access";
import { recordActivity } from "./activity";
import { MAX_DESCRIPTION_LENGTH, MAX_POLL_COHOSTS, MAX_TITLE_LENGTH, POLL_COLOR, POLL_ERRORS, pollJobGroup } from "./constants";
import { dayStart } from "./grid";
import { loadOptions, loadPollHosts, startOf, type OptionRow, type PollRow } from "./load";
import { enqueueHoldsSync, scheduleTimedJobs } from "./schedule";
import { CreatePollSchema, deadlineProblem, normalizeOptions, type CreatePollInput, type NormalizedOption } from "./validation";

const MAX_EVENT_TYPE_MINUTES = 720;

/** Sanitized description HTML (null when empty), at most 8,000 characters of text. */
export function cleanDescription(html: string | null | undefined): { html: string | null; plain: string | null } {
  const clean = sanitizeRichText(html ?? "");
  const plain = richTextToPlain(clean);
  if (plain.length > MAX_DESCRIPTION_LENGTH) {
    throw new AppError("validation", `Use ${MAX_DESCRIPTION_LENGTH} characters or fewer.`, { fieldErrors: { descriptionHtml: [`Use ${MAX_DESCRIPTION_LENGTH} characters or fewer.`] } });
  }
  return { html: plain.trim() ? clean : null, plain: plain.trim() ? plain : null };
}

/** True when no live poll and no live redirect uses the slug (MP-05 live uniqueness). */
export async function isPollSlugAvailable(db: DbOrTx, slug: string, exceptPollId?: string): Promise<boolean> {
  const s = slug.trim().toLowerCase();
  const [poll] = await db.select({ id: meetingPolls.id }).from(meetingPolls).where(eq(meetingPolls.slug, s)).limit(1);
  if (poll && poll.id !== exceptPollId) return false;
  const [redirect] = await db
    .select({ pollId: pollSlugRedirects.pollId })
    .from(pollSlugRedirects)
    .where(and(eq(pollSlugRedirects.oldSlug, s), gt(pollSlugRedirects.expiresAt, clockNow())))
    .limit(1);
  return !redirect || redirect.pollId === exceptPollId;
}

/** Co-host ids: unique, without the owner, at most 10. */
export function cleanCohostIds(ids: readonly string[] | undefined, ownerUserId: string): string[] {
  const out = [...new Set((ids ?? []).filter((id) => id !== ownerUserId))];
  if (out.length > MAX_POLL_COHOSTS) throw new AppError("validation", POLL_ERRORS.tooManyCohosts, { fieldErrors: { coHostIds: [POLL_ERRORS.tooManyCohosts] } });
  return out;
}

/** Event type columns shared by create, update and duplicate (C2). */
export function eventTypeFields(p: {
  title: string;
  description: { html: string | null; plain: string | null };
  location: LocationConfig | null;
  locale: string;
  defaultDurationMinutes: number;
  cohosts: number;
}) {
  return {
    name: p.title,
    descriptionHtml: p.description.html,
    descriptionPlain: p.description.plain,
    locations: p.location ? [{ ...p.location, position: 0 }] : [],
    locale: p.locale,
    durationMinutes: Math.max(1, Math.min(MAX_EVENT_TYPE_MINUTES, p.defaultDurationMinutes)),
    scope: p.cohosts > 0 ? ("shared" as const) : ("personal" as const),
    poolingType: p.cohosts > 0 ? ("collective" as const) : null,
  };
}

/** Option rows to insert. */
export function optionValues(pollId: string, options: readonly NormalizedOption[], firstPosition: number, at: Date) {
  return options.map((o, i) => ({
    id: newId(),
    pollId,
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    allDayDate: o.allDayDate,
    durationMinutes: o.durationMinutes,
    position: firstPosition + i,
    createdAt: at,
  }));
}

export type CreatedPoll = { pollId: string; slug: string; link: string; eventTypeId: string };

type CreateValues = Omit<typeof meetingPolls.$inferInsert, "id" | "eventTypeId" | "slug">;

async function insertPoll(
  db: DbOrTx,
  actor: ActorCtx,
  p: { values: CreateValues; slug: string | null; options: NormalizedOption[]; cohostIds: string[]; location: LocationConfig | null; description: { html: string | null; plain: string | null } },
  at: Date,
): Promise<CreatedPoll> {
  for (let attempt = 0; ; attempt++) {
    const slug = p.slug ?? pollSlug();
    try {
      const out = await db.transaction(async (tx) => {
        await assertSameOrgUsers(tx, actor.orgId, [actor.user.id, ...p.cohostIds]);
        await assertLocationConnectionsOwnedBy(tx, [p.location], [actor.user.id, ...p.cohostIds]);
        if (!(await isPollSlugAvailable(tx, slug))) throw new AppError("conflict", POLL_ERRORS.slugTaken, { fieldErrors: { slug: [POLL_ERRORS.slugTaken] } });
        const eventTypeId = newId();
        await tx.insert(eventTypes).values({
          id: eventTypeId,
          organizationId: actor.orgId,
          ownerUserId: actor.user.id,
          type: "adhoc",
          bookingMethod: "poll",
          kind: "solo",
          slug: `poll-${slug}`,
          color: POLL_COLOR,
          secret: true,
          active: true,
          minimumNoticeMinutes: 0,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          dateRangeType: "unlimited",
          allowGuests: false,
          notificationType: "email_confirmation",
          organizerUserId: actor.user.id,
          createdByUserId: actor.user.id,
          ...eventTypeFields({
            title: p.values.title,
            description: p.description,
            location: p.location,
            locale: p.values.locale ?? "en",
            defaultDurationMinutes: p.values.defaultDurationMinutes,
            cohosts: p.cohostIds.length,
          }),
          createdAt: at,
          updatedAt: at,
        });
        await tx.insert(eventTypeHosts).values([actor.user.id, ...p.cohostIds].map((userId, i) => ({ eventTypeId, userId, poolId: null, position: i })));
        const pollId = newId();
        await tx.insert(meetingPolls).values({ ...p.values, id: pollId, eventTypeId, slug, createdAt: at, updatedAt: at });
        const rows = optionValues(pollId, p.options, 0, at);
        if (rows.length) await tx.insert(meetingPollOptions).values(rows);
        await recordActivity(tx, { pollId, type: "created", actorUserId: actor.user.id, data: { options: rows.length }, at });
        await publishEvent(tx, "poll.created", { pollId }, { organizationId: actor.orgId, actor: { type: "user", userId: actor.user.id } });
        const poll = { id: pollId, status: p.values.status ?? "open", deadlineAt: p.values.deadlineAt ?? null, timezone: p.values.timezone, reminderMode: p.values.reminderMode ?? "smart", reminderOffsets: p.values.reminderOffsets ?? null, firstInviteSentAt: null } as const;
        await scheduleTimedJobs(tx, poll, rows.map((r) => ({ ...r, deletedAt: null, suggestedByParticipantId: null })) as OptionRow[], at);
        if (p.values.reserveTimes) await enqueueHoldsSync(tx, pollId, at);
        return { pollId, slug, link: pollUrl(slug), eventTypeId };
      });
      runJobsAfterResponse({ groupKeys: [pollJobGroup(out.pollId)] });
      return out;
    } catch (e) {
      // A random slug collided (astronomically rare): try another one.
      if (!p.slug && attempt < 3 && isUniqueViolation(e, "polls_slug_uq")) continue;
      if (isUniqueViolation(e, "polls_slug_uq")) throw new AppError("conflict", POLL_ERRORS.slugTaken, { fieldErrors: { slug: [POLL_ERRORS.slugTaken] } });
      throw e;
    }
  }
}

/** "Share meeting poll" (MP-03 acceptance: the poll (open), its adhoc event type and its options). */
export async function createPoll(actor: ActorCtx, raw: CreatePollInput, db?: DbOrTx): Promise<CreatedPoll> {
  const input = CreatePollSchema.parse(raw);
  const d = db ?? (await getDb());
  const at = clockNow();
  const zone = input.timezone;
  const checked = normalizeOptions(input.options, { now: at, dayStart: (date) => new Date(dayStart(date, zone)) });
  if (!checked.ok) throw new AppError("validation", checked.error, { fieldErrors: { [`options.${checked.index}`]: [checked.error], options: [checked.error] } });
  const options = checked.options;
  const lastStart = options.reduce((m, o) => Math.max(m, o.startsAt?.getTime() ?? dayStart(o.allDayDate!, zone)), 0);
  const deadlineAt = input.deadline ? new Date(input.deadline) : null;
  const deadlineError = deadlineProblem(deadlineAt, { now: at, lastOptionStart: new Date(lastStart) });
  if (deadlineError) throw new AppError("validation", deadlineError, { fieldErrors: { deadline: [deadlineError] } });
  if (input.maxChoicesPerParticipant && input.maxChoicesPerParticipant > options.length) {
    const msg = `Use ${options.length} or fewer.`;
    throw new AppError("validation", msg, { fieldErrors: { maxChoicesPerParticipant: [msg] } });
  }
  const description = cleanDescription(input.descriptionHtml);
  const cohostIds = cleanCohostIds(input.coHostIds, actor.user.id);
  const verifyEmail = input.verifyEmail ?? false;
  const values: CreateValues = {
    organizationId: actor.orgId,
    ownerUserId: actor.user.id,
    title: input.title,
    descriptionHtml: description.html,
    defaultDurationMinutes: input.defaultDurationMinutes,
    location: input.location ?? null,
    locale: input.locale?.trim() || actor.user.locale || "en",
    timezone: zone,
    timeZoneMode: input.timeZoneMode ?? "auto",
    status: "open",
    resultsVisibility: input.resultsVisibility ?? "host_only",
    allowIfNeedBe: input.allowIfNeedBe ?? false,
    hideInvitees: input.hideInvitees ?? false,
    requireEmail: verifyEmail ? true : (input.requireEmail ?? true),
    verifyEmail,
    allowComments: input.allowComments ?? false,
    allowSuggestions: false,
    maxVotesPerOption: input.maxVotesPerOption ?? null,
    maxChoicesPerParticipant: input.maxChoicesPerParticipant ?? null,
    deadlineAt,
    reserveTimes: input.reserveTimes ?? false,
    notifyMode: input.notifyMode ?? "instant",
    reminderMode: input.reminderMode ?? "smart",
    reminderOffsets: input.reminderOffsets ?? null,
    autoBook: input.autoBook ?? false,
    countHostPreference: input.countHostPreference ?? false,
    sendMeetingReminders: input.sendMeetingReminders ?? false,
  };
  return insertPoll(d, actor, { values, slug: input.slug ?? null, options, cohostIds, location: values.location ?? null, description }, at);
}

/**
 * Duplicate (MP-32): settings and future options (title + " (copy)"), not participants, votes, comments or the
 * booking. A poll whose times all passed copies without options ("Duplicate with new times": the host adds times).
 */
export async function duplicatePoll(actor: ActorCtx, pollId: string, db?: DbOrTx): Promise<CreatedPoll> {
  const d = db ?? (await getDb());
  const { poll } = await requirePollAccess(actor, pollId, d);
  const at = clockNow();
  const options = (await loadOptions(d, poll.id)).filter((o) => startOf(o, poll.timezone) > at.getTime());
  const hosts = await loadPollHosts(d, poll);
  const cohostIds = hosts.map((h) => h.userId).filter((id) => id !== actor.user.id);
  const lastStart = options.reduce((m, o) => Math.max(m, startOf(o, poll.timezone)), 0);
  const keepDeadline = poll.deadlineAt && poll.deadlineAt.getTime() > at.getTime() && poll.deadlineAt.getTime() <= lastStart ? poll.deadlineAt : null;
  const suffix = " (copy)";
  const title = `${poll.title.slice(0, MAX_TITLE_LENGTH - suffix.length)}${suffix}`;
  const values: CreateValues = {
    ...copySettings(poll),
    organizationId: actor.orgId,
    ownerUserId: actor.user.id,
    title,
    status: "open",
    deadlineAt: keepDeadline,
  };
  if (values.maxChoicesPerParticipant && values.maxChoicesPerParticipant > options.length) values.maxChoicesPerParticipant = null;
  const normalized: NormalizedOption[] = options.map((o) => ({
    startsAt: o.startsAt,
    endsAt: o.endsAt,
    allDayDate: o.allDayDate,
    durationMinutes: o.durationMinutes,
    key: o.id,
  }));
  return insertPoll(
    d,
    actor,
    { values, slug: null, options: normalized, cohostIds: cleanCohostIds(cohostIds, actor.user.id), location: poll.location, description: cleanDescription(poll.descriptionHtml) },
    at,
  );
}

function copySettings(poll: PollRow): Omit<CreateValues, "organizationId" | "ownerUserId" | "title" | "status" | "deadlineAt"> {
  return {
    descriptionHtml: poll.descriptionHtml,
    defaultDurationMinutes: poll.defaultDurationMinutes,
    location: poll.location,
    locale: poll.locale,
    timezone: poll.timezone,
    timeZoneMode: poll.timeZoneMode,
    resultsVisibility: poll.resultsVisibility,
    allowIfNeedBe: poll.allowIfNeedBe,
    hideInvitees: poll.hideInvitees,
    requireEmail: poll.requireEmail,
    verifyEmail: poll.verifyEmail,
    allowComments: poll.allowComments,
    allowSuggestions: false,
    maxVotesPerOption: poll.maxVotesPerOption,
    maxChoicesPerParticipant: poll.maxChoicesPerParticipant,
    reserveTimes: poll.reserveTimes,
    notifyMode: poll.notifyMode,
    reminderMode: poll.reminderMode,
    reminderOffsets: poll.reminderOffsets,
    autoBook: poll.autoBook,
    countHostPreference: poll.countHostPreference,
    sendMeetingReminders: poll.sendMeetingReminders,
  };
}
