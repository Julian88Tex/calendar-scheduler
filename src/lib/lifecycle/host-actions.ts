// Host actions on booked meetings (SPEC CR-10, CR-11, CR-12, CR-14, CR-19, CR-20, VID-12 "Retry"). Each service
// authorizes the actor (manage access to the meeting), takes the host locks for writes that affect availability,
// records the timeline and publishes its domain event in the same transaction; side effects run right after.
import "server-only";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { blockedInvitees, inviteeNoShows, invitees, organizationMemberships, scheduledEventHosts, scheduledEvents, users } from "@/db/schema";
import { lockHostsInTx } from "@/lib/booking";
import { resetConference } from "@/lib/conferencing";
import { isValidEmailAddress } from "@/lib/email";
import { AppError } from "@/lib/errors";
import { eventJobPattern, publishEvent } from "@/lib/events";
import { richTextToPlain, sanitizeRichText } from "@/lib/html";
import messages from "@/lib/i18n/messages/en/lifecycle";
import { isUuid } from "@/lib/ids";
import { enqueueJob, runJobsAfterResponse } from "@/lib/jobs";
import { isOrgAdmin } from "@/lib/authz";
import { now } from "@/lib/time/now";
import { recordActivity } from "./activity";
import { actorUser, assertCanManageMeeting, domainActorOf } from "./authorize";
import { cancelOne } from "./cancel";
import { meetingHostIds } from "./load";
import { JOB_TYPES, meetingMetaOf, withLifecycleMeta, type LifecycleActor, type LifecycleMeetingMeta } from "./types";

const DAY = 86_400_000;
/** CR-12: blocking is offered within 90 days of a booking. */
export const BLOCK_WINDOW_DAYS = 90;
export const NOTES_MAX_CHARS = 10_000;
const NOTES_MAX_HTML = 60_000;

async function loadInviteeAndMeeting(inviteeId: string) {
  if (!isUuid(inviteeId)) throw new AppError("not_found", messages.errors.notFound);
  const db = await getDb();
  const [row] = await db
    .select({ invitee: invitees, meeting: scheduledEvents })
    .from(invitees)
    .innerJoin(scheduledEvents, eq(scheduledEvents.id, invitees.scheduledEventId))
    .where(eq(invitees.id, inviteeId))
    .limit(1);
  if (!row) throw new AppError("not_found", messages.errors.notFound);
  return { db, ...row };
}

// ---------------------------------------------------------------------------------------------------------------
// CR-11 no-shows

/** Marks an invitee as a no-show (after the meeting's start). Idempotent: an existing mark is returned. */
export async function markNoShow(p: { inviteeId: string; actor: LifecycleActor }): Promise<{ noShowId: string }> {
  const { db, meeting } = await loadInviteeAndMeeting(p.inviteeId);
  await assertCanManageMeeting(db, p.actor, meeting.id);
  const at = now();
  const result = await db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invitees).where(eq(invitees.id, p.inviteeId)).for("update").limit(1);
    const [m] = await tx.select().from(scheduledEvents).where(eq(scheduledEvents.id, meeting.id)).limit(1);
    if (!inv || !m) throw new AppError("not_found", messages.errors.notFound);
    if (m.startAt.getTime() > at.getTime()) throw new AppError("validation", messages.errors.noShowBeforeStart);
    if (inv.status !== "active") throw new AppError("validation", messages.errors.noShowCanceled);
    const user = actorUser(p.actor);
    const [created] = await tx
      .insert(inviteeNoShows)
      .values({ inviteeId: inv.id, createdByUserId: user?.id ?? null })
      .onConflictDoNothing({ target: inviteeNoShows.inviteeId })
      .returning({ id: inviteeNoShows.id });
    if (!created) {
      const [existing] = await tx.select({ id: inviteeNoShows.id }).from(inviteeNoShows).where(eq(inviteeNoShows.inviteeId, inv.id)).limit(1);
      return { noShowId: existing!.id, created: false };
    }
    await recordActivity(tx, [{ scheduledEventId: m.id, inviteeId: inv.id, type: "no_show_marked", actor: p.actor, data: { noShowId: created.id } }]);
    await publishEvent(tx, "booking.no_show_created", { inviteeId: inv.id, noShowId: created.id }, { organizationId: m.organizationId, actor: domainActorOf(p.actor) });
    return { noShowId: created.id, created: true };
  });
  if (result.created) runJobsAfterResponse({ types: [eventJobPattern("booking.no_show_created")] });
  return { noShowId: result.noShowId };
}

