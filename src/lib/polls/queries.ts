// Read models of meeting polls (SPEC MP-07 to MP-17, MP-26, MP-32, MP-33): the voter page (redacted per results
// visibility, MP-12), the host results view, the Meeting polls list, live activity, CSV export, and the read-only
// queries for a Calendly-compatible API (event types with booking_method "poll"). Server only.
import "server-only";
import { and, desc, eq, gt, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import {
  eventTypeHosts,
  eventTypes,
  invitees,
  meetingPollActivity,
  meetingPollComments,
  meetingPollOptions,
  meetingPollParticipants,
  meetingPolls,
  meetingPollVotes,
  scheduledEvents,
  users,
} from "@/db/schema";
import { oauthStartPath } from "@/lib/auth/oauth/links";
import { isOrgAdmin, type ActorCtx } from "@/lib/authz";
import { conferenceJoinUrl, isConferenceKind } from "@/lib/conferencing/kinds";
import { getFeatures } from "@/lib/env";
import { sanitizeRichText } from "@/lib/html";
import { decodeCursor, encodeCursor } from "@/lib/pagination";
import { now as clockNow } from "@/lib/time/now";
import { absoluteUrl, appUrl, joinUrl, pollUrl } from "@/lib/url";
import { normalizeEmail } from "@/lib/validation";
import { addToCalendarLinks } from "@/lib/email/calendar-links";
import { buildIcs, icsUid } from "@/lib/email/ical";
import { requirePollAccess } from "./access";
import { activityDataView } from "./activity";
import { DEADLINE_SOON_MS, POLL_COLOR } from "./constants";
import { hostBusyForPoll, optionStatuses } from "./conflicts";
import { buildPollCsv, csvFileName } from "./csv";
import { commonDuration, optionLongLabel } from "./display";
import { holdsSummary } from "./holds";
import {
  hostIdsByEventType,
  hostViews,
  isOverLimit,
  loadOptions,
  loadParticipants,
  loadPollBySlug,
  loadPollHosts,
  loadVotes,
  optionView,
  startOf,
  statusOf,
  unknownOptionIds,
  votesByParticipant,
  type OptionRow,
  type ParticipantRow,
  type PollRow,
} from "./load";
import { rankPollOptions } from "./ranking";
import { identifyParticipant, type VoterIdentity } from "./vote";
import { canSubscribe, fullOptionIds, redactForVoter, type VisComment } from "./visibility";
import { locationView } from "./views";
import type {
  BookedMeetingView,
  HostPollView,
  PollActivityView,
  PollCommentView,
  PollListFilter,
  PollListItem,
  PollListPage,
  RankedOptionView,
  VoteChoice,
  VoterPollView,
} from "./types";

// ---------------------------------------------------------------------------------------------------------------
// Voter page

export type VoterViewResult =
  | { status: 200; view: VoterPollView; canonicalSlug: string; pollId: string }
  /**
   * An old link ending: redirect to the canonical slug. The voter's edit cookie lives on the old path, so when the
   * request carried a valid one, `editPath` is the magic edit link on the new slug (it moves the cookies to the new
   * paths and lands on /p/{canonicalSlug}): redirect there instead to keep "Edit your preferred times".
   */
  | { status: 301; canonicalSlug: string; editPath: string | null }
  | { status: 404 }
  | { status: 410 };

/**
 * Who may see the booked meeting's join details: "full" (hosts, and voters who are invitees of the meeting) gets the
 * join link, the location text and the "Add to calendar" links; "public" (anyone else holding the poll link) only
 * learns that the meeting is scheduled, when, and a physical address or phone number already shown before booking.
 */
type MeetingAccess = "full" | "public";

async function bookedView(poll: PollRow, options: readonly OptionRow[], access: MeetingAccess, opts: { inviteToken?: string | null } = {}): Promise<BookedMeetingView | null> {
  if (poll.status !== "booked" || !poll.bookedScheduledEventId) return null;
  const db = await getDb();
  const [m] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, poll.bookedScheduledEventId)).limit(1);
  if (!m) return null;
  const option = options.find((o) => o.id === poll.bookedOptionId);
  const full = access === "full";
  const conference = Boolean(m.location?.kind && isConferenceKind(m.location.kind));
  const join = full && m.location?.kind ? conferenceJoinUrl(m.location) : null;
  const joinLink = join ? joinUrl(m.id) : null;
  const allDayDate = option?.allDayDate ?? null;
  return {
    scheduledEventId: full ? m.id : null,
    start: m.startAt.toISOString(),
    end: m.endAt.toISOString(),
    allDayDate,
    status: m.status,
    location: locationView(poll.location),
    locationText: full || !conference ? (m.location?.location ?? null) : null,
    joinUrl: joinLink,
    addToCalendar:
      full && m.status === "active"
        ? addToCalendarLinks({
            title: m.name,
            start: m.startAt,
            end: m.endAt,
            allDayDate,
            location: joinLink ?? m.location?.location ?? null,
            details: pollUrl(poll.slug),
            // A voter recognized by their invite link (no edit cookie yet) downloads with the same link.
            icsUrl: absoluteUrl(`/api/public/polls/${encodeURIComponent(poll.slug)}/event.ics${opts.inviteToken ? `?i=${encodeURIComponent(opts.inviteToken)}` : ""}`),
            locale: poll.locale,
          })
        : [],
  };
}

