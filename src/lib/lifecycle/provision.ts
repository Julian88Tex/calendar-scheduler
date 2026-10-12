// Provisioning of a booked meeting (SPEC CAL-11, CAL-12, VID-07, VID-12, VID-13, VID-14, MP-19; ARCHITECTURE 9 and 12).
//
// provisionMeeting(id) brings the provider side of one meeting up to date, idempotently (every booking, join,
// reschedule, move, cancellation of a group invitee, limit change and retry calls it; an identical write is skipped):
//
//   1. Conference: a queued conference ("processing", not requested yet) is created through conferencing
//      createConference for the organizer (VID-13 rules); Google Meet comes from the organizer's calendar event.
//   2. Organizer calendar event through calendars.upsertLinkedEvent: calendar invitation mode puts the invitee, guests
//      and co-hosts on it as attendees (Google sendUpdates=all); email confirmation mode writes no attendees. One
//      provider event per group slot (no attendees, the invitee list in the description), patched on every change.
//      The result is stored on the meeting: provider iCal UID (provider_ical_uid), event link (invitation_url) and the
//      Meet join link in the location.
//   3. Co-hosts in email confirmation mode get a copy on their own destination calendar.
//   4. Failures: transient errors retry (lifecycle.provision_retry, 1, 2, 4... minutes); in calendar invitation mode,
//      after 3 failed attempts, 10 minutes after the first failure, a permanent failure or no calendar to invite
//      from, the meeting switches PERMANENTLY to email confirmation mode (CAL-12 fallback, recorded on the timeline):
//      the invitee gets the app's confirmation with the app UID, the host a notice, and later writes never add
//      attendees. A Meet link that Google is still creating is re-read every 20 seconds for 2 minutes; after the
//      final failure the host gets "We couldn't create a {Provider} link..." (VID-12).
//
// Notifications are sent by notify.ts once provisioning says the meeting is ready (the Meet link is known, or the
// conference failed, or a minute passed): so confirmations carry the join link like Calendly's.
import "server-only";
import { and, eq } from "drizzle-orm";
import type { DB, DbOrTx } from "@/db";
import { scheduledEvents } from "@/db/schema";
import type { MeetingSettingsSnapshot, ResolvedLocation } from "@/db/types";
import { upsertLinkedEvent, type UpsertLinkedEventResult } from "@/lib/calendars";
import {
  applyLinkedEventConference,
  calendarConferenceFor,
  createConference,
  isConferenceKind,
  isConferencePending,
  refreshMeetingConference,
  resolveConferenceOrganizer,
  type ConferenceKind,
} from "@/lib/conferencing";
import { enqueueJob } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { buildMeetingTemplateContext } from "@/lib/template-context";
import { now } from "@/lib/time/now";
import { recordActivity } from "./activity";
import { calendarEventInput, singleInviteeOf, writeFingerprint, type CalendarEventInput } from "./calendar-event";
import { activeInvitees, loadMeeting, type MeetingBundle } from "./load";
import { JOB_TYPES, meetingMetaOf, withLifecycleMeta, type HostCalendarState, type LifecycleMeetingMeta } from "./types";

const MIN = 60_000;
/** CAL-12: calendar invitation attempts before falling back to email confirmations. */
export const FALLBACK_ATTEMPTS = 3;
export const FALLBACK_WINDOW_MS = 10 * MIN;
/** Organizer calendar write attempts before the meeting is flagged "Calendar sync failed" (CAL-15). */
export const MAX_CALENDAR_ATTEMPTS = 8;
/** Pending Meet link re-reads (every 20 seconds, 2 minutes). */
export const CONFERENCE_CHECK_DELAY_MS = 20_000;
export const MAX_CONFERENCE_CHECKS = 6;
/** Notifications wait at most this long for a Meet link. */
export const NOTIFY_DEFER_MS = MIN;

export type ProvisionOutcome = {
  active: boolean;
  calendar: "synced" | "pending" | "failed" | "skipped_no_calendar" | "unchanged" | "skipped";
  conference: "none" | "pushed" | "pending" | "failed";
  fellBack: boolean;
  /** Notifications may go out now. */
  ready: boolean;
};

export type ProvisionOptions = {
  /** CR-17: the provider event already shows the change (calendar sync): no provider write. */
  skipProviderWrite?: boolean;
  /** Rewrite even when nothing changed (Retry). */
  force?: boolean;
  /** The organizer's linked event after a reschedule repoint (reuse the same provider event). */
  existingLinkedEventId?: string | null;
};

