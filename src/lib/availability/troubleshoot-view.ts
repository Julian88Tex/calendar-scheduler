// Troubleshoot view copy (docs/SCOPE.md priority 4; SPEC SCH-21, BK-24, Appendix B). Pure and client safe: turns the
// booking service's per-candidate diagnostics into rows with a status chip and the exact reasons, for example
// 'Conflicts with "Dentist" on your calendar (9:00am - 10:00am).' or 'Your 15 min buffer after this time overlaps
// "Team sync" (11:00am - 11:30am).'. Consecutive starts with the same outcome (outside working hours, too soon, a full
// day limit) collapse into one range row so a day reads at a glance.
import type { TroubleshootBlocker, TroubleshootCandidate, TroubleshootEventType } from "@/lib/booking/types";
import { appName } from "@/lib/brand";
import { reasonHint, reasonLabel } from "@/lib/slots/reasons";
import type { ReasonCode } from "@/lib/slots/types";
import { formatDuration, formatTime, isoDateInZone } from "@/lib/time/format";
import { formatOverrideDate } from "./intervals";

const MIN = 60_000;
const DAY = 86_400_000;

export type CandidateStatus = TroubleshootCandidate["status"];
export type RowTone = "available" | "blocked" | "outside";

export type DescribeContext = {
  zone: string;
  hour12: boolean;
  eventTypeName: string;
  durationMinutes: number;
  settings: TroubleshootEventType["settings"];
  hostLimits: { day: number | null; week: number | null; month: number | null };
  /** The schedule the event type uses (for the outside hours sentence). */
  scheduleName?: string | null;
  customSchedule?: boolean;
};

export type CandidateView = {
  key: string;
  start: number;
  end: number;
  /** "9:00am" */
  timeLabel: string;
  status: CandidateStatus;
  /** "Available", "OUTSIDE HOURS", "CALENDAR", "DAILY MAX", ... */
  chip: string;
  tone: RowTone;
  /** Every reason code of the candidate, primary first. */
  codes: ReasonCode[];
  /** One sentence per reason (blockers named). */
  reasons: string[];
  /** The candidate as given (for the details sheet). */
  candidate: TroubleshootCandidate;
};

export type ViewRow =
  | { kind: "candidate"; key: string; view: CandidateView }
  | { kind: "group"; key: string; first: CandidateView; last: CandidateView; items: CandidateView[]; chip: string; tone: RowTone; status: CandidateStatus; reasons: string[] };

export const OUTSIDE_HOURS_CHIP = "OUTSIDE HOURS";
export const AVAILABLE_CHIP = "Available";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "4 hours", "30 minutes", "1 hour 30 minutes", "2 days" (minimum notice copy). */
export function formatNotice(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m === 0) return "0 minutes";
  if (m % 1440 === 0) return plural(m / 1440, "day", "days");
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return plural(rest, "minute", "minutes");
  return rest ? `${plural(h, "hour", "hours")} ${plural(rest, "minute", "minutes")}` : plural(h, "hour", "hours");
}

/** "9:00am - 10:00am", or "all day" for blocks covering whole local days. */
export function rangeLabel(start: number, end: number, ctx: Pick<DescribeContext, "zone" | "hour12">): string {
  const startDate = isoDateInZone(start, ctx.zone);
  const wholeDay = end - start >= DAY - 2 * 3_600_000 && formatTime(start, ctx.zone, "en", false) === "00:00" && formatTime(end, ctx.zone, "en", false) === "00:00";
  if (wholeDay) {
    const days = Math.round((end - start) / DAY);
    return days > 1 ? `all day, ${formatOverrideDate(startDate)} to ${formatOverrideDate(isoDateInZone(end - 1, ctx.zone))}` : "all day";
  }
  const endDate = isoDateInZone(end, ctx.zone);
  const s = formatTime(start, ctx.zone, "en", ctx.hour12);
  const e = formatTime(end, ctx.zone, "en", ctx.hour12);
  if (startDate !== endDate && !(formatTime(end, ctx.zone, "en", false) === "00:00" && end - start < DAY)) {
    return `${formatOverrideDate(startDate)} ${s} - ${formatOverrideDate(endDate)} ${e}`;
  }
  return `${s} - ${e}`;
}

function coreOf(b: TroubleshootBlocker): { start: number; end: number } {
  return b.core ?? { start: b.start, end: b.end };
}

