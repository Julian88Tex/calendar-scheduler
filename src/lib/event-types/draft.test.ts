// Event type draft helpers (SPEC ET-11, ET-14 to ET-24, ET-29, ET-33; ARCHITECTURE 17.1).
import { describe, expect, it } from "vitest";
import type { LocationConfig } from "@/db/types";
import { DEFAULT_QUESTION_LABEL, uiKindOf } from "./constants";
import {
  availabilityChanged,
  availabilitySummary,
  canonicalJson,
  copyName,
  copySlugCandidates,
  dedupeSlug,
  defaultDraft,
  draftsEqual,
  draftVersion,
  durationColumns,
  durationsOf,
  durationSummary,
  htmlSummary,
  inviteeFormSummary,
  limitsSummary,
  locationSummary,
  noticeMinutesOf,
  noticeText,
  noticeUnitOf,
  notificationsSummary,
  previewDraftOf,
  rollingRangeText,
  sortedLocations,
  wholeNumberIn,
} from "./draft";
import type { EditorScheduleOption } from "./types";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const draft = () => defaultDraft({ name: "New Meeting", color: "#8247f5", scheduleId: uuid(1), questionId: uuid(2) });

describe("ET-33 defaults", () => {
  it("match the spec defaults", () => {
    const d = draft();
    expect(d).toMatchObject({
      name: "New Meeting",
      durations: [30],
      locations: [],
      schedule: { kind: "schedule", scheduleId: uuid(1) },
      dateRange: { type: "rolling", days: 60, mode: "calendar_days" },
      minimumNoticeMinutes: 240,
      slotIncrementMinutes: 30,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      limitPerDay: null,
      limitPerWeek: null,
      limitPerMonth: null,
      timeZoneDisplay: "auto",
      nameFormat: "full",
      allowGuests: true,
      notificationType: "auto",
      includeCancelRescheduleLinks: true,
      includeAnswersInNotifications: true,
      afterBooking: "confirmation_page",
      scheduleAnotherEnabled: true,
      scheduleAnotherLabel: "Schedule another event",
      secret: false,
    });
    expect(d.questions).toEqual([
      { id: uuid(2), label: DEFAULT_QUESTION_LABEL, type: "text", required: false, enabled: true, answerChoices: [], includeOther: false },
    ]);
  });

  it("starts with the profile default location when there is one (VID-15)", () => {
    const d = defaultDraft({
      name: "x",
      color: "#8247f5",
      scheduleId: null,
      questionId: uuid(2),
      defaultLocation: { id: uuid(9), kind: "google_conference", position: 3 },
      locationId: uuid(10),
    });
    expect(d.locations).toEqual([{ id: uuid(10), kind: "google_conference", position: 0 }]);
  });
});

describe("durations (ET-16)", () => {
  it("serializes the default and the options like Calendly", () => {
    expect(durationColumns([30, 60])).toEqual({ durationMinutes: 30, durationOptions: [30, 60] });
    expect(durationColumns([60, 15, 30])).toEqual({ durationMinutes: 60, durationOptions: [15, 30, 60] });
    expect(durationColumns([45])).toEqual({ durationMinutes: 45, durationOptions: null });
  });

  it("reads rows with the default first", () => {
    expect(durationsOf({ durationMinutes: 60, durationOptions: [15, 30, 60] })).toEqual([60, 15, 30]);
    expect(durationsOf({ durationMinutes: 30, durationOptions: null })).toEqual([30]);
    expect(durationSummary([30, 60])).toBe("30 min, 1 hr");
  });
});