/** "full" when the identified voter (or the signed-in viewer's email) is an active invitee of the booked meeting. */
async function voterMeetingAccess(
  poll: PollRow,
  me: Pick<ParticipantRow, "id" | "emailNormalized"> | null,
  viewer: { email: string } | null | undefined,
  isHost: boolean,
): Promise<MeetingAccess> {
  if (isHost) return "full";
  if (!poll.bookedScheduledEventId) return "public";
  const emails = [me?.emailNormalized, viewer?.email ? normalizeEmail(viewer.email) : null].filter((v): v is string => Boolean(v));
  const match: SQL[] = [];
  if (me) match.push(eq(invitees.pollParticipantId, me.id));
  if (emails.length) match.push(inArray(invitees.emailNormalized, emails));
  if (!match.length) return "public";
  const db = await getDb();
  const [row] = await db
    .select({ id: invitees.id })
    .from(invitees)
    .where(and(eq(invitees.scheduledEventId, poll.bookedScheduledEventId), eq(invitees.status, "active"), or(...match)))
    .limit(1);
  return row ? "full" : "public";
}

/**
 * The booked meeting as an "Add to calendar" download (MP-15; METHOD PUBLISH, the meeting's UID so it merges with the
 * invitation). Null unless the poll is booked, its meeting is active and the caller is an invitee of it or a host (the
 * file carries the join link, which people who were not invited never get).
 */
export async function getBookedMeetingIcs(
  slug: string,
  identity: VoterIdentity & { viewer?: { userId: string; email: string } | null } = {},
): Promise<{ filename: string; ics: string } | null> {
  const db = await getDb();
  const found = await loadPollBySlug(db, slug, clockNow());
  if (!found || found.poll.deletedAt) return null;
  const poll = found.poll;
  if (poll.status !== "booked" || !poll.bookedScheduledEventId) return null;
  const [m] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, poll.bookedScheduledEventId)).limit(1);
  if (!m || m.status !== "active") return null;
  const viewerId = identity.userId ?? identity.viewer?.userId ?? null;
  const isHost = viewerId ? (await loadPollHosts(db, poll)).some((h) => h.userId === viewerId) : false;
  const me = await identifyParticipant(db, poll.id, { ...identity, userId: viewerId });
  if ((await voterMeetingAccess(poll, me?.participant ?? null, identity.viewer, isHost)) !== "full") return null;
  const [organizer] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, m.organizerUserId)).limit(1);
  const options = await loadOptions(db, poll.id);
  const allDayDate = options.find((o) => o.id === poll.bookedOptionId)?.allDayDate ?? undefined;
  const join = m.location?.kind ? conferenceJoinUrl(m.location) : null;
  const ics = buildIcs({
    method: "PUBLISH",
    uid: icsUid(m.id, new URL(appUrl()).host),
    sequence: m.icsSequence,
    start: m.startAt,
    end: m.endAt,
    allDayDate,
    summary: m.name,
    description: pollUrl(poll.slug),
    location: join ? joinUrl(m.id) : (m.location?.location ?? null),
    url: pollUrl(poll.slug),
    organizer: { name: organizer?.name ?? "", email: organizer?.email ?? "" },
    attendees: [],
    status: "CONFIRMED",
  });
  const base = poll.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().replace(/\s+/g, "-").slice(0, 60) || "meeting";
  return { filename: `${base}.ics`, ics };
}

function commentRows(rows: (typeof meetingPollComments.$inferSelect)[]): VisComment[] {
  return rows.map((c) => ({
    id: c.id,
    participantId: c.participantId,
    authorUserId: c.authorUserId,
    authorName: c.authorName,
    body: c.body,
    visibility: c.visibility === "host_only" ? "host_only" : "public",
    createdAt: c.createdAt.toISOString(),
  }));
}

async function liveComments(pollId: string): Promise<(typeof meetingPollComments.$inferSelect)[]> {
  const db = await getDb();
  return db
    .select()
    .from(meetingPollComments)
    .where(and(eq(meetingPollComments.pollId, pollId), isNull(meetingPollComments.deletedAt)))
    .orderBy(meetingPollComments.createdAt);
}

