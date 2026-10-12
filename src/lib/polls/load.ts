// Poll data access shared by the services (ARCHITECTURE 26 rule 13: a few indexed queries, no N+1). Server only.
//
// Lock order inside poll transactions (never take host advisory locks after these): the poll row (FOR UPDATE for host
// changes and state transitions, FOR SHARE for votes), then option rows FOR UPDATE in ascending id order (vote
// capacity). Booking-core takes the hosts' advisory locks first and then the poll row (markPollBookedInTx).
import "server-only";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { DbOrTx } from "@/db";
import {
  eventTypeHosts,
  meetingPollOptions,
  meetingPollParticipants,
  meetingPolls,
  meetingPollVotes,
  pollSlugRedirects,
  users,
} from "@/db/schema";
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from "@/db/types";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { fileUrl } from "@/lib/files";
import { POLL_ERRORS } from "./constants";
import { optionEndMs, optionStartMs } from "./display";
import { effectiveStatus } from "./state";
import type { PollHostView, PollOptionView, PollStatus, VoteChoice } from "./types";

export type PollRow = typeof meetingPolls.$inferSelect;
export type OptionRow = typeof meetingPollOptions.$inferSelect;
export type ParticipantRow = typeof meetingPollParticipants.$inferSelect;
export type VoteRow = typeof meetingPollVotes.$inferSelect;

export async function loadPoll(db: DbOrTx, pollId: string): Promise<PollRow | null> {
  if (!isUuid(pollId)) return null;
  const [row] = await db.select().from(meetingPolls).where(eq(meetingPolls.id, pollId)).limit(1);
  return row ?? null;
}

/** Locks the poll row (state transitions, host edits: "update"; votes: "share"). */
export async function lockPoll(tx: DbOrTx, pollId: string, mode: "update" | "share" = "update"): Promise<PollRow> {
  if (!isUuid(pollId)) throw new AppError("not_found", POLL_ERRORS.notFound);
  const [row] = await tx.select().from(meetingPolls).where(eq(meetingPolls.id, pollId)).limit(1).for(mode === "share" ? "share" : "update");
  if (!row) throw new AppError("not_found", POLL_ERRORS.notFound);
  return row;
}

/**
 * The poll behind a public slug, following a live link-ending redirect (MP-05). Deleted polls are returned too (the
 * voter page answers 410 for them).
 */
export async function loadPollBySlug(db: DbOrTx, slug: string, now: Date): Promise<{ poll: PollRow; redirected: boolean } | null> {
  const s = slug.trim().toLowerCase();
  if (!s || s.length > 64) return null;
  const [row] = await db.select().from(meetingPolls).where(eq(meetingPolls.slug, s)).limit(1);
  if (row) return { poll: row, redirected: false };
  const [redirect] = await db
    .select({ pollId: pollSlugRedirects.pollId })
    .from(pollSlugRedirects)
    .where(and(eq(pollSlugRedirects.oldSlug, s), gt(pollSlugRedirects.expiresAt, now)))
    .limit(1);
  if (!redirect) return null;
  const poll = await loadPoll(db, redirect.pollId);
  return poll ? { poll, redirected: true } : null;
}

export async function loadOptions(db: DbOrTx, pollId: string, opts: { includeDeleted?: boolean } = {}): Promise<OptionRow[]> {
  return db
    .select()
    .from(meetingPollOptions)
    .where(opts.includeDeleted ? eq(meetingPollOptions.pollId, pollId) : and(eq(meetingPollOptions.pollId, pollId), isNull(meetingPollOptions.deletedAt)))
    .orderBy(asc(meetingPollOptions.startsAt), asc(meetingPollOptions.allDayDate), asc(meetingPollOptions.position));
}