/** Undo of a no-show mark (no-op when there is none). */
export async function unmarkNoShow(p: { inviteeId: string; actor: LifecycleActor }): Promise<void> {
  const { db, meeting } = await loadInviteeAndMeeting(p.inviteeId);
  await assertCanManageMeeting(db, p.actor, meeting.id);
  const removed = await db.transaction(async (tx) => {
    const [row] = await tx.delete(inviteeNoShows).where(eq(inviteeNoShows.inviteeId, p.inviteeId)).returning({ id: inviteeNoShows.id });
    if (!row) return false;
    await recordActivity(tx, [{ scheduledEventId: meeting.id, inviteeId: p.inviteeId, type: "no_show_unmarked", actor: p.actor, data: { noShowId: row.id } }]);
    await publishEvent(tx, "booking.no_show_deleted", { inviteeId: p.inviteeId, noShowId: row.id }, { organizationId: meeting.organizationId, actor: domainActorOf(p.actor) });
    return true;
  });
  if (removed) runJobsAfterResponse({ types: [eventJobPattern("booking.no_show_deleted")] });
}

// ---------------------------------------------------------------------------------------------------------------
// CR-14 notes

/** Host-only meeting notes (sanitized HTML, up to 10,000 characters of text). Never shown to invitees. */
export async function updateMeetingNotes(p: { scheduledEventId: string; html: string; actor: LifecycleActor }): Promise<void> {
  if (!isUuid(p.scheduledEventId)) throw new AppError("not_found", messages.errors.notFound);
  if (p.actor.type === "invitee") throw new AppError("forbidden", messages.errors.forbidden);
  const db = await getDb();
  await assertCanManageMeeting(db, p.actor, p.scheduledEventId);
  const html = sanitizeRichText(typeof p.html === "string" ? p.html.slice(0, NOTES_MAX_HTML * 2) : "");
  const plain = richTextToPlain(html);
  if (plain.length > NOTES_MAX_CHARS || html.length > NOTES_MAX_HTML) {
    throw new AppError("validation", messages.errors.notesTooLong, { fieldErrors: { html: [messages.errors.notesTooLong] } });
  }
  const at = now();
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(scheduledEvents).where(eq(scheduledEvents.id, p.scheduledEventId)).for("update").limit(1);
    if (!m) throw new AppError("not_found", messages.errors.notFound);
    const empty = !plain.trim();
    await tx
      .update(scheduledEvents)
      .set({ meetingNotesHtml: empty ? null : html, meetingNotesPlain: empty ? null : plain, updatedAt: at })
      .where(eq(scheduledEvents.id, m.id));
    await recordActivity(tx, [{ scheduledEventId: m.id, type: "notes_updated", actor: p.actor, data: { length: plain.length } }]);
    await publishEvent(tx, "meeting.updated", { scheduledEventId: m.id, fields: ["notes"] }, { organizationId: m.organizationId, actor: domainActorOf(p.actor) });
  });
  runJobsAfterResponse({ types: [eventJobPattern("meeting.updated")] });
}

// ---------------------------------------------------------------------------------------------------------------
// CR-20 invitee limit