/** "Check my calendar" with Google (MP-13), only when Google sign-in is configured. */
function voterCalendarStartPath(slug: string): string | null {
  if (!getFeatures().googleOAuth) return null;
  return oauthStartPath("google", { intent: "poll_freebusy", next: `/p/${slug}`, data: { poll: slug } });
}

/**
 * The voter page data (MP-07 to MP-15). 404 for an unknown slug, 410 for a deleted poll (no details), 301 with the
 * canonical slug for an old link ending. `viewer` is the signed-in app user, if any (prefill and matching).
 */
export async function getVoterView(
  slug: string,
  identity: VoterIdentity & { viewer?: { userId: string; name: string; email: string } | null } = {},
): Promise<VoterViewResult> {
  const db = await getDb();
  const at = clockNow();
  const found = await loadPollBySlug(db, slug, at);
  if (!found) return { status: 404 };
  const poll = found.poll;
  if (poll.deletedAt || poll.status === "canceled") return { status: 410 };
  if (found.redirected) {
    const carried = identity.editToken ? await identifyParticipant(db, poll.id, { editToken: identity.editToken }) : null;
    const editPath = carried?.via === "edit" ? `/api/public/polls/${encodeURIComponent(poll.slug)}/edit?t=${encodeURIComponent(identity.editToken!)}` : null;
    return { status: 301, canonicalSlug: poll.slug, editPath };
  }
  const [options, hosts, participants, voteRows, comments] = await Promise.all([
    loadOptions(db, poll.id),
    loadPollHosts(db, poll),
    loadParticipants(db, poll.id),
    loadVotes(db, poll.id),
    poll.allowComments ? liveComments(poll.id) : Promise.resolve([]),
  ]);
  const status = statusOf(poll, options, at);
  const votes = votesByParticipant(voteRows);
  const me = await identifyParticipant(db, poll.id, { ...identity, userId: identity.userId ?? identity.viewer?.userId ?? null });
  const mine = me?.participant ?? null;
  const submitted = Boolean(mine && (mine.status === "responded" || mine.status === "declined"));
  const optionIds = options.map((o) => o.id);
  const red = redactForVoter({
    visibility: poll.resultsVisibility,
    optionIds,
    participants: participants.map((p) => ({ id: p.id, name: p.name, status: p.status, votes: votes.get(p.id) ?? {} })),
    comments: commentRows(comments),
    maxVotesPerOption: poll.maxVotesPerOption,
    viewer: { participantId: mine?.id ?? null, submitted },
  });
  const myVotes = mine ? (votes.get(mine.id) ?? {}) : {};
  const deadlineSoon = Boolean(poll.deadlineAt && status === "open" && poll.deadlineAt.getTime() - at.getTime() <= DEADLINE_SOON_MS);
  const viewerIsHost = Boolean(identity.viewer && hosts.some((h) => h.userId === identity.viewer!.userId));
  const view: VoterPollView = {
    poll: {
      slug: poll.slug,
      title: poll.title,
      descriptionHtml: poll.descriptionHtml ? sanitizeRichText(poll.descriptionHtml) : null,
      status,
      timezone: poll.timezone,
      timeZoneMode: poll.timeZoneMode,
      locale: poll.locale,
      allowIfNeedBe: poll.allowIfNeedBe,
      requireEmail: poll.requireEmail,
      verifyEmail: poll.verifyEmail,
      allowComments: poll.allowComments,
      maxChoicesPerParticipant: poll.maxChoicesPerParticipant,
      deadline: poll.deadlineAt?.toISOString() ?? null,
      deadlineSoon,
      durationMinutes: commonDuration(options),
      location: locationView(poll.location),
      hosts: hostViews(hosts),
      resultsVisibility: poll.resultsVisibility,
      canSubscribe: canSubscribe(poll.resultsVisibility),
      commentsHostOnly: poll.resultsVisibility === "host_only",
    },
    // Chronological (date-only options at local midnight in the poll zone), then in creation order.
    options: [...options]
      .sort((a, b) => startOf(a, poll.timezone) - startOf(b, poll.timezone) || a.position - b.position)
      .map((o) => ({ ...optionView(o, poll.timezone, at), ...red.options[o.id]! })),
    me: mine
      ? {
          participantId: mine.id,
          name: mine.name,
          email: mine.email,
          status: mine.status,
          submitted,
          votes: myVotes,
          unknownOptionIds: unknownOptionIds(mine, options, myVotes),
          overLimit: isOverLimit(poll.maxChoicesPerParticipant, myVotes),
          subscribed: mine.subscribedToUpdates,
          unsubscribed: Boolean(mine.unsubscribedAt),
          emailVerified: Boolean(mine.emailVerifiedAt),
        }
      : null,
    prefill:
      mine && me?.via !== "edit"
        ? { name: mine.name, email: mine.email ?? "", locked: Boolean(mine.email) }
        : !mine && identity.viewer
          ? { name: identity.viewer.name, email: identity.viewer.email, locked: true }
          : null,
    participants: red.participants,
    respondentCount: red.respondentCount,
    comments: poll.allowComments ? red.comments : null,
    canVote: status === "open",
    booked: await bookedView(poll, options, await voterMeetingAccess(poll, mine, identity.viewer, viewerIsHost), { inviteToken: me?.via === "invite" ? identity.inviteToken : null }),
    viewerIsHost,
    calendarCheck: { googleStartPath: voterCalendarStartPath(poll.slug), account: Boolean(identity.viewer) },
  };
  return { status: 200, view, canonicalSlug: poll.slug, pollId: poll.id };
}

