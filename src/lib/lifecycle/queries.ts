// Read model of the invitee cancel and reschedule pages (SPEC CR-02, CR-03, CR-08, SCH-23; lifecycle-ui renders it):
// the capability id resolved along the reschedule chain to the active invitee (links in older emails keep working),
// the meeting with its event type and organizer, and the decisions of policy.ts for this moment.
import "server-only";
import { getDb } from "@/db";
import { now } from "@/lib/time/now";
import { resolveActiveInviteeChain } from "./chain";
import { loadMeeting, type InviteeRow, type MeetingBundle } from "./load";
import { inviteeCancelBlock, inviteeRescheduleBlock, isRebookable, type ChangeBlock } from "./policy";

export type InviteeChangeContext = {
  /** The id from the URL. */
  requestedInviteeId: string;
  /** The invitee the page is about (the end of the reschedule chain). */
  invitee: InviteeRow;
  /** True when the URL's invitee was rescheduled: pages redirect to the active invitee's URL. */
  moved: boolean;
  meeting: MeetingBundle;
  host: { userId: string; name: string; email: string } | null;
  /** Why canceling online is not possible now, or null. */
  cancelBlock: ChangeBlock | null;
  /** Why rescheduling online is not possible now, or null. */
  rescheduleBlock: ChangeBlock | null;
  /** CR-08: the host asked for a new time; picking one books again. */
  rebook: boolean;
  requireCancelReason: boolean;
  cancellationPolicy: string | null;
};

/** null when the invitee does not exist (or the id is not a uuid). */
export async function getInviteeChangeContext(inviteeId: string, opts: { now?: Date } = {}): Promise<InviteeChangeContext | null> {
  const db = await getDb();
  const invitee = await resolveActiveInviteeChain(inviteeId, db);
  if (!invitee) return null;
  const meeting = await loadMeeting(db, invitee.scheduledEventId);
  if (!meeting) return null;
  const at = opts.now ?? now();
  const m = meeting.meeting;
  const host = meeting.organizer ? { userId: meeting.organizer.userId, name: meeting.organizer.name, email: meeting.organizer.email } : null;
  const subject = {
    invitee,
    meeting: { status: m.status, startAt: m.startAt, source: m.source, changeCutoffMinutes: m.settingsSnapshot?.changeCutoffMinutes ?? null },
    eventType: meeting.eventType,
    host: { name: host?.name ?? "", email: host?.email ?? null },
    now: at,
  };
  return {
    requestedInviteeId: inviteeId,
    invitee,
    moved: invitee.id !== inviteeId,
    meeting,
    host,
    cancelBlock: inviteeCancelBlock(subject),
    rescheduleBlock: inviteeRescheduleBlock(subject),
    rebook: isRebookable(subject),
    requireCancelReason: m.settingsSnapshot?.requireCancelReason === true,
    cancellationPolicy: m.settingsSnapshot?.cancellationPolicy?.trim() || null,
  };
}