/** "Ana Lima", "Ana Lima and Ben Ito", "Ana Lima and 2 others". */
function namesLabel(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]} and ${names.length - 1} others`;
}

function inviteesOf(b: TroubleshootBlocker): string[] {
  return Array.isArray(b.inviteeNames) ? b.inviteeNames.filter((n) => typeof n === "string" && n.trim()) : [];
}

function blockerName(b: TroubleshootBlocker): string {
  const names = b.source === "meeting" ? inviteesOf(b) : [];
  if (b.title) return names.length ? `"${b.title}" with ${namesLabel(names)}` : `"${b.title}"`;
  if (b.source === "calendar") return "a busy event on your calendar";
  if (b.source === "reserved") return "a held time";
  return names.length ? `a meeting with ${namesLabel(names)}` : "another meeting";
}

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

/** When a busy interval happens (its meeting time without buffers): "1:00pm - 2:00pm" or "All day". */
export function blockerWhen(b: TroubleshootBlocker, ctx: Pick<DescribeContext, "zone" | "hour12">): string {
  const core = coreOf(b);
  const label = rangeLabel(core.start, core.end, ctx);
  return label.startsWith("all day") ? `A${label.slice(1)}` : label;
}

/** A busy interval's display title: the event title (meetings: with their invitees), else "Busy", "Held time" or "Meeting". */
export function blockerTitle(b: TroubleshootBlocker): string {
  const names = b.source === "meeting" ? inviteesOf(b) : [];
  const base = b.title ?? (b.source === "calendar" ? "Busy" : b.source === "reserved" ? "Held time" : "Meeting");
  return names.length ? `${base} with ${namesLabel(names)}` : base;
}

/** The sentence for one blocker of a candidate (CALENDAR, EVENT, OVERLAP, RESERVED or BUFFER). */
export function blockerSentence(c: Pick<TroubleshootCandidate, "start" | "end">, b: TroubleshootBlocker, ctx: DescribeContext): string {
  const core = coreOf(b);
  const range = rangeLabel(core.start, core.end, ctx);
  switch (b.code) {
    case "CALENDAR":
      return b.title ? `Conflicts with "${b.title}" on your calendar (${range}).` : `Conflicts with a busy event on your calendar (${range}).`;
    case "EVENT": {
      const names = inviteesOf(b);
      return names.length
        ? `Another ${ctx.eventTypeName} meeting is booked with ${namesLabel(names)} (${range}).`
        : `Another ${ctx.eventTypeName} meeting is booked (${range}).`;
    }
    case "OVERLAP":
      return b.title || inviteesOf(b).length ? `Overlaps another meeting: ${blockerName(b)} (${range}).` : `Overlaps another meeting (${range}).`;
    case "RESERVED":
      return b.title ? `Held for "${b.title}" (${range}).` : `Held by a pending booking or a meeting poll (${range}).`;
    case "BUFFER": {
      const name = blockerName(b);
      const before = ctx.settings.bufferBeforeMinutes;
      const after = ctx.settings.bufferAfterMinutes;
      if (b.bufferSide !== "after") {
        if (before > 0 && overlaps({ start: c.start - before * MIN, end: c.start }, core)) {
          return `Your ${formatDuration(before)} buffer before this time overlaps ${name} (${range}).`;
        }
        const own = Math.round((b.end - core.end) / MIN);
        if (b.bufferSide === "before" && own > 0) return `The ${formatDuration(own)} buffer after ${name} (${range}) overlaps this time.`;
      }
      if (b.bufferSide !== "before") {
        if (after > 0 && overlaps({ start: c.end, end: c.end + after * MIN }, core)) {
          return `Your ${formatDuration(after)} buffer after this time overlaps ${name} (${range}).`;
        }
        const own = Math.round((core.start - b.start) / MIN);
        if (b.bufferSide === "after" && own > 0) return `The ${formatDuration(own)} buffer before ${name} (${range}) overlaps this time.`;
      }
      return `A buffer overlaps ${name} (${range}).`;
    }
    default:
      return `${reasonHint(b.code).meaning} (${range}).`;
  }
}

function rangeSentence(ctx: DescribeContext): string {
  const r = ctx.settings.dateRange;
  if (r.type === "rolling") {
    const unit = r.mode === "weekdays" ? "week days" : r.mode === "available_days" ? "days with availability" : "calendar days";
    return `Beyond your date range: invitees can schedule up to ${r.days} ${unit} into the future.`;
  }
  if (r.type === "fixed") return `Outside your date range (${formatOverrideDate(r.startDate)} to ${formatOverrideDate(r.endDate)}).`;
  return "Outside your date range.";
}

const PERIOD_WORD = { day: "day", week: "week", month: "month" } as const;

function limitSentence(code: "DAILY_MAX" | "WEEKLY_MAX" | "MONTHLY_MAX", ctx: DescribeContext): string {
  const period = code === "DAILY_MAX" ? "day" : code === "WEEKLY_MAX" ? "week" : "month";
  const n = ctx.settings.limits[period];
  const label = code === "DAILY_MAX" ? "Daily" : code === "WEEKLY_MAX" ? "Weekly" : "Monthly";
  return n
    ? `${label} limit reached: ${ctx.eventTypeName} allows ${plural(n, "meeting", "meetings")} per ${PERIOD_WORD[period]}.`
    : `${label} limit of ${ctx.eventTypeName} reached.`;
}

function hostLimitSentences(periods: readonly ("day" | "week" | "month")[], ctx: DescribeContext): string[] {
  const list = periods.length ? periods : (["day", "week", "month"] as const).filter((p) => ctx.hostLimits[p]);
  if (list.length === 0) return ["Meeting limit reached across all your event types."];
  return list.map((p) => {
    const n = ctx.hostLimits[p];
    return n
      ? `Meeting limit reached: you allow ${plural(n, "meeting", "meetings")} per ${PERIOD_WORD[p]} across all event types.`
      : `Meeting limit per ${PERIOD_WORD[p]} reached across all event types.`;
  });
}

function outsideSentence(ctx: DescribeContext): string {
  if (ctx.customSchedule) return `Outside the custom hours of ${ctx.eventTypeName}.`;
  if (ctx.scheduleName) return `Outside your working hours (schedule "${ctx.scheduleName}").`;
  return "Outside your working hours.";
}

/** Every reason sentence of a candidate, in display priority order. */
export function reasonSentences(c: TroubleshootCandidate, ctx: DescribeContext): string[] {
  if (c.available) return [];
  const out: string[] = [];
  if (c.outsideHours) out.push(outsideSentence(ctx));
  const blockerCodes = new Set<ReasonCode>(["CALENDAR", "EVENT", "OVERLAP", "RESERVED", "BUFFER"]);
  for (const code of c.reasons) {
    switch (code) {
      case "PAST":
        out.push("This time has already passed.");
        break;
      case "TOOSOON":
        out.push(`Too soon: invitees must schedule at least ${formatNotice(ctx.settings.minimumNoticeMinutes)} in advance.`);
        break;
      case "RANGE":
        out.push(rangeSentence(ctx));
        break;
      case "DURATION":
        // No start time in the sentence, so a run of such starts collapses into one row.
        out.push(`Not enough time: the meeting (${formatDuration(ctx.durationMinutes)}) would run past the end of your available hours.`);
        break;
      case "HOLIDAY":
        out.push("This date is marked as a holiday.");
        break;
      case "DAILY_MAX":
      case "WEEKLY_MAX":
      case "MONTHLY_MAX":
        out.push(limitSentence(code, ctx));
        break;
      case "MEETING_LIMIT":
        out.push(...hostLimitSentences(c.hostLimitPeriods, ctx));
        break;
      case "NOCAL":
        out.push(`${appName()} can't check your calendar for conflicts. Reconnect your calendar.`);
        break;
      case "GROUP":
        out.push("This group time is full.");
        break;
      case "HOST":
        out.push("One or more hosts are unavailable.");
        break;
      case "ROUNDROBIN":
        out.push("No host is available under the distribution rules.");
        break;
      case "UNFAIR":
        out.push("Booking this time would distribute meetings unfairly.");
        break;
      default:
        if (!blockerCodes.has(code)) out.push(`${reasonHint(code).meaning}.`);
    }
  }
  const seen = new Set<string>();
  for (const b of c.blockers) {
    const s = blockerSentence(c, b, ctx);
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  // A blocker code without blocker details still gets its meaning.
  for (const code of c.reasons) {
    if (blockerCodes.has(code) && !c.blockers.some((b) => b.code === code)) out.push(`${reasonHint(code).meaning}.`);
  }
  if (out.length === 0) out.push(outsideSentence(ctx));
  return out;
}