// ---------------------------------------------------------------------------------------------------------------
// Host results

/** The results page (MP-16, MP-17). `markViewed` clears the "New" dot (MP-26). */
export async function getHostPoll(actor: ActorCtx, pollId: string, opts: { markViewed?: boolean } = {}): Promise<HostPollView> {
  const db = await getDb();
  const { poll, access, canDelete } = await requirePollAccess(actor, pollId, db);
  const at = clockNow();
  const [options, hosts, participants, voteRows, comments, activity, holds] = await Promise.all([
    loadOptions(db, poll.id),
    loadPollHosts(db, poll),
    loadParticipants(db, poll.id),
    loadVotes(db, poll.id),
    liveComments(poll.id),
    db.select().from(meetingPollActivity).where(eq(meetingPollActivity.pollId, poll.id)).orderBy(desc(meetingPollActivity.createdAt)).limit(100),
    holdsSummary(db, poll.id),
  ]);
  const status = statusOf(poll, options, at);
  const votes = votesByParticipant(voteRows);
  const busy = status === "open" || status === "closed" ? await hostBusyForPoll({ userId: actor.user.id, organizationId: actor.orgId }, poll, hosts.map((h) => h.userId), options, at) : null;
  const { statuses, busyIds } = optionStatuses(poll, options, busy, hosts, at);
  const ranked = rankPollOptions(
    options.map((o) => ({ id: o.id, start: startOf(o, poll.timezone) })),
    voteRows,
    participants.map((p) => ({ id: p.id, status: p.status, isRequired: p.isRequired })),
    busyIds,
    at,
    { hostPreference: poll.hostPreferences, countHostPreference: poll.countHostPreference },
  );
  const byId = new Map(options.map((o) => [o.id, o]));
  const full = fullOptionIds(options.map((o) => o.id), participants.map((p) => ({ id: p.id, name: p.name, status: p.status, votes: votes.get(p.id) ?? {} })), poll.maxVotesPerOption, null);
  const respondents = participants.filter((p) => p.status === "responded" || p.status === "declined");
  const namesFor = (optionId: string, choice: VoteChoice) => respondents.filter((p) => votes.get(p.id)?.[optionId] === choice).map((p) => p.name);
  const rankedViews: RankedOptionView[] = ranked.map((r) => ({
    ...optionView(byId.get(r.id)!, poll.timezone, at),
    counts: { yes: r.yes, ifNeedBe: r.ifNeedBe, no: r.no, noAnswer: r.unknown },
    voters: { yes: namesFor(r.id, "yes"), ifNeedBe: namesFor(r.id, "if_need_be"), no: namesFor(r.id, "no") },
    rank: r.rank,
    isBest: r.isBest,
    requiredOk: r.requiredOk,
    hostStatus: statuses.get(r.id) ?? { state: "unknown" },
    isBooked: poll.bookedOptionId === r.id && (status === "booked" || Boolean(poll.bookedScheduledEventId)),
    isFull: full.has(r.id),
  }));
  const commentCounts = new Map<string, number>();
  for (const c of comments) if (c.participantId) commentCounts.set(c.participantId, (commentCounts.get(c.participantId) ?? 0) + 1);
  const participantViews = participants.map((p) => {
    const v = votes.get(p.id) ?? {};
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      status: p.status,
      source: p.source,
      isRequired: p.isRequired,
      subscribed: p.subscribedToUpdates,
      unsubscribed: Boolean(p.unsubscribedAt),
      timezone: p.timezone,
      votes: v,
      unknownOptionIds: unknownOptionIds(p, options, v),
      overLimit: isOverLimit(poll.maxChoicesPerParticipant, v),
      invitedAt: p.invitedAt?.toISOString() ?? null,
      respondedAt: p.respondedAt?.toISOString() ?? null,
      lastSubmittedAt: p.lastSubmittedAt?.toISOString() ?? null,
      lastRemindedAt: p.lastRemindedAt?.toISOString() ?? null,
      reminderCount: p.reminderCount,
      commentCount: commentCounts.get(p.id) ?? 0,
      createdAt: p.createdAt.toISOString(),
    };
  });
  const nameById = new Map(participants.map((p) => [p.id, p.name]));
  const actorIds = [...new Set(activity.map((a) => a.actorUserId).filter((v): v is string => Boolean(v)))];
  const actorNames = actorIds.length ? new Map((await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, actorIds))).map((u) => [u.id, u.name])) : new Map<string, string>();
  const activityViews: PollActivityView[] = activity.map((a) => ({
    id: a.id,
    type: a.type,
    participantName: a.participantId ? (nameById.get(a.participantId) ?? (typeof a.data.name === "string" ? a.data.name : null)) : null,
    actorName: a.actorUserId ? (actorNames.get(a.actorUserId) ?? null) : null,
    data: activityDataView(a.data),
    createdAt: a.createdAt.toISOString(),
  }));
  const commentViews: PollCommentView[] = comments.map((c) => ({
    id: c.id,
    authorName: c.authorName,
    isHost: Boolean(c.authorUserId),
    body: c.body,
    createdAt: c.createdAt.toISOString(),
    hostOnly: c.visibility === "host_only",
    canDelete: true,
  }));
  if (opts.markViewed) await db.update(meetingPolls).set({ hostLastViewedAt: at }).where(eq(meetingPolls.id, poll.id));
  const skipped = poll.reserveTimes && (status === "open" || status === "closed") ? Math.max(0, hosts.length * options.filter((o) => startOf(o, poll.timezone) > at.getTime()).length - holds.active - holds.pending - holds.failed) : 0;
  return {
    poll: {
      id: poll.id,
      slug: poll.slug,
      link: pollUrl(poll.slug),
      title: poll.title,
      descriptionHtml: poll.descriptionHtml,
      location: poll.location,
      locationView: locationView(poll.location),
      status,
      storedStatus: poll.status,
      defaultDurationMinutes: poll.defaultDurationMinutes,
      durationMinutes: commonDuration(options),
      eventTypeId: poll.eventTypeId,
      ownerUserId: poll.ownerUserId,
      createdAt: poll.createdAt.toISOString(),
      bookedAt: poll.bookedAt?.toISOString() ?? null,
      votingClosedAt: poll.votingClosedAt?.toISOString() ?? null,
      reopenedAt: poll.reopenedAt?.toISOString() ?? null,
      firstInviteSentAt: poll.firstInviteSentAt?.toISOString() ?? null,
      hostLastViewedAt: poll.hostLastViewedAt?.toISOString() ?? null,
      settings: {
        allowIfNeedBe: poll.allowIfNeedBe,
        hideInvitees: poll.hideInvitees,
        requireEmail: poll.requireEmail,
        verifyEmail: poll.verifyEmail,
        allowComments: poll.allowComments,
        maxVotesPerOption: poll.maxVotesPerOption,
        maxChoicesPerParticipant: poll.maxChoicesPerParticipant,
        deadline: poll.deadlineAt?.toISOString() ?? null,
        reserveTimes: poll.reserveTimes,
        notifyMode: poll.notifyMode,
        reminderMode: poll.reminderMode,
        reminderOffsets: poll.reminderOffsets ?? [],
        autoBook: poll.autoBook,
        countHostPreference: poll.countHostPreference,
        hostPreferences: poll.hostPreferences ?? {},
        resultsVisibility: poll.resultsVisibility,
        timeZoneMode: poll.timeZoneMode,
        timezone: poll.timezone,
        locale: poll.locale,
        sendMeetingReminders: poll.sendMeetingReminders,
      },
    },
    access,
    canDelete,
    canRemoveCohosts: canDelete,
    hosts: hosts.map((h) => ({ ...hostViews([h])[0]!, email: h.email })),
    options: rankedViews,
    ranking: ranked.filter((r) => !r.isPast).map((r) => r.id),
    hasResponses: respondents.length > 0,
    participants: participantViews,
    counts: {
      respondents: respondents.length,
      invited: participants.filter((p) => p.source === "invite").length,
      declined: participants.filter((p) => p.status === "declined").length,
      total: participants.length,
    },
    comments: commentViews,
    activity: activityViews,
    holds: { enabled: poll.reserveTimes, active: holds.active, pending: holds.pending, failed: holds.failed, skipped, provider: holds.provider },
    booked: await bookedViewAny(poll, options),
  };
}

