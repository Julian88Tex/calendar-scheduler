"use server";
// Server Actions of the host meeting dialogs (SPEC CR-06, CR-07, CR-08, CR-11, CR-14; ARCHITECTURE 26 rule 3): thin
// wrappers that parse, authenticate (signed-in users only), call lifecycle-core with the user actor (each service
// authorizes manage access to the meeting itself) and revalidate the Meetings page. Shared by meetings-dashboard and
// any other page that mounts the dialogs, so they live next to the components.
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { invitees, scheduledEvents } from "@/db/schema";
import { runAction } from "@/lib/actions";
import { assertAccess, meetingAccess } from "@/lib/authz";
import { getAvailability, groupSlotsByLocalDate, loadEventType, localDateRange, type SlotDays } from "@/lib/booking";
import { AppError } from "@/lib/errors";
import lifecycleMessages from "@/lib/i18n/messages/en/lifecycle";
import { cancelScheduledEvent, markNoShow, requestReschedule, rescheduleInvitee, unmarkNoShow, updateMeetingNotes } from "@/lib/lifecycle";
import { wallClockToUtc } from "@/lib/time/luxon";
import { now } from "@/lib/time/now";
import { isValidTimeZone } from "@/lib/time/zones";

const MEETINGS_PATH = "/app/meetings";
const MAX_MESSAGE = 2000;
const NOT_FOUND = lifecycleMessages.errors.notFound;

function refresh() {
  try {
    revalidatePath(MEETINGS_PATH);
  } catch {
    // Outside a request (tests): nothing to revalidate.
  }
}

const message = z.string().max(MAX_MESSAGE, lifecycleMessages.changes.messageTooLong).optional().nullable();

// ---------------------------------------------------------------------------------------------------------------
// CR-06 host cancel

const CancelMeetingInput = z.object({ scheduledEventId: z.uuid(), message });

