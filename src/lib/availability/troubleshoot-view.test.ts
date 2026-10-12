// Troubleshoot view copy (docs/SCOPE.md priority 4; SPEC SCH-21, Appendix B): every blocker type gets its exact reason.
import { describe, expect, it } from "vitest";
import type { TroubleshootBlocker, TroubleshootCandidate, TroubleshootEventType } from "@/lib/booking/types";
import type { ReasonCode } from "@/lib/slots/types";
import {
  blockerSentence,
  chipLabel,
  describeCandidate,
  fixTarget,
  formatNotice,
  groupRows,
  reasonSentences,
  settingsSummary,
  type DescribeContext,
} from "./troubleshoot-view";

const ZONE = "America/Los_Angeles";
const MIN = 60_000;
/** 2026-10-13 hh:mm in Los Angeles (PDT, UTC-7) as epoch ms. */
const la = (hh: number, mm = 0) => Date.UTC(2026, 9, 13, hh + 7, mm);

const settings: TroubleshootEventType["settings"] = {
  incrementMinutes: 15,
  bufferBeforeMinutes: 15,
  bufferAfterMinutes: 15,
  minimumNoticeMinutes: 240,
  dateRange: { type: "rolling", days: 60, mode: "calendar_days" },
  limits: { day: 2, week: 5, month: null },
};

const ctx: DescribeContext = {
  zone: ZONE,
  hour12: true,
  eventTypeName: "30 Minute Virtual",
  durationMinutes: 30,
  settings,
  hostLimits: { day: 3, week: null, month: 40 },
  scheduleName: "Working hours",
};

function cand(start: number, patch: Partial<TroubleshootCandidate> = {}): TroubleshootCandidate {
  return {
    start,
    end: start + 30 * MIN,
    available: false,
    reasons: [],
    status: "outside_hours",
    outsideHours: false,
    limitPeriods: [],
    hostLimitPeriods: [],
    blockers: [],
    ...patch,
  };
}

function blocker(code: ReasonCode, start: number, end: number, patch: Partial<TroubleshootBlocker> = {}): TroubleshootBlocker {
  return {
    code,
    source: code === "CALENDAR" ? "calendar" : code === "RESERVED" ? "reserved" : "meeting",
    start,
    end,
    core: null,
    title: null,
    calendarId: null,
    meetingId: null,
    eventTypeId: null,
    bufferSide: null,
    ...patch,
  };
}

