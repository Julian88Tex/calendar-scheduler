// The workflow timing engine (SPEC NT-15, ARCHITECTURE section 14): which executions a meeting gets for a workflow
// and when they run. Pure (no I/O, the clock comes in through opts.now), so every rule is unit tested.
//
// - One execution per (action, invitee) for active invitees; group events get one execution per slot for host and
//   "other" actions on the timed triggers (before_start, starts, ends), our choice, so a host is reminded once per slot.
// - Run time: booked = booking time + offset; before_start = start - offset; starts = start + offset; ends = end +
//   offset; rescheduled, canceled and no_show = the time the change happened + offset.
// - A before_start run time that already passed when the meeting is scheduled is "skipped" with reason
//   booked_too_close; other past run times run immediately.
// - Canceled-trigger executions are never created for group events; one-off meetings and poll meetings get no
//   workflows at all (Calendly parity).
// - Backfill (workflows applied to meetings booked earlier) covers the before_start, starts and ends triggers only
//   and drops run times that are already past (no skipped rows).
// - Idempotency key `{stepId}:{inviteeId | "slot:" + scheduledEventId}:{trigger}` (no run time), so re-enabling a
//   workflow or backfilling again never duplicates.
import type { WorkflowStepSnapshot } from "@/db/schema";

export type WorkflowTrigger = "booked" | "before_start" | "starts" | "rescheduled" | "ends" | "canceled" | "no_show";
export type WorkflowAction = "email_invitees" | "email_host" | "email_other" | "sms_invitees" | "sms_host" | "sms_other";

/** Triggers tied to the meeting's own times: the only ones that backfill. */
export const TIMED_TRIGGERS: readonly WorkflowTrigger[] = ["before_start", "starts", "ends"];
/** SMS actions run for group slots with at most this many invitees (NT-15). */
export const SMS_GROUP_LIMIT = 100;

export type EngineWorkflow = {
  id: string;
  name: string;
  trigger: WorkflowTrigger;
  offsetMinutes: number;
  isBasic: boolean;
};

export type EngineStep = {
  id: string;
  position: number;
  action: WorkflowAction;
  recipients: string[];
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  includeCancelRescheduleLinks: boolean;
  includeGuests: boolean;
  replyTo: string | null;
};

export type EngineMeeting = {
  id: string;
  startAt: Date;
  endAt: Date;
  isGroup: boolean;
  status: "active" | "canceled";
  pollId?: string | null;
  oneOffMeetingId?: string | null;
  /** Active invitees of the slot (SMS group limit); defaults to the active invitees passed in. */
  activeInviteeCount?: number;
};

export type EngineInvitee = { id: string; status: "active" | "canceled"; createdAt: Date };

export type ComputeOptions = {
  now: Date;
  /** Backfill mode: timed triggers only, past run times dropped. */
  backfill?: boolean;
  /** When the triggering change happened (rescheduled, canceled, no_show); defaults to now. */
  eventAt?: Date;
};

export type ComputedExecution = {
  stepId: string;
  inviteeId: string | null;
  trigger: WorkflowTrigger;
  runAt: Date;
  status: "scheduled" | "skipped";
  skipReason: string | null;
  idempotencyKey: string;
  snapshot: WorkflowStepSnapshot;
};

const MINUTE = 60_000;

export function isInviteeAction(action: WorkflowAction): boolean {
  return action === "email_invitees" || action === "sms_invitees";
}

export function isSmsAction(action: WorkflowAction): boolean {
  return action.startsWith("sms_");
}

export function isTimedTrigger(trigger: WorkflowTrigger): boolean {
  return TIMED_TRIGGERS.includes(trigger);
}

/** The NT-15 run time of a trigger. `bookedAt` is the booking time; `eventAt` the time of the change. */
export function executionRunAt(
  trigger: WorkflowTrigger,
  offsetMinutes: number,
  meeting: Pick<EngineMeeting, "startAt" | "endAt">,
  ref: { bookedAt?: Date; eventAt?: Date; now: Date },
): Date {
  const offset = Math.max(0, Math.trunc(offsetMinutes)) * MINUTE;
  switch (trigger) {
    case "before_start":
      return new Date(meeting.startAt.getTime() - offset);
    case "starts":
      return new Date(meeting.startAt.getTime() + offset);
    case "ends":
      return new Date(meeting.endAt.getTime() + offset);
    case "booked":
      return new Date((ref.bookedAt ?? ref.now).getTime() + offset);
    case "rescheduled":
    case "canceled":
    case "no_show":
      return new Date((ref.eventAt ?? ref.now).getTime() + offset);
  }
}