/** "Yes, cancel": cancels the whole meeting; the message reaches the invitees as "Reason: ...". */
export async function hostCancelMeetingAction(raw: unknown) {
  return runAction(CancelMeetingInput, raw, async (input, { actor }) => {
    const r = await cancelScheduledEvent({ scheduledEventId: input.scheduledEventId, actor: { type: "user", ctx: actor }, reason: input.message?.trim() || null });
    refresh();
    return { canceledInviteeIds: r.canceledInviteeIds };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// CR-07 "Reschedule meeting now"

const SlotsInput = z.object({
  inviteeId: z.uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month."),
  zone: z.string().trim().min(1).max(64),
});

export type HostSlotsResult = { timeZone: string; durationMinutes: number; days: SlotDays; windowEnd: string | null };

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

async function inviteeMeeting(inviteeId: string) {
  const db = await getDb();
  const [row] = await db
    .select({ eventTypeId: invitees.eventTypeId, scheduledEventId: invitees.scheduledEventId, durationMinutes: scheduledEvents.durationMinutes })
    .from(invitees)
    .innerJoin(scheduledEvents, eq(scheduledEvents.id, invitees.scheduledEventId))
    .where(eq(invitees.id, inviteeId))
    .limit(1);
  return { db, row: row ?? null };
}

/** The meeting's event type availability for one month in a zone, the meeting itself ignored (SCH-24). */
export async function hostRescheduleSlotsAction(raw: unknown) {
  return runAction(SlotsInput, raw, async (input, { actor }): Promise<HostSlotsResult> => {
    if (!isValidTimeZone(input.zone)) throw new AppError("validation", "Choose a valid time zone.", { fieldErrors: { zone: ["Choose a valid time zone."] } });
    const { db, row } = await inviteeMeeting(input.inviteeId);
    if (!row) throw new AppError("not_found", NOT_FOUND);
    const access = await meetingAccess(actor, row.scheduledEventId, db);
    if (!access) throw new AppError("not_found", NOT_FOUND);
    assertAccess(access === "manage", lifecycleMessages.errors.forbidden);
    const eventType = await loadEventType(row.eventTypeId, db);
    if (!eventType) throw new AppError("validation", lifecycleMessages.changes.notReschedulable);
    const bounds = monthBounds(input.month);
    const range = localDateRange(bounds.start, bounds.end, input.zone);
    const r = await getAvailability({
      target: { kind: "event_type", eventType },
      start: range.start,
      end: range.end,
      durationMinutes: row.durationMinutes,
      now: now(),
      ignoreInviteeId: input.inviteeId,
      freshness: "page",
    });
    return {
      timeZone: input.zone,
      durationMinutes: row.durationMinutes,
      days: groupSlotsByLocalDate(r.slots, input.zone),
      windowEnd: r.windowEnd === null ? null : new Date(r.windowEnd).toISOString(),
    };
  });
}

const RescheduleNowInput = z
  .object({
    inviteeId: z.uuid(),
    /** A slot start (ISO UTC). */
    start: z.string().trim().min(1).max(40).optional(),
    /** Override available times: a local date and start minute in `zone`. */
    date: z.iso.date().optional(),
    minutes: z.number().int().min(0).max(1439).optional(),
    zone: z.string().trim().max(64).optional(),
    override: z.boolean().optional(),
    clientRequestId: z.string().trim().min(8).max(100),
  })
  .refine((v) => Boolean(v.start) || (v.date !== undefined && v.minutes !== undefined && Boolean(v.zone)), {
    message: "Choose a date and a start time.",
    path: ["start"],
  });

/** Moves the meeting to the chosen time (a new booking linked to the old one, CR-04); the invitee gets one email. */
export async function hostRescheduleNowAction(raw: unknown) {
  return runAction(RescheduleNowInput, raw, async (input, { actor }) => {
    let start = input.start;
    if (!start) {
      if (!input.zone || !isValidTimeZone(input.zone)) throw new AppError("validation", "Choose a valid time zone.");
      start = wallClockToUtc(input.date!, input.minutes!, input.zone).toISOString();
    }
    const r = await rescheduleInvitee(
      { inviteeId: input.inviteeId, start, actor: { type: "user", ctx: actor }, host: { overrideAvailability: input.override === true }, clientRequestId: input.clientRequestId },
      {},
    );
    if (!r.ok) {
      const code = r.code === "slot_unavailable" || r.code === "already_booked" ? "conflict" : r.code === "not_found" ? "not_found" : "validation";
      throw new AppError(code, r.message, r.fieldErrors ? { fieldErrors: r.fieldErrors } : {});
    }
    refresh();
    return { inviteeId: r.inviteeId, scheduledEventId: r.scheduledEventId };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// CR-08 "Share new times to meet"

const RequestInput = z.object({
  inviteeId: z.uuid(),
  message,
  reminderDays: z.union([z.literal(1), z.literal(3), z.literal(7)]).optional().nullable(),
});

export async function hostRequestRescheduleAction(raw: unknown) {
  return runAction(RequestInput, raw, async (input, { actor }) => {
    await requestReschedule({ inviteeId: input.inviteeId, actor: { type: "user", ctx: actor }, message: input.message?.trim() || null, reminderDays: input.reminderDays ?? null });
    refresh();
    return { inviteeId: input.inviteeId };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// CR-11 no-shows

const NoShowInput = z.object({ inviteeId: z.uuid(), noShow: z.boolean() });

export async function setNoShowAction(raw: unknown) {
  return runAction(NoShowInput, raw, async (input, { actor }) => {
    if (input.noShow) await markNoShow({ inviteeId: input.inviteeId, actor: { type: "user", ctx: actor } });
    else await unmarkNoShow({ inviteeId: input.inviteeId, actor: { type: "user", ctx: actor } });
    refresh();
    return { noShow: input.noShow };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// CR-14 notes

const NotesInput = z.object({ scheduledEventId: z.uuid(), html: z.string().max(120_000, lifecycleMessages.errors.notesTooLong) });

/**
 * Saves the notes (lifecycle-core authorizes and sanitizes) and returns them as stored, so the editor shows exactly the
 * sanitized HTML the Meetings page will render (null when emptied).
 */
export async function saveMeetingNotesAction(raw: unknown) {
  return runAction(NotesInput, raw, async (input, { actor, db }) => {
    await updateMeetingNotes({ scheduledEventId: input.scheduledEventId, html: input.html, actor: { type: "user", ctx: actor } });
    const [row] = await db.select({ html: scheduledEvents.meetingNotesHtml }).from(scheduledEvents).where(eq(scheduledEvents.id, input.scheduledEventId)).limit(1);
    refresh();
    return { scheduledEventId: input.scheduledEventId, html: row?.html ?? null };
  });
}