const generationOf = (b: { meeting: { metadata: Record<string, unknown> } }) => meetingMetaOf(b.meeting.metadata).provision?.startedAt ?? "0";

const retryDelay = (attempts: number) => Math.min(MIN * 2 ** Math.max(0, attempts - 1), 60 * MIN);

/** Loads the meeting row FOR UPDATE and applies a change when it is still active (and returns the fresh row). */
async function updateMeetingRow(
  db: DB,
  id: string,
  change: (row: typeof scheduledEvents.$inferSelect) => Partial<typeof scheduledEvents.$inferInsert> | null,
): Promise<typeof scheduledEvents.$inferSelect | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(scheduledEvents).where(eq(scheduledEvents.id, id)).for("update").limit(1);
    if (!row) return null;
    const set = change(row);
    if (!set) return row;
    const [next] = await tx.update(scheduledEvents).set({ ...set, updatedAt: now() }).where(eq(scheduledEvents.id, id)).returning();
    return next ?? row;
  });
}

/** Merges a patch into metadata.lifecycle (and provision) of a meeting row. */
function metaPatch(row: { metadata: Record<string, unknown> }, patch: (m: LifecycleMeetingMeta) => LifecycleMeetingMeta): Record<string, unknown> {
  const current = meetingMetaOf(row.metadata);
  return withLifecycleMeta<LifecycleMeetingMeta>(row.metadata, patch(current));
}

/** One retry per provisioning generation (provision.startedAt, reset by Retry) and attempt number. */
async function scheduleRetry(db: DbOrTx, scheduledEventId: string, op: "calendar" | "conference", delayMs: number, key: string): Promise<void> {
  await enqueueJob(db, {
    type: JOB_TYPES.provisionRetry,
    payload: { scheduledEventId, op },
    runAt: new Date(now().getTime() + delayMs),
    idempotencyKey: `provision:${scheduledEventId}:${op}:${key}`,
    groupKey: `lifecycle:provision:${scheduledEventId}`,
    maxAttempts: 5,
  });
}

/** The conference of a queued location, created for the meeting's organizer (VID-12, VID-13). */
async function ensureConference(b: MeetingBundle): Promise<ResolvedLocation> {
  const loc = b.meeting.location;
  if (!loc?.kind || !isConferenceKind(loc.kind) || loc.status !== "processing" || loc.data?.provider) return loc;
  const organizerUserId = resolveConferenceOrganizer({
    organizerUserId: b.meeting.organizerUserId,
    hosts: b.hosts.map((h) => ({ userId: h.userId, poolId: h.poolId })),
    preferredOrganizerUserId: b.meeting.organizerUserId,
  });
  try {
    return await createConference({
      kind: loc.kind as ConferenceKind,
      organizerUserId,
      scheduledEventId: b.meeting.id,
      title: b.meeting.name,
      start: b.meeting.startAt,
      end: b.meeting.endAt,
      timeZone: b.organizer?.timezone ?? "UTC",
      inviteeEmails: activeInvitees(b).map((i) => i.email),
      location: loc,
      eventTypeId: b.meeting.eventTypeId,
    });
  } catch (e) {
    log.warn("lifecycle.create_conference_failed", { scheduledEventId: b.meeting.id, error: e });
    return loc; // still queued: the retry tries again
  }
}

function conferenceStateOf(loc: ResolvedLocation | null | undefined): ProvisionOutcome["conference"] {
  if (!loc?.kind || !isConferenceKind(loc.kind)) return "none";
  if (loc.status === "failed") return "failed";
  if (loc.status === "pushed" && loc.joinUrl) return "pushed";
  return "pending";
}

async function hostWrite(
  b: MeetingBundle,
  hostUserId: string,
  mode: MeetingSettingsSnapshot["notificationMode"],
  opts: ProvisionOptions,
): Promise<{ input: CalendarEventInput; fingerprint: string; result: UpsertLinkedEventResult | null; previous: HostCalendarState | undefined }> {
  const one = singleInviteeOf(b);
  const ctx = await buildMeetingTemplateContext({
    scheduledEventId: b.meeting.id,
    inviteeId: one?.id ?? null,
    recipient: "host",
    hostUserId,
    locale: "en",
  });
  const input = calendarEventInput(b, { hostUserId, mode, ctx });
  const fingerprint = writeFingerprint(input, { mode, hostUserId });
  const previous = meetingMetaOf(b.meeting.metadata).calendar?.[hostUserId];
  if (!opts.force && previous?.status === "synced" && previous.fingerprint === fingerprint) return { input, fingerprint, result: null, previous };
  const existing = hostUserId === b.meeting.organizerUserId ? (opts.existingLinkedEventId ?? previous?.linkedEventId ?? undefined) : (previous?.linkedEventId ?? undefined);
  const result = await upsertLinkedEvent({
    userId: hostUserId,
    purpose: "meeting",
    scheduledEventId: b.meeting.id,
    event: input,
    existingLinkedEventId: existing || undefined,
  });
  return { input, fingerprint, result, previous };
}