/** Live participants in submission order (respondents by first response, then invited people by invite time). */
export async function loadParticipants(db: DbOrTx, pollId: string): Promise<ParticipantRow[]> {
  const rows = await db
    .select()
    .from(meetingPollParticipants)
    .where(and(eq(meetingPollParticipants.pollId, pollId), isNull(meetingPollParticipants.deletedAt)));
  return sortParticipants(rows);
}

export function sortParticipants<T extends Pick<ParticipantRow, "respondedAt" | "invitedAt" | "createdAt" | "id">>(rows: T[]): T[] {
  const key = (p: T) => (p.respondedAt ?? p.invitedAt ?? p.createdAt).getTime();
  return [...rows].sort((a, b) => {
    const ra = a.respondedAt ? 0 : 1;
    const rb = b.respondedAt ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return key(a) - key(b) || (a.id < b.id ? -1 : 1);
  });
}

/** Votes of live participants on live options (votes on removed options never count, MP-08). */
export async function loadVotes(db: DbOrTx, pollId: string): Promise<VoteRow[]> {
  return db
    .select({
      participantId: meetingPollVotes.participantId,
      optionId: meetingPollVotes.optionId,
      pollId: meetingPollVotes.pollId,
      choice: meetingPollVotes.choice,
      createdAt: meetingPollVotes.createdAt,
      updatedAt: meetingPollVotes.updatedAt,
    })
    .from(meetingPollVotes)
    .innerJoin(meetingPollOptions, eq(meetingPollOptions.id, meetingPollVotes.optionId))
    .innerJoin(meetingPollParticipants, eq(meetingPollParticipants.id, meetingPollVotes.participantId))
    .where(and(eq(meetingPollVotes.pollId, pollId), isNull(meetingPollOptions.deletedAt), isNull(meetingPollParticipants.deletedAt)));
}

/** participantId -> optionId -> choice. */
export function votesByParticipant(votes: readonly Pick<VoteRow, "participantId" | "optionId" | "choice">[]): Map<string, Record<string, VoteChoice>> {
  const out = new Map<string, Record<string, VoteChoice>>();
  for (const v of votes) {
    const m = out.get(v.participantId) ?? {};
    m[v.optionId] = v.choice;
    out.set(v.participantId, m);
  }
  return out;
}

export type PollHostRow = {
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  timezone: string;
  timeFormat: string;
  locale: string;
  notificationPrefs: NotificationPrefs;
  role: "owner" | "cohost";
};

/** The poll's hosts: the owner first, then co-hosts (the adhoc event type's hosts). */
export async function loadPollHosts(db: DbOrTx, poll: Pick<PollRow, "eventTypeId" | "ownerUserId">): Promise<PollHostRow[]> {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      avatarFileId: users.avatarFileId,
      timezone: users.timezone,
      timeFormat: users.timeFormat,
      locale: users.locale,
      notificationPrefs: users.notificationPrefs,
      position: eventTypeHosts.position,
      deletedAt: users.deletedAt,
    })
    .from(eventTypeHosts)
    .innerJoin(users, eq(users.id, eventTypeHosts.userId))
    .where(eq(eventTypeHosts.eventTypeId, poll.eventTypeId))
    .orderBy(asc(eventTypeHosts.position));
  const live = rows.filter((r) => !r.deletedAt);
  return live
    .map((r) => ({
      userId: r.userId,
      name: r.name,
      email: r.email,
      avatarUrl: r.avatarFileId ? fileUrl(r.avatarFileId) : r.avatarUrl,
      timezone: r.timezone,
      timeFormat: r.timeFormat,
      locale: r.locale,
      notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS, ...(r.notificationPrefs ?? {}) },
      role: r.userId === poll.ownerUserId ? ("owner" as const) : ("cohost" as const),
    }))
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "owner" ? -1 : 1));
}

export function hostViews(hosts: readonly PollHostRow[]): PollHostView[] {
  return hosts.map((h) => ({ userId: h.userId, name: h.name, avatarUrl: h.avatarUrl, role: h.role }));
}

