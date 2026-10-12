// Poll state machine (SPEC MP-22; research meeting-polls.md B9). Pure and client safe.
//
// States: open, closed, booked, canceled, expired. Every server transition goes through transition() (one function
// per transition in the services writes poll_activity and enqueues its side effects). Derived flags are computed on
// every read and write (effectiveStatus): a missed cron run can never let someone vote after the deadline or after
// the last option started.
//
//   from              event                to
//   (new)             share                open
//   open              close                closed      deadline reached (job) or "Close voting"
//   closed            reopen_voting        open        "Reopen voting" (the deadline must be cleared or moved first)
//   open, closed      book                 booked      host books or auto-book; a reopened poll books again
//   booked            reopen               open        "Reopen poll" (the scheduled event is kept)
//   open, closed      expire               expired     the last option start passes (job plus lazy check)
//   open, closed,     delete               canceled    soft delete; booked polls choose to keep or cancel the meeting
//   expired, booked
//   expired           add_future_options   open        the host adds future options
import type { PollStatus } from "./types";

export type PollEvent = "share" | "close" | "reopen_voting" | "book" | "reopen" | "expire" | "delete" | "add_future_options";

export const POLL_EVENTS: readonly PollEvent[] = ["share", "close", "reopen_voting", "book", "reopen", "expire", "delete", "add_future_options"];
export const POLL_STATUSES: readonly PollStatus[] = ["open", "closed", "booked", "canceled", "expired"];

const TRANSITIONS: Record<PollEvent, { from: readonly (PollStatus | "new")[]; to: PollStatus }> = {
  share: { from: ["new"], to: "open" },
  close: { from: ["open"], to: "closed" },
  reopen_voting: { from: ["closed"], to: "open" },
  book: { from: ["open", "closed"], to: "booked" },
  reopen: { from: ["booked"], to: "open" },
  expire: { from: ["open", "closed"], to: "expired" },
  delete: { from: ["open", "closed", "expired", "booked"], to: "canceled" },
  add_future_options: { from: ["expired"], to: "open" },
};

/** True when `event` is allowed from `from`. */
export function canTransition(from: PollStatus | "new", event: PollEvent): boolean {
  return TRANSITIONS[event].from.includes(from);
}

/** The state after `event`, or null when the transition is not allowed. */
export function nextStatus(from: PollStatus | "new", event: PollEvent): PollStatus | null {
  return canTransition(from, event) ? TRANSITIONS[event].to : null;
}

/** The state after `event`; throws a TransitionError when the transition is not allowed. */
export function transition(from: PollStatus | "new", event: PollEvent): PollStatus {
  const to = nextStatus(from, event);
  if (!to) throw new TransitionError(from, event);
  return to;
}

export class TransitionError extends Error {
  readonly from: PollStatus | "new";
  readonly event: PollEvent;
  constructor(from: PollStatus | "new", event: PollEvent) {
    super(`Poll transition ${event} is not allowed from ${from}`);
    this.name = "TransitionError";
    this.from = from;
    this.event = event;
  }
}

/** True once the deadline has passed (a deadline equal to now has passed). */
export function isPastDeadline(deadlineAt: Date | null | undefined, now: Date): boolean {
  return Boolean(deadlineAt && deadlineAt.getTime() <= now.getTime());
}

/** True when every option has started (no options counts as all past). */
export function allOptionsPast(lastOptionStart: Date | null | undefined, now: Date): boolean {
  return !lastOptionStart || lastOptionStart.getTime() <= now.getTime();
}

export type StatusInput = {
  status: PollStatus;
  deadlineAt: Date | null;
  /** The latest start among the poll's live options (date-only options: local midnight in the poll zone). */
  lastOptionStart: Date | null;
  now: Date;
};

/**
 * The status a reader should see (lazy guards): an open poll past its deadline is closed, an open or closed poll whose
 * options have all started is expired. Booked, canceled and expired are final until a host acts.
 */
export function effectiveStatus(p: StatusInput): PollStatus {
  if (p.status !== "open" && p.status !== "closed") return p.status;
  if (allOptionsPast(p.lastOptionStart, p.now)) return "expired";
  if (p.status === "open" && isPastDeadline(p.deadlineAt, p.now)) return "closed";
  return p.status;
}

/** Voting is allowed only while the effective status is open. */
export function votingOpen(p: StatusInput): boolean {
  return effectiveStatus(p) === "open";
}

/** The host can book while the effective status is open or closed (MP-18). */
export function bookable(status: PollStatus): boolean {
  return status === "open" || status === "closed";
}

/** Status badge labels (MP-16). */
export const STATUS_LABELS: Record<PollStatus, string> = {
  open: "Open",
  closed: "Closed",
  booked: "Booked",
  canceled: "Canceled",
  expired: "Expired",
};