/** CAL-12 fallback: switches the meeting permanently to email confirmations. Returns true when it switched now. */
export async function fallbackToEmailConfirmation(db: DB, scheduledEventId: string, reason: string): Promise<boolean> {
  let switched = false;
  const at = now().toISOString();
  await updateMeetingRow(db, scheduledEventId, (row) => {
    if (row.status !== "active" || row.settingsSnapshot.notificationMode !== "calendar_invitation") return null;
    switched = true;
    return {
      settingsSnapshot: { ...row.settingsSnapshot, notificationMode: "email_confirmation" },
      metadata: metaPatch(row, (m) => ({ ...m, provision: { ...m.provision, fallbackAt: at } })),
    };
  });
  if (switched) {
    await recordActivity(db, [{ scheduledEventId, type: "notification_fallback", data: { reason: reason.slice(0, 300) } }]);
    log.warn("lifecycle.notification_fallback", { scheduledEventId, reason });
  }
  return switched;
}

/** See the file header. Never throws for provider failures (they are retried); database errors propagate. */
export async function provisionMeeting(db: DB, scheduledEventId: string, opts: ProvisionOptions = {}): Promise<ProvisionOutcome> {
  const loaded = await loadMeeting(db, scheduledEventId);
  if (!loaded || loaded.meeting.status !== "active") {
    return { active: false, calendar: "skipped", conference: "none", fellBack: false, ready: false };
  }
  let b = loaded;
  const at = now();
  const meta0 = meetingMetaOf(b.meeting.metadata);
  if (!meta0.provision?.startedAt) {
    const row = await updateMeetingRow(db, scheduledEventId, (r) => ({
      metadata: metaPatch(r, (m) => ({ ...m, provision: { ...m.provision, startedAt: m.provision?.startedAt ?? at.toISOString() } })),
    }));
    if (row) b = { ...b, meeting: row };
  }

  // 1. Conference.
  const before = b.meeting.location;
  let location = await ensureConference(b);
  if (location !== before) b = { ...b, meeting: { ...b.meeting, location } };

  // 2. Organizer calendar event (CR-17 moves skip it: the provider event already shows the new time).
  const mode = b.meeting.settingsSnapshot.notificationMode;
  let calendar: ProvisionOutcome["calendar"] = "skipped";
  let fellBack = false;
  const writes: Record<string, HostCalendarState> = {};
  let organizerResult: UpsertLinkedEventResult | null = null;
  if (!opts.skipProviderWrite) {
    try {
      const w = await hostWrite(b, b.meeting.organizerUserId, mode, opts);
      organizerResult = w.result;
      if (!w.result) {
        calendar = "unchanged";
      } else {
        calendar = w.result.status;
        writes[b.meeting.organizerUserId] = {
          linkedEventId: w.result.linkedEventId || w.previous?.linkedEventId || null,
          fingerprint: w.result.status === "synced" ? w.fingerprint : "",
          status: w.result.status,
          at: at.toISOString(),
        };
      }
    } catch (e) {
      // Unexpected (not a provider failure): treat like a transient failure so the booking still notifies.
      log.error("lifecycle.calendar_write_error", { scheduledEventId, error: e });
      calendar = "pending";
      organizerResult = { status: "pending", linkedEventId: "", externalId: null };
    }
  }

  // Fold the calendar result into a calendar native conference (Meet).
  if (organizerResult && location?.kind && calendarConferenceFor(location.kind) && location.status !== "failed") {
    location = applyLinkedEventConference(location, organizerResult);
  }

  // 3. Copies for co-hosts (email confirmation mode, and group slots, which are always email mode).
  for (const h of b.hosts) {
    if (opts.skipProviderWrite || h.userId === b.meeting.organizerUserId || !h.isActive) continue;
    if (mode === "calendar_invitation" && !b.meeting.isGroup) continue; // they are attendees of the organizer's event
    try {
      const w = await hostWrite({ ...b, meeting: { ...b.meeting, location } }, h.userId, "email_confirmation", opts);
      if (w.result) {
        writes[h.userId] = { linkedEventId: w.result.linkedEventId || null, fingerprint: w.result.status === "synced" ? w.fingerprint : "", status: w.result.status, at: at.toISOString() };
      }
    } catch (e) {
      log.warn("lifecycle.cohost_calendar_write_failed", { scheduledEventId, userId: h.userId, error: e });
    }
  }

  // 4. Store the outcome.
  const failed = calendar === "pending" || calendar === "failed";
  const prevAttempts = meta0.provision?.attempts ?? 0;
  const attempts = failed ? prevAttempts + 1 : calendar === "synced" ? 0 : prevAttempts;
  const firstFailureAt = failed ? (meta0.provision?.firstFailureAt ?? at.toISOString()) : calendar === "synced" ? null : (meta0.provision?.firstFailureAt ?? null);
  const errorText = failed ? (calendar === "failed" ? "Calendar sync failed" : "Calendar temporarily unavailable") : null;
  const cohostIssue = Object.entries(writes).some(([uid, w]) => uid !== b.meeting.organizerUserId && w.status !== "synced" && w.status !== "skipped_no_calendar");
  const exhausted = failed && (calendar === "failed" || attempts >= MAX_CALENDAR_ATTEMPTS);
  // The calendar event never got written: a Meet that depends on it will not exist either (VID-12 final failure).
  if (exhausted && location?.kind && calendarConferenceFor(location.kind) && isConferencePending(location)) {
    location = { ...location, status: "failed", joinUrl: null, location: null, error: "calendar_write_failed" };
  }
  const conference = conferenceStateOf(location);
  const provisionStatus: (typeof scheduledEvents.$inferSelect)["provisionStatus"] =
    exhausted ? "failed" : failed ? "pending" : conference === "failed" || cohostIssue ? "partial" : conference === "pending" ? "pending" : "done";
  const prevLocation = b.meeting.location;
  const row = await updateMeetingRow(db, scheduledEventId, (r) => {
    if (r.status !== "active") return null;
    // A reschedule or another write that changed the location meanwhile wins (same choice of location only).
    const sameChoice = r.location?.kind === prevLocation?.kind && r.location?.configId === prevLocation?.configId;
    const nextLocation = sameChoice ? location : r.location;
    return {
      location: nextLocation,
      providerIcalUid: organizerResult?.status === "synced" && organizerResult.icalUid ? organizerResult.icalUid : r.providerIcalUid,
      invitationUrl: organizerResult?.status === "synced" && organizerResult.htmlLink ? organizerResult.htmlLink : r.invitationUrl,
      provisionStatus,
      provisionError: provisionStatus === "done" ? null : (errorText ?? (conference === "failed" ? (nextLocation?.error ?? "conference_failed") : r.provisionError)),
      provisionedAt: provisionStatus === "done" || provisionStatus === "partial" ? at : r.provisionedAt,
      metadata: metaPatch(r, (m) => ({
        ...m,
        calendar: { ...(m.calendar ?? {}), ...writes },
        provision: { ...m.provision, attempts, firstFailureAt, lastError: errorText ?? m.provision?.lastError ?? null },
      })),
    };
  });
  if (!row) return { active: false, calendar, conference, fellBack, ready: false };
  b = { ...b, meeting: row };

  // Timeline.
  const timeline: Parameters<typeof recordActivity>[1] = [];
  if (calendar === "synced" && organizerResult) timeline.push({ scheduledEventId, type: "calendar_synced", data: { linkedEventId: organizerResult.linkedEventId, mode } });
  if (exhausted) timeline.push({ scheduledEventId, type: "calendar_failed", data: { attempts, status: calendar } });
  const prevConference = conferenceStateOf(prevLocation);
  if (conference === "pushed" && prevConference !== "pushed") timeline.push({ scheduledEventId, type: "conference_created", data: { kind: location?.kind } });
  if (conference === "failed" && prevConference !== "failed") timeline.push({ scheduledEventId, type: "conference_failed", data: { kind: location?.kind, error: location?.error } });
  await recordActivity(db, timeline);

  // CAL-12 fallback and retries.
  if (failed || calendar === "skipped_no_calendar") {
    const elapsed = firstFailureAt ? at.getTime() - Date.parse(firstFailureAt) : 0;
    const invitation = b.meeting.settingsSnapshot.notificationMode === "calendar_invitation";
    if (invitation && (calendar === "skipped_no_calendar" || calendar === "failed" || attempts >= FALLBACK_ATTEMPTS || elapsed >= FALLBACK_WINDOW_MS)) {
      fellBack = await fallbackToEmailConfirmation(
        db,
        scheduledEventId,
        calendar === "skipped_no_calendar" ? "no_calendar" : calendar === "failed" ? "calendar_failed" : `failed_attempts:${attempts}`,
      );
      if (fellBack) {
        const fresh = await loadMeeting(db, scheduledEventId);
        if (fresh) b = fresh;
      }
    }
    if (calendar === "pending" && !exhausted) {
      await scheduleRetry(db, scheduledEventId, "calendar", retryDelay(attempts), `${generationOf(b)}:${firstFailureAt}:${attempts}`);
    }
  }
  if (conference === "pending" && !failed && calendar !== "skipped") {
    const checks = meetingMetaOf(b.meeting.metadata).provision?.conferenceChecks ?? 0;
    await scheduleRetry(db, scheduledEventId, "conference", CONFERENCE_CHECK_DELAY_MS, `${generationOf(b)}:${checks + 1}`);
  }

  const startedAt = Date.parse(meetingMetaOf(b.meeting.metadata).provision?.startedAt ?? at.toISOString());
  const waiting = isConferencePending(b.meeting.location) && at.getTime() - startedAt < NOTIFY_DEFER_MS;
  return { active: true, calendar, conference: conferenceStateOf(b.meeting.location), fellBack, ready: !waiting };
}