/** The invitee limit of one booked group slot (at least the active invitee count, at most 9,999). */
export async function setInviteeLimit(p: { scheduledEventId: string; limit: number; actor: LifecycleActor }): Promise<void> {
  if (!isUuid(p.scheduledEventId)) throw new AppError("not_found", messages.errors.notFound);
  if (p.actor.type === "invitee") throw new AppError("forbidden", messages.errors.forbidden);
  const limit = Number(p.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 9999) throw new AppError("validation", messages.errors.limitRange, { fieldErrors: { limit: [messages.errors.limitRange] } });
  const db = await getDb();
  await assertCanManageMeeting(db, p.actor, p.scheduledEventId);
  const hostIds = await meetingHostIds(db, [p.scheduledEventId]);
  const at = now();
  const changed = await db.transaction(async (tx) => {
    await lockHostsInTx(tx, hostIds);
    const [m] = await tx.select().from(scheduledEvents).where(eq(scheduledEvents.id, p.scheduledEventId)).for("update").limit(1);
    if (!m) throw new AppError("not_found", messages.errors.notFound);
    if (m.status !== "active") throw new AppError("conflict", messages.errors.meetingCanceled);
    if (!m.isGroup) throw new AppError("validation", messages.errors.notGroup);
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(invitees)
      .where(and(eq(invitees.scheduledEventId, m.id), eq(invitees.status, "active")));
    if (limit < Number(n)) {
      const msg = messages.errors.limitTooLow.replace("{count}", String(n));
      throw new AppError("validation", msg, { fieldErrors: { limit: [msg] } });
    }
    if (limit === m.inviteesLimit) return false;
    await tx.update(scheduledEvents).set({ inviteesLimit: limit, updatedAt: at }).where(eq(scheduledEvents.id, m.id));
    await recordActivity(tx, [{ scheduledEventId: m.id, type: "invitee_limit_changed", actor: p.actor, data: { from: m.inviteesLimit, to: limit } }]);
    await publishEvent(tx, "meeting.updated", { scheduledEventId: m.id, fields: ["invitee_limit"] }, { organizationId: m.organizationId, actor: domainActorOf(p.actor) });
    return true;
  });
  if (changed) runJobsAfterResponse({ types: [eventJobPattern("meeting.updated")] });
}

// ---------------------------------------------------------------------------------------------------------------
// CR-12 block and unblock

const DOMAIN = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** The host the actor may block for: themselves, or anyone in their organization for org admins. */
async function assertCanBlockFor(actor: LifecycleActor, hostUserId: string): Promise<void> {
  if (actor.type === "system") return;
  if (actor.type === "invitee") throw new AppError("forbidden", messages.errors.forbidden);
  if (!isUuid(hostUserId)) throw new AppError("not_found", messages.errors.notFound);
  if (actor.ctx.user.id === hostUserId) return;
  if (!isOrgAdmin(actor.ctx)) throw new AppError("forbidden", messages.errors.forbidden);
  const db = await getDb();
  const [member] = await db
    .select({ id: organizationMemberships.userId })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.userId, hostUserId), eq(organizationMemberships.organizationId, actor.ctx.orgId)))
    .limit(1);
  if (!member) throw new AppError("forbidden", messages.errors.forbidden);
}

/**
 * Blocks an email (and optionally its whole domain) for a host and cancels their upcoming non-group meetings with that
 * host (standard cancellation emails without reason text, CR-12). With a source invitee, it must be a booking with
 * this host made within the last 90 days.
 */