describe("reason sentences", () => {
  it("names the conflicting calendar event and its time", () => {
    const c = cand(la(9), { reasons: ["CALENDAR"], status: "CALENDAR", blockers: [blocker("CALENDAR", la(9), la(10), { title: "Dentist" })] });
    expect(reasonSentences(c, ctx)).toEqual(['Conflicts with "Dentist" on your calendar (9:00am - 10:00am).']);
  });

  it("describes an untitled calendar event and all-day events", () => {
    const allDay = blocker("CALENDAR", la(0), la(24));
    expect(blockerSentence(cand(la(9)), allDay, ctx)).toBe("Conflicts with a busy event on your calendar (all day).");
  });

  it("explains the candidate's own buffer before a named event", () => {
    // Candidate 10:00 to 10:30 with a 15 min before buffer; the event ends at 9:50.
    const b = blocker("BUFFER", la(9), la(9, 50), { source: "calendar", title: "Gym", bufferSide: "before" });
    expect(blockerSentence(cand(la(10)), b, ctx)).toBe('Your 15 min buffer before this time overlaps "Gym" (9:00am - 9:50am).');
  });

  it("explains the candidate's own buffer after a named event", () => {
    const b = blocker("BUFFER", la(10, 40), la(11, 30), { source: "calendar", title: "Team sync", bufferSide: "after" });
    expect(blockerSentence(cand(la(10)), b, ctx)).toBe('Your 15 min buffer after this time overlaps "Team sync" (10:40am - 11:30am).');
  });

  it("explains another meeting's own buffer reaching this time", () => {
    const noBuffers: DescribeContext = { ...ctx, settings: { ...settings, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 } };
    // Meeting 9:00 to 9:30 with a 30 min after buffer (blocks until 10:00); candidate 9:45.
    const b = blocker("BUFFER", la(9), la(10), { title: "Coffee with Maya", core: { start: la(9), end: la(9, 30) }, bufferSide: "before" });
    expect(blockerSentence(cand(la(9, 45)), b, noBuffers)).toBe('The 30 min buffer after "Coffee with Maya" (9:00am - 9:30am) overlaps this time.');
  });

  it("names existing bookings of this event type and other meetings", () => {
    const ev = blocker("EVENT", la(13), la(13, 30), { title: "30 Minute Virtual with Maya", core: { start: la(13), end: la(13, 30) } });
    const ov = blocker("OVERLAP", la(14), la(15), { title: "In-Person Meal or Coffee" });
    expect(blockerSentence(cand(la(13)), ev, ctx)).toBe('Another 30 Minute Virtual meeting is booked: "30 Minute Virtual with Maya" (1:00pm - 1:30pm).');
    expect(blockerSentence(cand(la(14)), ov, ctx)).toBe('Overlaps another meeting: "In-Person Meal or Coffee" (2:00pm - 3:00pm).');
  });

  it("explains notice, date range and limits with the configured values", () => {
    const c = cand(la(9), { reasons: ["TOOSOON", "RANGE", "DAILY_MAX", "WEEKLY_MAX", "MEETING_LIMIT"], status: "TOOSOON", hostLimitPeriods: ["day"] });
    expect(reasonSentences(c, ctx)).toEqual([
      "Too soon: invitees must schedule at least 4 hours in advance.",
      "Beyond your date range: invitees can schedule up to 60 calendar days into the future.",
      "Daily limit reached: 30 Minute Virtual allows 2 meetings per day.",
      "Weekly limit reached: 30 Minute Virtual allows 5 meetings per week.",
      "Meeting limit reached: you allow 3 meetings per day across all event types.",
    ]);
  });

  it("explains fixed date ranges and past times", () => {
    const fixed: DescribeContext = { ...ctx, settings: { ...settings, dateRange: { type: "fixed", startDate: "2026-10-20", endDate: "2026-10-22" } } };
    expect(reasonSentences(cand(la(9), { reasons: ["RANGE"], status: "RANGE" }), fixed)).toEqual([
      "Outside your date range (Tue, Oct 20, 2026 to Thu, Oct 22, 2026).",
    ]);
    expect(reasonSentences(cand(la(9), { reasons: ["PAST"], status: "PAST" }), ctx)).toEqual(["This time has already passed."]);
  });

  it("explains starts outside working hours", () => {
    const c = cand(la(6), { outsideHours: true });
    expect(reasonSentences(c, ctx)).toEqual(['Outside your working hours (schedule "Working hours").']);
    expect(reasonSentences(c, { ...ctx, customSchedule: true })).toEqual(["Outside the custom hours of 30 Minute Virtual."]);
  });

  it("returns no reasons for available times", () => {
    expect(reasonSentences(cand(la(11), { available: true, status: "available" }), ctx)).toEqual([]);
  });
});

describe("rows", () => {
  it("labels chips with the Calendly codes", () => {
    expect(chipLabel("available")).toBe("Available");
    expect(chipLabel("outside_hours")).toBe("OUTSIDE HOURS");
    expect(chipLabel("MEETING_LIMIT")).toBe("MEETING LIMIT");
    expect(chipLabel("DAILY_MAX")).toBe("DAILY MAX");
  });

  it("collapses runs of identical outcomes and keeps available starts separate", () => {
    const views = [
      ...[0, 15, 30, 45].map((m) => describeCandidate(cand(la(8, m), { outsideHours: true }), ctx)),
      describeCandidate(cand(la(9), { available: true, status: "available" }), ctx),
      describeCandidate(cand(la(9, 15), { available: true, status: "available" }), ctx),
      describeCandidate(cand(la(9, 30), { reasons: ["CALENDAR"], status: "CALENDAR", blockers: [blocker("CALENDAR", la(9, 30), la(10), { title: "Dentist" })] }), ctx),
    ];
    const rows = groupRows(views);
    expect(rows.map((r) => r.kind)).toEqual(["group", "candidate", "candidate", "candidate"]);
    const group = rows[0]!;
    if (group.kind !== "group") throw new Error("expected a group");
    expect(group.first.timeLabel).toBe("8:00am");
    expect(group.last.timeLabel).toBe("8:45am");
    expect(group.items).toHaveLength(4);
    expect(group.chip).toBe("OUTSIDE HOURS");
  });

  it("summarizes event type rules and fix targets", () => {
    expect(settingsSummary(settings, 30)).toEqual([
      "30 min meetings",
      "starts every 15 min",
      "15 min buffer before",
      "15 min buffer after",
      "4 hours minimum notice",
      "60 calendar days into the future",
      "max 2 meetings per day",
      "max 5 meetings per week",
    ]);
    expect(fixTarget("BUFFER")).toBe("event_type");
    expect(fixTarget("MEETING_LIMIT")).toBe("limits");
    expect(fixTarget("outside_hours")).toBe("availability");
    expect(fixTarget("CALENDAR")).toBe("calendar");
    expect(formatNotice(90)).toBe("1 hour 30 minutes");
    expect(formatNotice(2880)).toBe("2 days");
  });
});