/** The booked meeting of a booked or reopened poll (results keep it, MP-21 "Meeting canceled" state). */
async function bookedViewAny(poll: PollRow, options: readonly OptionRow[]): Promise<BookedMeetingView | null> {
  return poll.bookedScheduledEventId ? bookedView({ ...poll, status: "booked" }, options, "full") : null;
}

/** Live updates since an instant (MP-16: polled every 15 seconds; toasts "{Name} voted"). */
export async function getPollActivity(actor: ActorCtx, pollId: string, since: Date | null): Promise<PollActivityView[]> {
  const db = await getDb();
  const { poll } = await requirePollAccess(actor, pollId, db);
  const rows = await db
    .select({ a: meetingPollActivity, participantName: meetingPollParticipants.name })
    .from(meetingPollActivity)
    .leftJoin(meetingPollParticipants, eq(meetingPollParticipants.id, meetingPollActivity.participantId))
    .where(and(eq(meetingPollActivity.pollId, poll.id), since ? gt(meetingPollActivity.createdAt, since) : undefined))
    .orderBy(desc(meetingPollActivity.createdAt))
    .limit(100);
  return rows.map(({ a, participantName }) => ({
    id: a.id,
    type: a.type,
    participantName: participantName ?? (typeof a.data.name === "string" ? a.data.name : null),
    actorName: null,
    data: activityDataView(a.data),
    createdAt: a.createdAt.toISOString(),
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Meeting polls list (MP-26)

const PAGE_SIZE = 25;

/** The list tab: filters Open (default, closed unbooked included), Booked, Ended, All, Deleted; search; Hosted by. */
export async function listPolls(
  actor: ActorCtx,
  opts: { filter?: PollListFilter; q?: string; hostedBy?: "me" | "cohosted" | "all"; cursor?: string | null; limit?: number } = {},
): Promise<PollListPage> {
  const db = await getDb();
  const at = clockNow();
  const filter = opts.filter ?? "open";
  const limit = Math.min(Math.max(opts.limit ?? PAGE_SIZE, 1), 100);
  const offset = Math.max(0, Number(decodeCursor<{ o: number }>(opts.cursor ?? null)?.o ?? 0) || 0);
  const hostedBy = opts.hostedBy ?? "all";
  const admin = isOrgAdmin(actor);
  const mineSql = sql`exists (select 1 from ${eventTypeHosts} where ${eventTypeHosts.eventTypeId} = ${meetingPolls.eventTypeId} and ${eventTypeHosts.userId} = ${actor.user.id})`;
  const conds: (SQL | undefined)[] = [eq(meetingPolls.organizationId, actor.orgId)];
  if (hostedBy === "me") conds.push(eq(meetingPolls.ownerUserId, actor.user.id));
  else if (hostedBy === "cohosted") conds.push(and(sql`${meetingPolls.ownerUserId} <> ${actor.user.id}`, mineSql));
  else if (!admin) conds.push(or(eq(meetingPolls.ownerUserId, actor.user.id), mineSql));
  conds.push(filter === "deleted" ? isNotNull(meetingPolls.deletedAt) : isNull(meetingPolls.deletedAt));
  if (opts.q?.trim()) conds.push(sql`${meetingPolls.title} ilike ${`%${opts.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
  const polls = await db
    .select()
    .from(meetingPolls)
    .where(and(...conds))
    .orderBy(desc(meetingPolls.createdAt))
    .limit(1000);
  if (!polls.length) return { items: [], nextCursor: null };
  const ids = polls.map((p) => p.id);
  const [optionRows, participantRows, voteRows, meetings, activityRows, hostsMap] = await Promise.all([
    db.select().from(meetingPollOptions).where(and(inArray(meetingPollOptions.pollId, ids), isNull(meetingPollOptions.deletedAt))),
    db
      .select({ pollId: meetingPollParticipants.pollId, id: meetingPollParticipants.id, status: meetingPollParticipants.status, source: meetingPollParticipants.source, isRequired: meetingPollParticipants.isRequired })
      .from(meetingPollParticipants)
      .where(and(inArray(meetingPollParticipants.pollId, ids), isNull(meetingPollParticipants.deletedAt))),
    db
      .select({ pollId: meetingPollVotes.pollId, participantId: meetingPollVotes.participantId, optionId: meetingPollVotes.optionId, choice: meetingPollVotes.choice })
      .from(meetingPollVotes)
      .innerJoin(meetingPollOptions, eq(meetingPollOptions.id, meetingPollVotes.optionId))
      .innerJoin(meetingPollParticipants, eq(meetingPollParticipants.id, meetingPollVotes.participantId))
      .where(and(inArray(meetingPollVotes.pollId, ids), isNull(meetingPollOptions.deletedAt), isNull(meetingPollParticipants.deletedAt))),
    db
      .select({ id: scheduledEvents.id, startAt: scheduledEvents.startAt, endAt: scheduledEvents.endAt, status: scheduledEvents.status })
      .from(scheduledEvents)
      .where(inArray(scheduledEvents.id, polls.map((p) => p.bookedScheduledEventId).filter((v): v is string => Boolean(v)).concat(["00000000-0000-0000-0000-000000000000"]))),
    db
      .select({ pollId: meetingPollActivity.pollId, last: sql<Date>`max(${meetingPollActivity.createdAt})` })
      .from(meetingPollActivity)
      .where(and(inArray(meetingPollActivity.pollId, ids), inArray(meetingPollActivity.type, ["voted", "vote_changed", "declined", "commented"])))
      .groupBy(meetingPollActivity.pollId),
    hostIdsByEventType(db, polls.map((p) => p.eventTypeId)),
  ]);
  const meetingById = new Map(meetings.map((m) => [m.id, m]));
  const lastActivity = new Map(activityRows.map((r) => [r.pollId, new Date(r.last)]));
  // Rows grouped per poll once (no scan of every row for every poll).
  const group = <T extends { pollId: string }>(rows: readonly T[]): Map<string, T[]> => {
    const out = new Map<string, T[]>();
    for (const r of rows) {
      const list = out.get(r.pollId);
      if (list) list.push(r);
      else out.set(r.pollId, [r]);
    }
    return out;
  };
  const optionsByPoll = group(optionRows);
  const participantsByPoll = group(participantRows);
  const votesByPoll = group(voteRows);
  const items: (PollListItem & { sortKey: [number, number, number] })[] = [];
  for (const p of polls) {
    const options = optionsByPoll.get(p.id) ?? [];
    const status = p.deletedAt ? "canceled" : statusOf(p, options, at);
    const keep =
      filter === "all" || filter === "deleted"
        ? true
        : filter === "open"
          ? status === "open" || status === "closed"
          : filter === "booked"
            ? status === "booked"
            : status === "expired";
    if (!keep) continue;
    const parts = participantsByPoll.get(p.id) ?? [];
    const votes = votesByPoll.get(p.id) ?? [];
    const sorted = [...options].sort((a, b) => startOf(a, p.timezone) - startOf(b, p.timezone));
    const ranked = status === "open" || status === "closed"
      ? rankPollOptions(sorted.map((o) => ({ id: o.id, start: startOf(o, p.timezone) })), votes, parts.map((x) => ({ id: x.id, status: x.status, isRequired: x.isRequired })), [], at)
      : [];
    const top = ranked.find((r) => !r.isPast && (r.yes > 0 || r.ifNeedBe > 0));
    const topOption = top ? sorted.find((o) => o.id === top.id) : null;
    const meeting = p.bookedScheduledEventId ? meetingById.get(p.bookedScheduledEventId) : undefined;
    // Booked from a date-only option and still at that day: the meeting is "All day" on that date.
    const bookedOption = meeting && p.bookedOptionId ? options.find((o) => o.id === p.bookedOptionId) : undefined;
    const bookedAllDay = meeting && bookedOption?.allDayDate && meeting.startAt.getTime() === startOf(bookedOption, p.timezone) ? bookedOption.allDayDate : null;
    const last = lastActivity.get(p.id);
    const hostIds = hostsMap.get(p.eventTypeId) ?? [];
    const role = p.ownerUserId === actor.user.id ? "owner" : hostIds.includes(actor.user.id) ? "cohost" : "admin";
    const respondents = parts.filter((x) => x.status === "responded" || x.status === "declined").length;
    const deadlineKey = p.deadlineAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    items.push({
      id: p.id,
      slug: p.slug,
      link: pollUrl(p.slug),
      title: p.title,
      color: POLL_COLOR,
      status,
      durationMinutes: commonDuration(options),
      optionCount: options.length,
      firstOption: sorted[0] ? new Date(startOf(sorted[0], p.timezone)).toISOString() : null,
      lastOption: sorted.length ? new Date(startOf(sorted[sorted.length - 1]!, p.timezone)).toISOString() : null,
      respondents,
      invited: parts.filter((x) => x.source === "invite").length,
      hasNew: Boolean(last && (!p.hostLastViewedAt || last.getTime() > p.hostLastViewedAt.getTime())),
      deadline: p.deadlineAt?.toISOString() ?? null,
      booked: meeting
        ? { scheduledEventId: meeting.id, start: meeting.startAt.toISOString(), end: meeting.endAt.toISOString(), allDayDate: bookedAllDay, status: meeting.status }
        : null,
      topOption: top && topOption ? { optionId: top.id, start: topOption.startsAt?.toISOString() ?? null, allDayDate: topOption.allDayDate, yes: top.yes, ifNeedBe: top.ifNeedBe } : null,
      role,
      canDelete: role === "owner" || admin,
      createdAt: p.createdAt.toISOString(),
      // Open polls: soonest deadline first, no deadline last, then newest; booked: by meeting time; others: newest.
      sortKey:
        status === "open" || status === "closed"
          ? [0, deadlineKey, -p.createdAt.getTime()]
          : status === "booked"
            ? [1, meeting?.startAt.getTime() ?? Number.MAX_SAFE_INTEGER, -p.createdAt.getTime()]
            : [2, -p.createdAt.getTime(), 0],
    });
  }
  items.sort((a, b) => a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1] || a.sortKey[2] - b.sortKey[2]);
  const page = items.slice(offset, offset + limit).map(({ sortKey, ...rest }) => {
    void sortKey;
    return rest;
  });
  const nextCursor = offset + limit < items.length ? encodeCursor({ o: offset + limit }) : null;
  return { items: page, nextCursor };
}

// ---------------------------------------------------------------------------------------------------------------
// Export (MP-32)

/** CSV: one row per participant, columns per option labelled in `timezone` (default: the actor's zone). */
export async function exportPollCsv(actor: ActorCtx, pollId: string, timezone?: string): Promise<{ filename: string; csv: string }> {
  const db = await getDb();
  const { poll } = await requirePollAccess(actor, pollId, db);
  const zone = timezone ?? actor.user.timezone ?? poll.timezone;
  const hour12 = actor.user.timeFormat !== "24h";
  const [options, participants, voteRows, comments] = await Promise.all([loadOptions(db, poll.id), loadParticipants(db, poll.id), loadVotes(db, poll.id), liveComments(poll.id)]);
  const votes = votesByParticipant(voteRows);
  const sorted = [...options].sort((a, b) => startOf(a, poll.timezone) - startOf(b, poll.timezone));
  const counts = new Map<string, number>();
  for (const c of comments) if (c.participantId) counts.set(c.participantId, (counts.get(c.participantId) ?? 0) + 1);
  const csv = buildPollCsv(
    sorted.map((o) => ({ id: o.id, label: optionLongLabel({ start: o.startsAt?.toISOString() ?? null, end: o.endsAt?.toISOString() ?? null, allDayDate: o.allDayDate, durationMinutes: o.durationMinutes }, zone, { hour12 }) })),
    participants.map((p) => ({ name: p.name || p.email || "", email: p.email, status: p.status, votes: votes.get(p.id) ?? {}, commentCount: counts.get(p.id) ?? 0 })),
  );
  return { filename: csvFileName(poll.title), csv };
}

// ---------------------------------------------------------------------------------------------------------------
// Calendly-compatible read queries for an API (MP-33; api-v1 is not part of this build, docs/SCOPE.md)

export type PollEventTypeApiRow = {
  eventTypeId: string;
  pollId: string;
  name: string;
  slug: string;
  durationMinutes: number;
  active: boolean;
  secret: true;
  bookingMethod: "poll";
  type: "AdhocEventType";
  poolingType: "collective" | null;
  schedulingUrl: string;
  createdAt: string;
  updatedAt: string;
};

/** Poll-backed event types of a user (active while open or closed, inactive once booked, canceled or expired). */
export async function listPollEventTypesForApi(organizationId: string, userId: string): Promise<PollEventTypeApiRow[]> {
  const db = await getDb();
  const at = clockNow();
  const rows = await db
    .select({ poll: meetingPolls, et: eventTypes })
    .from(meetingPolls)
    .innerJoin(eventTypes, eq(eventTypes.id, meetingPolls.eventTypeId))
    .innerJoin(eventTypeHosts, eq(eventTypeHosts.eventTypeId, meetingPolls.eventTypeId))
    .where(and(eq(meetingPolls.organizationId, organizationId), eq(eventTypeHosts.userId, userId), isNull(meetingPolls.deletedAt)));
  const ids = rows.map((r) => r.poll.id);
  const optionRows = ids.length
    ? await db.select().from(meetingPollOptions).where(and(inArray(meetingPollOptions.pollId, ids), isNull(meetingPollOptions.deletedAt)))
    : [];
  const out: PollEventTypeApiRow[] = [];
  const optionsByPoll = new Map<string, OptionRow[]>();
  for (const o of optionRows) optionsByPoll.set(o.pollId, [...(optionsByPoll.get(o.pollId) ?? []), o]);
  for (const { poll, et } of rows) {
    const options = optionsByPoll.get(poll.id) ?? [];
    const status = statusOf(poll, options, at);
    out.push({
      eventTypeId: et.id,
      pollId: poll.id,
      name: poll.title,
      slug: poll.slug,
      durationMinutes: poll.defaultDurationMinutes,
      active: status === "open" || status === "closed",
      secret: true,
      bookingMethod: "poll",
      type: "AdhocEventType",
      poolingType: et.poolingType === "collective" ? "collective" : null,
      schedulingUrl: pollUrl(poll.slug),
      createdAt: poll.createdAt.toISOString(),
      updatedAt: poll.updatedAt.toISOString(),
    });
  }
  return out;
}

/** Read-only meeting polls of a user (extension endpoint /api/v1/meeting_polls, MP-33). */
export async function listMeetingPollsForApi(actor: ActorCtx, cursor?: string | null): Promise<PollListPage> {
  return listPolls(actor, { filter: "all", hostedBy: "all", cursor });
}