/** `{stepId}:{inviteeId | "slot:" + scheduledEventId}:{trigger}` (ARCHITECTURE section 14). */
export function executionIdempotencyKey(stepId: string, inviteeId: string | null, scheduledEventId: string, trigger: WorkflowTrigger): string {
  return `${stepId}:${inviteeId ?? `slot:${scheduledEventId}`}:${trigger}`;
}

/** The frozen action config stored on each execution ("edits apply only to meetings booked after the change"). */
export function stepSnapshot(workflow: EngineWorkflow, step: EngineStep): WorkflowStepSnapshot {
  return {
    workflowName: workflow.name,
    trigger: workflow.trigger,
    offsetMinutes: workflow.offsetMinutes,
    action: step.action,
    recipients: [...step.recipients],
    subject: step.subject,
    bodyHtml: step.bodyHtml,
    bodyText: step.bodyText,
    includeCancelRescheduleLinks: step.includeCancelRescheduleLinks,
    includeGuests: step.includeGuests,
    replyTo: step.replyTo,
    isBasic: workflow.isBasic,
  };
}

/**
 * The executions one workflow creates for one meeting and trigger (see the file header). `invitees` are the invitees
 * the trigger is about: every active invitee for booked and timed triggers, the canceled invitee for "canceled".
 */
export function computeExecutions(
  workflow: EngineWorkflow,
  steps: readonly EngineStep[],
  meeting: EngineMeeting,
  invitees: readonly EngineInvitee[],
  trigger: WorkflowTrigger,
  opts: ComputeOptions,
): ComputedExecution[] {
  if (workflow.trigger !== trigger) return [];
  if (meeting.pollId || meeting.oneOffMeetingId) return [];
  if (trigger === "canceled" && meeting.isGroup) return [];
  if (opts.backfill && !isTimedTrigger(trigger)) return [];
  if (trigger !== "canceled" && meeting.status !== "active") return [];

  const now = opts.now.getTime();
  const targets = trigger === "canceled" ? [...invitees] : invitees.filter((i) => i.status === "active");
  if (!targets.length) return [];
  const activeCount = meeting.activeInviteeCount ?? invitees.filter((i) => i.status === "active").length;

  const out: ComputedExecution[] = [];
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  for (const step of ordered) {
    const slotLevel = meeting.isGroup && !isInviteeAction(step.action) && isTimedTrigger(trigger);
    const smsBlocked = isSmsAction(step.action) && meeting.isGroup && activeCount > SMS_GROUP_LIMIT;
    const perTarget: (EngineInvitee | null)[] = slotLevel ? [null] : targets;
    for (const invitee of perTarget) {
      const runAt = executionRunAt(trigger, workflow.offsetMinutes, meeting, {
        bookedAt: invitee?.createdAt,
        eventAt: opts.eventAt,
        now: opts.now,
      });
      const past = runAt.getTime() <= now;
      let status: ComputedExecution["status"] = "scheduled";
      let skipReason: string | null = null;
      if (opts.backfill && past) continue;
      if (trigger === "before_start" && past) {
        status = "skipped";
        skipReason = "booked_too_close";
      } else if (smsBlocked) {
        if (opts.backfill) continue;
        status = "skipped";
        skipReason = "group_too_large";
      }
      out.push({
        stepId: step.id,
        inviteeId: invitee?.id ?? null,
        trigger,
        runAt,
        status,
        skipReason,
        idempotencyKey: executionIdempotencyKey(step.id, invitee?.id ?? null, meeting.id, trigger),
        snapshot: stepSnapshot(workflow, step),
      });
    }
  }
  return out;
}

/**
 * Where a scheduled execution should run now that the meeting may have moved in place (the run time of its trigger
 * from the meeting's current times; null for triggers not tied to the meeting's times).
 */
export function currentRunAt(
  trigger: WorkflowTrigger,
  offsetMinutes: number,
  meeting: Pick<EngineMeeting, "startAt" | "endAt">,
): Date | null {
  if (!isTimedTrigger(trigger)) return null;
  return executionRunAt(trigger, offsetMinutes, meeting, { now: meeting.startAt });
}