export async function blockInvitee(p: {
  hostUserId: string;
  actor: LifecycleActor;
  email?: string | null;
  domain?: string | null;
  reason?: string | null;
  sourceInviteeId?: string | null;
}): Promise<{ blockedId: string; canceledInviteeIds: string[] }> {
  await assertCanBlockFor(p.actor, p.hostUserId);
  const db = await getDb();
  const at = now();
  const email = p.email?.trim().toLowerCase() || null;
  const domain = p.domain?.trim().toLowerCase().replace(/^@/, "") || null;
  if (!email && !domain) throw new AppError("validation", messages.errors.blockTarget);
  if (email && !isValidEmailAddress(email)) throw new AppError("validation", messages.errors.blockEmail, { fieldErrors: { email: [messages.errors.blockEmail] } });
  if (domain && !DOMAIN.test(domain)) throw new AppError("validation", messages.errors.blockDomain, { fieldErrors: { domain: [messages.errors.blockDomain] } });
  const [host] = await db.select({ email: users.emailNormalized }).from(users).where(eq(users.id, p.hostUserId)).limit(1);
  if (!host) throw new AppError("not_found", messages.errors.notFound);
  if (email === host.email || (domain && host.email.endsWith(`@${domain}`))) throw new AppError("validation", messages.errors.blockSelf);
  if (p.sourceInviteeId) {
    if (!isUuid(p.sourceInviteeId)) throw new AppError("not_found", messages.errors.notFound);
    const [src] = await db
      .select({ createdAt: invitees.createdAt, meetingId: invitees.scheduledEventId })
      .from(invitees)
      .innerJoin(scheduledEventHosts, and(eq(scheduledEventHosts.scheduledEventId, invitees.scheduledEventId), eq(scheduledEventHosts.userId, p.hostUserId)))
      .where(eq(invitees.id, p.sourceInviteeId))
      .limit(1);
    if (!src) throw new AppError("not_found", messages.errors.notFound);
    if (at.getTime() - src.createdAt.getTime() > BLOCK_WINDOW_DAYS * DAY) throw new AppError("validation", messages.errors.blockWindow);
  }
  const reason = p.reason?.trim().slice(0, 500) || null;
  const ids: string[] = [];
  for (const target of [email ? { emailNormalized: email, email, domain: null } : null, domain ? { emailNormalized: null, email: null, domain } : null]) {
    if (!target) continue;
    await db
      .insert(blockedInvitees)
      .values({ userId: p.hostUserId, ...target, reason, sourceInviteeId: p.sourceInviteeId ?? null })
      .onConflictDoNothing();
    const [row] = await db
      .select({ id: blockedInvitees.id })
      .from(blockedInvitees)
      .where(and(eq(blockedInvitees.userId, p.hostUserId), target.emailNormalized ? eq(blockedInvitees.emailNormalized, target.emailNormalized) : eq(blockedInvitees.domain, target.domain!)))
      .limit(1);
    if (row) ids.push(row.id);
  }
  // Upcoming non-group meetings of the blocked people with this host.
  const matches = await db
    .select({ inviteeId: invitees.id })
    .from(invitees)
    .innerJoin(scheduledEvents, eq(scheduledEvents.id, invitees.scheduledEventId))
    .innerJoin(scheduledEventHosts, and(eq(scheduledEventHosts.scheduledEventId, scheduledEvents.id), eq(scheduledEventHosts.userId, p.hostUserId)))
    .where(
      and(
        eq(invitees.status, "active"),
        eq(scheduledEvents.status, "active"),
        eq(scheduledEvents.isGroup, false),
        gt(scheduledEvents.startAt, at),
        or(email ? eq(invitees.emailNormalized, email) : undefined, domain ? sql`${invitees.emailNormalized} like ${`%@${domain}`}` : undefined),
      ),
    );
  const canceled: string[] = [];
  const [hostRow] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, p.hostUserId)).limit(1);
  for (const { inviteeId } of matches) {
    try {
      await cancelOne({
        inviteeId,
        actor: p.actor,
        kind: "blocked",
        canceler: { type: "host", userId: p.hostUserId, name: hostRow?.name ?? null },
        reason: null,
      });
      canceled.push(inviteeId);
    } catch (e) {
      if (!(e instanceof AppError) || e.code !== "conflict") throw e;
    }
  }
  return { blockedId: ids[0]!, canceledInviteeIds: canceled };
}

export async function unblockInvitee(p: { hostUserId: string; blockedId: string; actor: LifecycleActor }): Promise<void> {
  await assertCanBlockFor(p.actor, p.hostUserId);
  if (!isUuid(p.blockedId)) throw new AppError("not_found", messages.errors.notFound);
  const db = await getDb();
  const rows = await db
    .delete(blockedInvitees)
    .where(and(eq(blockedInvitees.id, p.blockedId), eq(blockedInvitees.userId, p.hostUserId)))
    .returning({ id: blockedInvitees.id });
  if (!rows.length) throw new AppError("not_found", messages.errors.notFound);
}