/**
 * The conference step of lifecycle.provision_retry: re-reads a pending Meet link, gives up after 2 minutes (the
 * location becomes failed). Returns whether notifications may go out now.
 */
export async function checkPendingConference(db: DB, scheduledEventId: string): Promise<{ ready: boolean; conference: ProvisionOutcome["conference"] }> {
  const [row] = await db.select().from(scheduledEvents).where(eq(scheduledEvents.id, scheduledEventId)).limit(1);
  if (!row || row.status !== "active") return { ready: false, conference: "none" };
  if (!isConferencePending(row.location)) return { ready: true, conference: conferenceStateOf(row.location) };
  const refreshed = await refreshMeetingConference(scheduledEventId);
  const at = now();
  if (refreshed && !isConferencePending(refreshed)) {
    const state = conferenceStateOf(refreshed);
    await db
      .update(scheduledEvents)
      .set({ provisionStatus: state === "pushed" ? "done" : "partial", provisionedAt: at, provisionError: state === "pushed" ? null : (refreshed.error ?? "conference_failed"), updatedAt: at })
      .where(and(eq(scheduledEvents.id, scheduledEventId), eq(scheduledEvents.status, "active")));
    await recordActivity(db, [{ scheduledEventId, type: state === "pushed" ? "conference_created" : "conference_failed", data: { kind: refreshed.kind } }]);
    return { ready: true, conference: state };
  }
  const checks = (meetingMetaOf(row.metadata).provision?.conferenceChecks ?? 0) + 1;
  const giveUp = checks >= MAX_CONFERENCE_CHECKS;
  const next = await updateMeetingRow(db, scheduledEventId, (r) => {
    if (r.status !== "active") return null;
    const loc = r.location;
    const failedLoc: ResolvedLocation | null = giveUp && isConferencePending(loc) ? { ...loc, status: "failed", joinUrl: null, location: null, error: "conference_not_created" } : null;
    return {
      ...(failedLoc ? { location: failedLoc, provisionStatus: "partial" as const, provisionError: "conference_not_created" } : {}),
      metadata: metaPatch(r, (m) => ({ ...m, provision: { ...m.provision, conferenceChecks: checks } })),
    };
  });
  if (giveUp) {
    await recordActivity(db, [{ scheduledEventId, type: "conference_failed", data: { kind: row.location?.kind, error: "conference_not_created" } }]);
    return { ready: true, conference: "failed" };
  }
  await scheduleRetry(db, scheduledEventId, "conference", CONFERENCE_CHECK_DELAY_MS, `${generationOf({ meeting: next ?? row })}:${checks + 1}`);
  const startedAt = Date.parse(meetingMetaOf(next?.metadata ?? row.metadata).provision?.startedAt ?? at.toISOString());
  return { ready: at.getTime() - startedAt >= NOTIFY_DEFER_MS, conference: "pending" };
}