describe("summaries", () => {
  const meet: LocationConfig = { id: uuid(1), kind: "google_conference", position: 0 };
  const venue = (n: number): LocationConfig => ({ id: uuid(10 + n), kind: "physical", position: n, location: `Venue ${n}` });

  it("location summary (ET-17)", () => {
    expect(locationSummary([])).toBe("No location given");
    expect(locationSummary([meet])).toBe("Google Meet");
    const meal = [...Array.from({ length: 8 }, (_, i) => venue(i)), { id: uuid(99), kind: "ask_invitee" as const, position: 8 }];
    expect(locationSummary(meal)).toBe("In-person meeting (8), Ask invitee");
  });

  it("availability summary (ET-19)", () => {
    const schedules: EditorScheduleOption[] = [
      {
        id: uuid(1),
        name: "Working hours",
        isDefault: true,
        content: { timezone: "America/New_York", weeklyHours: [[], [{ start: 540, end: 1020 }], [{ start: 540, end: 1020 }], [{ start: 540, end: 1020 }], [{ start: 540, end: 1020 }], [{ start: 540, end: 1020 }], []], overrides: [] },
      },
    ];
    expect(availabilitySummary({ kind: "schedule", scheduleId: uuid(1) }, schedules)).toBe("Weekdays, 9 am - 5 pm");
    expect(availabilitySummary({ kind: "schedule", scheduleId: null }, schedules)).toBe("Weekdays, 9 am - 5 pm");
    expect(
      availabilitySummary({ kind: "custom", content: { timezone: "UTC", weeklyHours: [[{ start: 540, end: 600 }], [{ start: 600, end: 660 }], [], [], [], [], []], overrides: [] } }, schedules),
    ).toBe("Hours vary");
  });

  it("limits and invitee form summaries", () => {
    expect(limitsSummary({ bufferBeforeMinutes: 0, bufferAfterMinutes: 0, limitPerDay: null, limitPerWeek: null, limitPerMonth: null })).toBe("No buffers or limits");
    expect(limitsSummary({ bufferBeforeMinutes: 15, bufferAfterMinutes: 15, limitPerDay: 3, limitPerWeek: 10, limitPerMonth: null })).toBe(
      "15 min before, 15 min after, max 3 per day, 10 per week",
    );
    expect(inviteeFormSummary(draft())).toBe("Name, Email, Guests, 1 question");
    expect(inviteeFormSummary({ ...draft(), allowGuests: false, nameFormat: "first_last", questions: [] })).toBe("First and last name, Email");
  });

  it("notice and range texts (ET-19)", () => {
    expect(noticeText(240)).toBe("4 hours");
    expect(noticeText(60)).toBe("1 hour");
    expect(noticeText(1440)).toBe("1 day");
    expect(noticeText(90)).toBe("90 minutes");
    expect(noticeText(0)).toBe("0 minutes");
    expect(noticeUnitOf(2880)).toBe("days");
    expect(rollingRangeText(60, "calendar_days")).toBe("60 days");
    expect(rollingRangeText(10, "weekdays")).toBe("10 week days");
    expect(rollingRangeText(1, "available_days")).toBe("1 day with availability");
  });

  it("html summary strips markup", () => {
    expect(htmlSummary("<p>Hello <strong>there</strong></p><p>Line &amp; two</p>")).toBe("Hello there Line & two");
  });
});

describe("dirty state and preview", () => {
  it("compares drafts regardless of key order", () => {
    const a = draft();
    const b = JSON.parse(canonicalJson(a));
    expect(draftsEqual(a, b)).toBe(true);
    expect(draftsEqual(a, { ...a, name: "Other" })).toBe(false);
  });

  it("flags availability changes only for slot settings (ET-29)", () => {
    const a = draft();
    expect(availabilityChanged(a, { ...a, name: "Renamed" })).toBe(false);
    expect(availabilityChanged(a, { ...a, minimumNoticeMinutes: 60 })).toBe(true);
    expect(availabilityChanged(a, { ...a, schedule: { kind: "schedule", scheduleId: uuid(5) } })).toBe(true);
  });

  it("builds the ARCHITECTURE 17.1 preview draft", () => {
    const p = previewDraftOf({ ...draft(), durations: [30, 60], descriptionHtml: "<p>Hi</p>", timeZoneDisplay: "locked", lockedTimeZone: "Europe/Paris" });
    expect(p).toEqual({
      name: "New Meeting",
      color: "#8247f5",
      durationMinutes: 30,
      durationOptions: [30, 60],
      locations: [],
      descriptionHtml: "<p>Hi</p>",
      priceMinor: null,
      currency: null,
      kind: "solo",
      maxInvitees: 1,
      showRemainingSpots: false,
      timeZoneDisplay: "locked",
      lockedTimeZone: "Europe/Paris",
    });
    expect(previewDraftOf(draft()).descriptionHtml).toBeNull();
  });
});

describe("slugs and names (ET-11, ET-15)", () => {
  it("de-duplicates with -2, -3", () => {
    expect(dedupeSlug("coffee", new Set())).toBe("coffee");
    expect(dedupeSlug("coffee", new Set(["coffee"]))).toBe("coffee-2");
    expect(dedupeSlug("coffee", new Set(["coffee", "coffee-2"]))).toBe("coffee-3");
    expect(dedupeSlug("", new Set())).toBe("meeting");
    const long = "a".repeat(100);
    expect(dedupeSlug(long, new Set([long])).length).toBeLessThanOrEqual(100);
  });

  it("duplicates are '{Name} (copy)' with '{slug}-copy', then '-copy-2'", () => {
    expect(copyName("30 Minute Virtual")).toBe("30 Minute Virtual (copy)");
    expect(copyName("x".repeat(100))).toHaveLength(100);
    expect(copySlugCandidates("30min", 3)).toEqual(["30min-copy", "30min-copy-2", "30min-copy-3"]);
    expect(copySlugCandidates("b".repeat(100), 1)[0]!.length).toBeLessThanOrEqual(100);
  });

  it("sorts locations by position and renumbers", () => {
    const out = sortedLocations([
      { id: uuid(2), kind: "physical", position: 5, location: "B" },
      { id: uuid(1), kind: "physical", position: 1, location: "A" },
    ]);
    expect(out.map((l) => [l.location, l.position])).toEqual([
      ["A", 0],
      ["B", 1],
    ]);
  });

  it("kinds map to UI kinds (ET-01)", () => {
    expect(uiKindOf({ kind: "solo", poolingType: null })).toBe("one_on_one");
    expect(uiKindOf({ kind: "group", poolingType: null })).toBe("group");
    expect(uiKindOf({ kind: "solo", poolingType: "round_robin" })).toBe("round_robin");
  });
});