// ---------------------------------------------------------------------------------------------------------------
// CR-19 reassign (round robin only; docs/SCOPE.md: no round robin event types in this build)

export async function reassignHost(p: { scheduledEventId: string; fromUserId: string; toUserId: string; actor: LifecycleActor; notify?: boolean }): Promise<void> {
  if (!isUuid(p.scheduledEventId)) throw new AppError("not_found", messages.errors.notFound);
  const db = await getDb();
  await assertCanManageMeeting(db, p.actor, p.scheduledEventId);
  throw new AppError("validation", messages.errors.reassignNotRoundRobin);
}

// ---------------------------------------------------------------------------------------------------------------
// VID-12 "Retry"

/** Re-runs provisioning (conference and calendar) of a meeting. */
export async function retryProvisioning(p: { scheduledEventId: string; actor: LifecycleActor }): Promise<void> {
  if (!isUuid(p.scheduledEventId)) throw new AppError("not_found", messages.errors.notFound);
  if (p.actor.type === "invitee") throw new AppError("forbidden", messages.errors.forbidden);
  const db = await getDb();
  await assertCanManageMeeting(db, p.actor, p.scheduledEventId);
  const at = now();
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(scheduledEvents).where(eq(scheduledEvents.id, p.scheduledEventId)).for("update").limit(1);
    if (!m) throw new AppError("not_found", messages.errors.notFound);
    if (m.status !== "active") throw new AppError("conflict", messages.errors.meetingCanceled);
    if (m.endAt.getTime() <= at.getTime()) throw new AppError("validation", messages.errors.retryNotNeeded);
    const meta = meetingMetaOf(m.metadata);
    const location = m.location?.status === "failed" ? resetConference(m.location) : m.location;
    await tx
      .update(scheduledEvents)
      .set({
        location,
        provisionStatus: "pending",
        provisionError: null,
        metadata: withLifecycleMeta<LifecycleMeetingMeta>(m.metadata, {
          // A fallback to email confirmations stays (CAL-12: permanent).
          provision: { startedAt: at.toISOString(), attempts: 0, firstFailureAt: null, conferenceChecks: 0, fallbackAt: meta.provision?.fallbackAt ?? null, lastError: null },
          calendar: {},
        }),
        updatedAt: at,
      })
      .where(eq(scheduledEvents.id, m.id));
    await enqueueJob(tx, {
      type: JOB_TYPES.provisionRetry,
      payload: { scheduledEventId: m.id, op: "calendar" },
      idempotencyKey: `provision:${m.id}:retry:${at.toISOString()}`,
      groupKey: `lifecycle:provision:${m.id}`,
      priority: 10,
    });
  });
  runJobsAfterResponse({ types: [JOB_TYPES.provisionRetry] });
}

/** Meetings of a user (sole host or any host) starting after `at` (lifecycle.cancel_user_meetings). */
export async function futureMeetingsOf(userId: string, scope: "sole_host" | "all_hosted", at: Date, limit: number): Promise<string[]> {
  if (!isUuid(userId)) return [];
  const db = await getDb();
  const rows = await db
    .select({ id: scheduledEvents.id })
    .from(scheduledEvents)
    .innerJoin(scheduledEventHosts, and(eq(scheduledEventHosts.scheduledEventId, scheduledEvents.id), eq(scheduledEventHosts.userId, userId)))
    .where(
      and(
        eq(scheduledEvents.status, "active"),
        gt(scheduledEvents.startAt, at),
        scope === "sole_host"
          ? sql`(select count(*) from ${scheduledEventHosts} h where h.scheduled_event_id = ${scheduledEvents.id}) = 1`
          : undefined,
      ),
    )
    .orderBy(scheduledEvents.startAt)
    .limit(limit);
  return rows.map((r) => r.id);
}
