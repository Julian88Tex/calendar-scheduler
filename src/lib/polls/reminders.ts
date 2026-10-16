// Reminders to people who haven't voted (SPEC MP-24; research meeting-polls.md B11, Doodle rules A2.6). Pure and
// client safe: the services turn the plan into polls.reminder jobs (recomputed when the deadline, the options or the
// invite list change) and the job re-checks eligibility at send time (still open, still invited, subscribed, at most
// MAX_AUTOMATIC_REMINDERS automatic reminders per participant).
//
// Smart mode: anchor = the deadline when set, else the first future option start; lead = anchor minus the time
// invitations were first sent. lead > 5 days: one reminder 48 hours before the anchor (plus an early nudge 3 days
// after the invitation when lead > 7 days); 2 to 5 days (inclusive): 36 hours before; under 2 days: none.
// Custom mode: up to 3 reminders, each "N minutes after the invitation" or "N minutes before the deadline".
import { MAX_CUSTOM_REMINDERS } from "./constants";
import type { ReminderMode, ReminderOffset } from "./types";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Smart rule thresholds (exported for tests and the settings copy). */
export const SMART_RULES = {
  longLeadMs: 5 * DAY,
  shortLeadMs: 2 * DAY,
  longBeforeMs: 48 * HOUR,
  shortBeforeMs: 36 * HOUR,
  nudgeLeadMs: 7 * DAY,
  nudgeAfterMs: 3 * DAY,
} as const;

export type PlannedReminder = {
  /** Stable index within the plan kind (job idempotency keys). */
  index: number;
  kind: "anchor" | "after_invite";
  runAt: Date;
};

export type ReminderPlanInput = {
  mode: ReminderMode;
  offsets?: readonly ReminderOffset[] | null;
  deadlineAt: Date | null;
  /** The first option start after now (date-only options: local midnight in the poll zone). */
  firstFutureOptionStart: Date | null;
  /** The last option start (no reminders once every option started). */
  lastOptionStart: Date | null;
  now: Date;
};

/** The smart anchor: the deadline when set, else the first future option start. */
export function reminderAnchor(p: Pick<ReminderPlanInput, "deadlineAt" | "firstFutureOptionStart">): Date | null {
  return p.deadlineAt ?? p.firstFutureOptionStart ?? null;
}

/** When reminders stop making sense: the deadline (voting closes) or the last option start. */
function closesAt(p: Pick<ReminderPlanInput, "deadlineAt" | "lastOptionStart">): number | null {
  const d = p.deadlineAt?.getTime() ?? null;
  const l = p.lastOptionStart?.getTime() ?? null;
  if (d !== null && l !== null) return Math.min(d, l);
  return d ?? l;
}

/** The smart reminder lead rule: how long before the anchor, or null for no reminder. */
export function smartLeadReminderMs(leadMs: number): number | null {
  if (leadMs > SMART_RULES.longLeadMs) return SMART_RULES.longBeforeMs;
  if (leadMs >= SMART_RULES.shortLeadMs) return SMART_RULES.shortBeforeMs;
  return null;
}

/** Custom offsets, valid and capped (positive minutes, at most MAX_CUSTOM_REMINDERS, duplicates dropped). */
export function normalizeOffsets(offsets: readonly ReminderOffset[] | null | undefined): ReminderOffset[] {
  const seen = new Set<string>();
  const out: ReminderOffset[] = [];
  for (const o of offsets ?? []) {
    if (!o || (o.kind !== "after_invite" && o.kind !== "before_deadline")) continue;
    const minutes = Math.round(Number(o.minutes));
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    const key = `${o.kind}:${minutes}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: o.kind, minutes });
    if (out.length >= MAX_CUSTOM_REMINDERS) break;
  }
  return out;
}

/**
 * Anchor based reminders of a poll (smart 48 or 36 hours before the anchor, custom "before the deadline"). Needs the
 * first invitation time (smart lead); reminders in the past or after voting closes are dropped.
 */
export function planAnchorReminders(p: ReminderPlanInput & { firstInviteSentAt: Date | null }): PlannedReminder[] {
  if (p.mode === "off" || !p.firstInviteSentAt) return [];
  const nowMs = p.now.getTime();
  const close = closesAt(p);
  const out: PlannedReminder[] = [];
  const keep = (runAt: number) => runAt > nowMs && (close === null || runAt < close);
  if (p.mode === "smart") {
    const anchor = reminderAnchor(p);
    if (!anchor) return [];
    const before = smartLeadReminderMs(anchor.getTime() - p.firstInviteSentAt.getTime());
    if (before === null) return [];
    const runAt = anchor.getTime() - before;
    if (keep(runAt)) out.push({ index: 0, kind: "anchor", runAt: new Date(runAt) });
    return out;
  }
  if (!p.deadlineAt) return [];
  normalizeOffsets(p.offsets)
    .filter((o) => o.kind === "before_deadline")
    .forEach((o, i) => {
      const runAt = p.deadlineAt!.getTime() - o.minutes * 60_000;
      // "Before the deadline" reminders may land exactly at the deadline minus 0: keep them strictly before it.
      if (runAt > nowMs && runAt < p.deadlineAt!.getTime()) out.push({ index: i, kind: "anchor", runAt: new Date(runAt) });
    });
  return out.sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
}

/**
 * Reminders of one batch of invitations sent at `invitedAt` (smart early nudge 3 days later when the lead is over 7
 * days; custom "after the invitation" offsets). Reminders in the past or after voting closes are dropped.
 */
export function planInviteReminders(p: ReminderPlanInput & { invitedAt: Date }): PlannedReminder[] {
  if (p.mode === "off") return [];
  const nowMs = p.now.getTime();
  const close = closesAt(p);
  const keep = (runAt: number) => runAt > nowMs && (close === null || runAt < close);
  const out: PlannedReminder[] = [];
  if (p.mode === "smart") {
    const anchor = reminderAnchor(p);
    if (!anchor) return [];
    const lead = anchor.getTime() - p.invitedAt.getTime();
    // With a lead over 7 days the nudge (invite + 3 days) always lands more than 2 days before the anchor reminder.
    if (lead > SMART_RULES.nudgeLeadMs) {
      const runAt = p.invitedAt.getTime() + SMART_RULES.nudgeAfterMs;
      if (keep(runAt)) out.push({ index: 0, kind: "after_invite", runAt: new Date(runAt) });
    }
    return out;
  }
  normalizeOffsets(p.offsets)
    .filter((o) => o.kind === "after_invite")
    .forEach((o, i) => {
      const runAt = p.invitedAt.getTime() + o.minutes * 60_000;
      if (keep(runAt)) out.push({ index: i, kind: "after_invite", runAt: new Date(runAt) });
    });
  return out.sort((a, b) => a.runAt.getTime() - b.runAt.getTime());
}

/** "48 hours before the deadline", "3 days after the invitation" (settings and results copy). */
export function describeOffset(o: ReminderOffset): string {
  const m = o.minutes;
  const unit = m % 1440 === 0 ? { n: m / 1440, word: "day" } : m % 60 === 0 ? { n: m / 60, word: "hour" } : { n: m, word: "minute" };
  const amount = `${unit.n} ${unit.word}${unit.n === 1 ? "" : "s"}`;
  return o.kind === "after_invite" ? `${amount} after the invitation` : `${amount} before the deadline`;
}