describe("editor version (ET-14 concurrency)", () => {
  it("is stable for equal content, whatever the key order or custom schedule order", () => {
    const a = {
      ...draft(),
      schedule: {
        kind: "custom" as const,
        content: {
          timezone: "America/Los_Angeles",
          weeklyHours: [[], [{ start: 780, end: 900 }, { start: 540, end: 720 }], [], [], [], [], []] as never,
          overrides: [
            { date: "2026-12-31", intervals: [] },
            { date: "2026-12-24", intervals: [{ start: 600, end: 660 }] },
          ],
        },
      },
    };
    const reordered = JSON.parse(canonicalJson(a));
    reordered.schedule.content.weeklyHours[1].reverse();
    reordered.schedule.content.overrides.reverse();
    expect(draftVersion(reordered)).toBe(draftVersion(a));
    expect(draftVersion(a)).toMatch(/^d1-[0-9a-z]+-[0-9a-z]+$/);
  });

  it("changes with any saved setting", () => {
    const a = draft();
    expect(draftVersion({ ...a, name: "Other" })).not.toBe(draftVersion(a));
    expect(draftVersion({ ...a, secret: true })).not.toBe(draftVersion(a));
    expect(draftVersion({ ...a, limitPerDay: 2 })).not.toBe(draftVersion(a));
    expect(draftVersion({ ...a, questions: [] })).not.toBe(draftVersion(a));
  });
});

describe("number inputs keep invalid text out of the draft (ET-19, ET-21, ET-23)", () => {
  it("parses whole numbers within a range", () => {
    expect(wholeNumberIn("15", 0, 720)).toBe(15);
    expect(wholeNumberIn(" 0 ", 0, 720)).toBe(0);
    expect(wholeNumberIn("", 0, 720)).toBeNull();
    expect(wholeNumberIn("721", 0, 720)).toBeNull();
    expect(wholeNumberIn("1.5", 0, 720)).toBeNull();
    expect(wholeNumberIn("0", 1, 999)).toBeNull();
    expect(wholeNumberIn("abc", 1, 999)).toBeNull();
  });

  it("converts notice amounts to whole minutes up to 365 days (SCH-06)", () => {
    expect(noticeMinutesOf("4", 60)).toBe(240);
    expect(noticeMinutesOf("1.5", 60)).toBe(90);
    expect(noticeMinutesOf("0", 1440)).toBe(0);
    expect(noticeMinutesOf("365", 1440)).toBe(525_600);
    expect(noticeMinutesOf("366", 1440)).toBeNull();
    expect(noticeMinutesOf("1.5", 1)).toBeNull();
    expect(noticeMinutesOf("-1", 60)).toBeNull();
    expect(noticeMinutesOf("", 60)).toBeNull();
  });

  it("a NaN left by invalid input makes the draft dirty, also against an empty value", () => {
    const a = { ...draft(), bufferBeforeMinutes: 15 };
    expect(draftsEqual(a, { ...a, bufferBeforeMinutes: Number.NaN })).toBe(false);
    // "Set limit" then "0" on an event type without limits: still dirty, so Save runs and shows the error.
    expect(draftsEqual(draft(), { ...draft(), limitPerDay: Number.NaN })).toBe(false);
  });
});

describe("notifications summary (ET-25)", () => {
  it("names the confirmation kind and the reminders that are on", () => {
    expect(notificationsSummary("email_confirmation", null)).toBe("Email confirmation");
    expect(notificationsSummary("calendar_invitation", { invitee: { enabled: true }, host: { enabled: false } })).toBe("Calendar invitation, email reminders");
    expect(notificationsSummary("email_confirmation", { invitee: { enabled: true }, host: { enabled: true } })).toBe("Email confirmation, email reminders, host reminders");
    expect(notificationsSummary("calendar_invitation", { invitee: { enabled: false }, host: { enabled: false } })).toBe("Calendar invitation");
  });
});