/** Host user ids of many polls at once (list pages). */
export async function hostIdsByEventType(db: DbOrTx, eventTypeIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!eventTypeIds.length) return out;
  const rows = await db
    .select({ eventTypeId: eventTypeHosts.eventTypeId, userId: eventTypeHosts.userId })
    .from(eventTypeHosts)
    .where(inArray(eventTypeHosts.eventTypeId, eventTypeIds))
    .orderBy(asc(eventTypeHosts.position));
  for (const r of rows) out.set(r.eventTypeId, [...(out.get(r.eventTypeId) ?? []), r.userId]);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Derived values

/** Start instant of an option row (date-only: local midnight in the poll zone). */
export function startOf(o: Pick<OptionRow, "startsAt" | "allDayDate">, zone: string): number {
  return optionStartMs({ start: o.startsAt?.toISOString() ?? null, end: null, allDayDate: o.allDayDate, durationMinutes: 0 }, zone);
}

export function endOf(o: Pick<OptionRow, "endsAt" | "allDayDate">, zone: string): number {
  return optionEndMs({ start: null, end: o.endsAt?.toISOString() ?? null, allDayDate: o.allDayDate, durationMinutes: 0 }, zone);
}

/** The latest option start (lazy expiry), or null without options. */
export function lastOptionStart(options: readonly OptionRow[], zone: string): Date | null {
  let max: number | null = null;
  for (const o of options) {
    if (o.deletedAt) continue;
    const s = startOf(o, zone);
    if (max === null || s > max) max = s;
  }
  return max === null ? null : new Date(max);
}

/** The first option start after now, or null. */
export function firstFutureOptionStart(options: readonly OptionRow[], zone: string, now: Date): Date | null {
  let min: number | null = null;
  for (const o of options) {
    if (o.deletedAt) continue;
    const s = startOf(o, zone);
    if (s > now.getTime() && (min === null || s < min)) min = s;
  }
  return min === null ? null : new Date(min);
}

/** The status readers see (state.effectiveStatus). */
export function statusOf(poll: Pick<PollRow, "status" | "deadlineAt" | "timezone">, options: readonly OptionRow[], now: Date): PollStatus {
  return effectiveStatus({ status: poll.status, deadlineAt: poll.deadlineAt, lastOptionStart: lastOptionStart(options, poll.timezone), now });
}

export function optionView(o: OptionRow, zone: string, now: Date): PollOptionView {
  return {
    id: o.id,
    start: o.startsAt?.toISOString() ?? null,
    end: o.endsAt?.toISOString() ?? null,
    allDayDate: o.allDayDate,
    durationMinutes: o.durationMinutes,
    position: o.position,
    createdAt: o.createdAt.toISOString(),
    isPast: startOf(o, zone) <= now.getTime(),
  };
}

/** Options added after the participant's last submit ("?" cells, MP-27). */
export function unknownOptionIds(p: Pick<ParticipantRow, "lastSubmittedAt">, options: readonly OptionRow[], votes: Readonly<Record<string, VoteChoice>>): string[] {
  if (!p.lastSubmittedAt) return [];
  return options.filter((o) => !o.deletedAt && !votes[o.id] && o.createdAt.getTime() > p.lastSubmittedAt!.getTime()).map((o) => o.id);
}

/** More Yes and If need be selections than the current "Max choices per participant" (MP-27 "Over the limit"). */
export function isOverLimit(max: number | null, votes: Readonly<Record<string, VoteChoice>>): boolean {
  if (!max) return false;
  return Object.values(votes).filter((c) => c === "yes" || c === "if_need_be").length > max;
}

/** Count of live participants (the 1,000 participants cap). */
export async function participantCount(db: DbOrTx, pollId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(meetingPollParticipants)
    .where(and(eq(meetingPollParticipants.pollId, pollId), isNull(meetingPollParticipants.deletedAt)));
  return Number(row?.n ?? 0);
}