/** The chip text of a status. */
export function chipLabel(status: CandidateStatus): string {
  if (status === "available") return AVAILABLE_CHIP;
  if (status === "outside_hours") return OUTSIDE_HOURS_CHIP;
  return reasonLabel(status);
}

export function describeCandidate(c: TroubleshootCandidate, ctx: DescribeContext): CandidateView {
  const status: CandidateStatus = c.available ? "available" : c.status;
  return {
    key: String(c.start),
    start: c.start,
    end: c.end,
    timeLabel: formatTime(c.start, ctx.zone, "en", ctx.hour12),
    status,
    chip: chipLabel(status),
    tone: c.available ? "available" : status === "outside_hours" ? "outside" : "blocked",
    codes: c.available ? [] : c.reasons,
    reasons: reasonSentences(c, ctx),
    candidate: c,
  };
}

/**
 * Rows for the list: runs of at least `minRun` consecutive unavailable starts with the same status and reasons
 * become one group row; available starts always stay separate.
 */
export function groupRows(views: readonly CandidateView[], minRun = 3): ViewRow[] {
  const rows: ViewRow[] = [];
  let i = 0;
  while (i < views.length) {
    const v = views[i]!;
    let j = i + 1;
    if (v.status !== "available") {
      const sig = `${v.status}|${v.reasons.join("|")}`;
      while (j < views.length && views[j]!.status !== "available" && `${views[j]!.status}|${views[j]!.reasons.join("|")}` === sig) j++;
    }
    const run = views.slice(i, j);
    if (run.length >= minRun) {
      rows.push({ kind: "group", key: `g${v.key}`, first: v, last: run[run.length - 1]!, items: run, chip: v.chip, tone: v.tone, status: v.status, reasons: v.reasons });
    } else {
      for (const item of run) rows.push({ kind: "candidate", key: item.key, view: item });
    }
    i = j;
  }
  return rows;
}

