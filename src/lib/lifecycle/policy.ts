// Invitee change rules (SPEC CR-02, CR-03, CR-08, SCH-23, MP-21; docs/SCOPE.md priority 6). Pure and client safe, so
// the public cancel and reschedule pages (lifecycle-ui) and the services apply exactly the same rules:
//
//   cancel      canceled (or rescheduled away) -> "This event has already been canceled."
//               start time passed              -> "This event has already occurred."
//               cutoff window (SCH-23)         -> "This meeting can no longer be changed online. Please contact {host}."
//               event type off or deleted      -> still allowed (CR-02)
//   reschedule  the same checks, plus: one-off and poll meetings and event types that are off or deleted
//               -> "This event can no longer be rescheduled." (cancel keeps working)
//               a request to reschedule (CR-08) keeps a canceled invitee reschedulable for 30 days ("rebook")
//
// Hosts are never limited by the cutoff (they may also move past meetings).
import messages from "@/lib/i18n/messages/en/lifecycle";
import { REQUEST_RESCHEDULE_VALID_DAYS, inviteeMetaOf } from "./types";

const DAY = 86_400_000;

export type ChangeBlockReason = "canceled" | "rescheduled" | "occurred" | "cutoff" | "not_reschedulable";

export type ChangeBlock = { reason: ChangeBlockReason; message: string; hostName?: string; hostEmail?: string | null };

export type ChangeSubject = {
  invitee: { status: "active" | "canceled"; rescheduled: boolean; newInviteeId: string | null; metadata?: Record<string, unknown> | null };
  meeting: { status: "active" | "canceled"; startAt: Date; source: string; changeCutoffMinutes: number | null };
  eventType: { active: boolean; deletedAt: Date | null; type?: string | null } | null;
  host: { name: string; email?: string | null };
  now: Date;
};

const cutoffBlock = (s: ChangeSubject): ChangeBlock | null => {
  const minutes = s.meeting.changeCutoffMinutes;
  if (!minutes || minutes <= 0) return null;
  if (s.meeting.startAt.getTime() - s.now.getTime() > minutes * 60_000) return null;
  return {
    reason: "cutoff",
    message: messages.changes.cutoff.replace("{hostName}", s.host.name),
    hostName: s.host.name,
    hostEmail: s.host.email ?? null,
  };
};

/** Why the invitee can't cancel online now, or null (SCH-23, CR-02). */
export function inviteeCancelBlock(s: ChangeSubject): ChangeBlock | null {
  if (s.invitee.status !== "active" || s.meeting.status !== "active") {
    return s.invitee.rescheduled || s.invitee.newInviteeId
      ? { reason: "rescheduled", message: messages.changes.rescheduled }
      : { reason: "canceled", message: messages.changes.canceled };
  }
  if (s.meeting.startAt.getTime() <= s.now.getTime()) return { reason: "occurred", message: messages.changes.occurred };
  return cutoffBlock(s);
}

/** True when a host's "Share new times to meet" (CR-08) still lets this canceled invitee pick a new time. */
export function isRebookable(s: Pick<ChangeSubject, "invitee" | "now">): boolean {
  if (s.invitee.status !== "canceled" || s.invitee.newInviteeId) return false;
  const request = inviteeMetaOf(s.invitee.metadata).requestReschedule;
  if (!request?.requestedAt || request.rebookedInviteeId) return false;
  const at = Date.parse(request.requestedAt);
  return Number.isFinite(at) && s.now.getTime() - at <= REQUEST_RESCHEDULE_VALID_DAYS * DAY;
}

/** Why the invitee can't reschedule online now, or null (CR-03, SCH-23, OO-09, MP-21). */
export function inviteeRescheduleBlock(s: ChangeSubject): ChangeBlock | null {
  const rebook = isRebookable(s);
  if (!rebook && (s.invitee.status !== "active" || s.meeting.status !== "active")) {
    return { reason: "not_reschedulable", message: messages.changes.notReschedulable };
  }
  if (s.meeting.source === "one_off" || s.meeting.source === "poll") return { reason: "not_reschedulable", message: messages.changes.notReschedulable };
  if (!s.eventType || s.eventType.deletedAt || !s.eventType.active || s.eventType.type === "adhoc") {
    return { reason: "not_reschedulable", message: messages.changes.notReschedulable };
  }
  // A rebook after "Share new times to meet" starts from a canceled meeting: its old time no longer matters.
  if (rebook) return null;
  if (s.meeting.startAt.getTime() <= s.now.getTime()) return { reason: "not_reschedulable", message: messages.changes.notReschedulable };
  return cutoffBlock(s);
}

/** Validates an invitee's cancel reason (CR-02: optional unless the event type requires one; at most 2,000 characters). */
export function cancelReasonProblem(reason: string | null | undefined, required: boolean): string | null {
  const r = (reason ?? "").trim();
  if (required && !r) return messages.changes.reasonRequired;
  if (r.length > 2000) return messages.changes.reasonTooLong;
  return null;
}