export function countViews(views: readonly CandidateView[]): { available: number; unavailable: number } {
  const available = views.filter((v) => v.status === "available").length;
  return { available, unavailable: views.length - available };
}

/** One line of the event type's rules ("15 min increments, 15 min buffer before, 4 hours notice, 60 calendar days"). */
export function settingsSummary(settings: TroubleshootEventType["settings"], durationMinutes: number): string[] {
  const out = [`${formatDuration(durationMinutes)} meetings`, `starts every ${formatDuration(settings.incrementMinutes)}`];
  if (settings.bufferBeforeMinutes) out.push(`${formatDuration(settings.bufferBeforeMinutes)} buffer before`);
  if (settings.bufferAfterMinutes) out.push(`${formatDuration(settings.bufferAfterMinutes)} buffer after`);
  out.push(settings.minimumNoticeMinutes ? `${formatNotice(settings.minimumNoticeMinutes)} minimum notice` : "no minimum notice");
  const r = settings.dateRange;
  if (r.type === "rolling") {
    const unit = r.mode === "weekdays" ? "week days" : r.mode === "available_days" ? "days with availability" : "calendar days";
    out.push(`${r.days} ${unit} into the future`);
  } else if (r.type === "fixed") {
    out.push(`${formatOverrideDate(r.startDate)} to ${formatOverrideDate(r.endDate)}`);
  } else out.push("indefinitely into the future");
  const l = settings.limits;
  if (l.day) out.push(`max ${plural(l.day, "meeting", "meetings")} per day`);
  if (l.week) out.push(`max ${plural(l.week, "meeting", "meetings")} per week`);
  if (l.month) out.push(`max ${plural(l.month, "meeting", "meetings")} per month`);
  return out;
}

/** The fix link of a status: where the owner changes the setting that blocks the time. */
export function fixTarget(status: CandidateStatus): "event_type" | "availability" | "limits" | "calendar" | null {
  switch (status) {
    case "outside_hours":
    case "DURATION":
    case "HOLIDAY":
      return "availability";
    case "TOOSOON":
    case "RANGE":
    case "DAILY_MAX":
    case "WEEKLY_MAX":
    case "MONTHLY_MAX":
    case "BUFFER":
      return "event_type";
    case "MEETING_LIMIT":
      return "limits";
    case "NOCAL":
    case "CALENDAR":
      return "calendar";
    default:
      return null;
  }
}

/** Meaning and fix of a status for the details sheet. */
export function statusHint(status: CandidateStatus): { meaning: string; fix: string } | null {
  if (status === "available") return null;
  if (status === "outside_hours") return { meaning: "The time is outside the hours of the schedule this event type uses", fix: "Edit your weekly or date-specific hours" };
  return reasonHint(status);
}
