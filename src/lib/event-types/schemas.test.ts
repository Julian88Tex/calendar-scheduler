// Event type editor validation (SPEC ET-15, ET-16, ET-17, ET-19, ET-21, ET-23, ET-24, ET-26; ARCHITECTURE 5.4.5).
import { describe, expect, it } from "vitest";
import type { LocationConfig } from "@/db/types";
import { DEFAULT_QUESTION_LABEL, MAX_QUESTIONS, MESSAGES } from "./constants";
import { defaultDraft } from "./draft";
import {
  draftFieldErrors,
  firstErrorSection,
  kindProblems,
  locationIdentity,
  normalizeLocations,
  parseEditorSection,
  sectionOfField,
  validateDraft,
  zQuestion,
} from "./schemas";
import type { EventTypeDraft, QuestionDraft } from "./types";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = (): EventTypeDraft =>
  defaultDraft({ name: "30 Minute Meeting", color: "#8247f5", scheduleId: uuid(900), questionId: uuid(800) });

const errorsOf = (draft: unknown, kind: "solo" | "group" = "solo") => {
  const r = validateDraft(draft, kind);
  return r.ok ? {} : r.fieldErrors;
};

const physical = (n: number, location: string, additionalInfo?: string): LocationConfig => ({
  id: uuid(n),
  kind: "physical",
  position: n,
  location,
  ...(additionalInfo ? { additionalInfo } : {}),
});

describe("validateDraft", () => {
  it("accepts the ET-33 defaults", () => {
    const r = validateDraft(base());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft.questions[0]?.label).toBe(DEFAULT_QUESTION_LABEL);
      expect(r.draft.durations).toEqual([30]);
    }
  });

  it("requires a name of 1 to 100 characters (ET-15)", () => {
    expect(errorsOf({ ...base(), name: "   " }).name).toEqual([MESSAGES.nameRequired]);
    expect(errorsOf({ ...base(), name: "x".repeat(101) }).name).toEqual([MESSAGES.nameTooLong]);
    const r = validateDraft({ ...base(), name: "  Coffee  " });
    expect(r.ok && r.draft.name).toBe("Coffee");
  });

  it("rejects invalid custom colors with the ET-15 copy and lowercases valid ones", () => {
    expect(errorsOf({ ...base(), color: "#12345" }).color).toEqual(["Enter a valid color like #8247F5"]);
    const r = validateDraft({ ...base(), color: "#8247F5" });
    expect(r.ok && r.draft.color).toBe("#8247f5");
  });

  it("validates slugs and allows an empty slug for new types", () => {
    expect(errorsOf({ ...base(), slug: "Has Space" }).slug).toEqual([MESSAGES.slugInvalid]);
    expect(errorsOf({ ...base(), slug: "-lead" }).slug).toBeDefined();
    expect(validateDraft({ ...base(), slug: "" }).ok).toBe(true);
    const r = validateDraft({ ...base(), slug: "Coffee-Chat" });
    expect(r.ok && r.draft.slug).toBe("coffee-chat");
  });

  it("durations: 1 to 720 minutes, up to 4, no duplicates (ET-16)", () => {
    expect(errorsOf({ ...base(), durations: [0] })["durations.0"]).toEqual([MESSAGES.durationRange]);
    expect(errorsOf({ ...base(), durations: [721] })["durations.0"]).toEqual([MESSAGES.durationRange]);
    expect(errorsOf({ ...base(), durations: [] }).durations).toEqual([MESSAGES.durationRange]);
    expect(errorsOf({ ...base(), durations: [15, 30, 45, 60, 90] }).durations).toEqual([MESSAGES.durationTooMany]);
    expect(errorsOf({ ...base(), durations: [30, 60, 30] })["durations.2"]).toEqual([MESSAGES.durationDuplicate]);
    expect(validateDraft({ ...base(), durations: [30, 60] }).ok).toBe(true);
  });

  it("group events have one duration and one location (ARCHITECTURE 5.4.5, ET-17)", () => {
    const draft = { ...base(), durations: [30, 60], locations: [physical(1, "A"), physical(2, "B")] };
    expect(errorsOf(draft, "group")).toEqual({ durations: [MESSAGES.durationGroup], locations: [MESSAGES.locationGroup] });
    expect(kindProblems(draft, "solo")).toEqual({});
  });

  it("locations: in-person text required, 255 characters, no duplicates, up to 20 (ET-17)", () => {
    expect(errorsOf({ ...base(), locations: [physical(1, "")] })["locations.0.location"]).toEqual([MESSAGES.locationRequired]);
    expect(errorsOf({ ...base(), locations: [physical(1, "x".repeat(256))] })["locations.0.location"]).toEqual([MESSAGES.locationTooLong]);
    expect(errorsOf({ ...base(), locations: [physical(1, "Cafe", "y".repeat(256))] })["locations.0.additionalInfo"]).toEqual([MESSAGES.locationTooLong]);
    const meet = (n: number): LocationConfig => ({ id: uuid(n), kind: "google_conference", position: n });
    expect(errorsOf({ ...base(), locations: [meet(1), meet(2)] })["locations.1"]).toEqual([MESSAGES.locationDuplicate]);
    expect(errorsOf({ ...base(), locations: [physical(1, "Cafe"), physical(2, "cafe")] })["locations.1"]).toEqual([MESSAGES.locationDuplicate]);
    const many = Array.from({ length: 21 }, (_, i) => physical(i + 1, `Venue ${i}`));
    expect(errorsOf({ ...base(), locations: many }).locations).toEqual([MESSAGES.locationsTooMany]);
  });

  it("accepts the owner's meal event: 8 in-person venues with notes and addresses plus ask invitee (ET-17)", () => {
    const venues = Array.from({ length: 8 }, (_, i) => physical(i + 1, `Venue ${i + 1} - Downtown - $$\n[Business Casual Dress Code]`, `${100 + i} Market Street`));
    const draft = { ...base(), locations: [...venues, { id: uuid(9), kind: "ask_invitee" as const, position: 8, location: "Suggest a place" }] };
    const r = validateDraft(draft);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft.locations).toHaveLength(9);
      expect(r.draft.locations[0]?.location).toContain("\n[Business Casual Dress Code]");
    }
  });

  it("fixed date ranges need a start and an end on or after it (SCH-04)", () => {
    const range = (start: string | null, end: string | null) => ({ ...base(), dateRange: { type: "fixed" as const, days: 60, mode: "calendar_days" as const, start, end } });
    expect(errorsOf(range(null, "2026-10-22"))["dateRange.start"]).toEqual([MESSAGES.dateRangeStart]);
    expect(errorsOf(range("2026-10-22", "2026-10-20"))["dateRange.end"]).toEqual([MESSAGES.dateRangeEnd]);
    expect(validateDraft(range("2026-10-20", "2026-10-22")).ok).toBe(true);
    expect(errorsOf({ ...base(), dateRange: { ...base().dateRange, days: 0 } })["dateRange.days"]).toEqual([MESSAGES.dateRangeDays]);
  });

  it("notice, buffers, increments and limits ranges (SCH-06, SCH-07, SCH-10, ET-21)", () => {
    expect(errorsOf({ ...base(), minimumNoticeMinutes: 365 * 1440 + 1 }).minimumNoticeMinutes).toEqual([MESSAGES.notice]);
    expect(errorsOf({ ...base(), bufferBeforeMinutes: 721 }).bufferBeforeMinutes).toEqual([MESSAGES.buffer]);
    expect(errorsOf({ ...base(), slotIncrementMinutes: 4 }).slotIncrementMinutes).toEqual([MESSAGES.increment]);
    expect(errorsOf({ ...base(), limitPerDay: 0 }).limitPerDay).toEqual([MESSAGES.limit]);
    expect(errorsOf({ ...base(), limitPerWeek: 1000 }).limitPerWeek).toEqual([MESSAGES.limit]);
    expect(validateDraft({ ...base(), bufferBeforeMinutes: 15, bufferAfterMinutes: 15, limitPerDay: 3, limitPerWeek: 10 }).ok).toBe(true);
  });

  it("a locked time zone must be valid (ET-23)", () => {
    expect(errorsOf({ ...base(), timeZoneDisplay: "locked", lockedTimeZone: "Mars/Olympus" }).lockedTimeZone).toEqual([MESSAGES.timeZone]);
    expect(validateDraft({ ...base(), timeZoneDisplay: "locked", lockedTimeZone: "America/Los_Angeles" }).ok).toBe(true);
  });

  it("allows up to 10 questions (ET-24)", () => {
    const q = (n: number): QuestionDraft => ({ id: uuid(n), label: `Q${n}`, type: "string", required: false, enabled: true, answerChoices: [], includeOther: false });
    expect(validateDraft({ ...base(), questions: Array.from({ length: MAX_QUESTIONS }, (_, i) => q(i + 1)) }).ok).toBe(true);
    expect(errorsOf({ ...base(), questions: Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => q(i + 1)) }).questions).toEqual([MESSAGES.questionsTooMany]);
  });

  it("redirects need an http(s) URL; confirmation links up to 5 (ET-26)", () => {
    expect(errorsOf({ ...base(), afterBooking: "redirect", redirectUrl: "" }).redirectUrl).toEqual([MESSAGES.redirectRequired]);
    expect(errorsOf({ ...base(), afterBooking: "redirect", redirectUrl: "javascript:alert(1)" }).redirectUrl).toEqual([MESSAGES.url]);
    expect(validateDraft({ ...base(), afterBooking: "redirect", redirectUrl: "https://example.com/thanks" }).ok).toBe(true);
    const link = { label: "Docs", url: "https://example.com" };
    expect(errorsOf({ ...base(), confirmationLinks: Array.from({ length: 6 }, () => link) }).confirmationLinks).toEqual([MESSAGES.linksTooMany]);
    expect(errorsOf({ ...base(), confirmationLinks: [{ label: "", url: "https://example.com" }] })["confirmationLinks.0.label"]).toEqual([MESSAGES.linkName]);
    expect(errorsOf({ ...base(), scheduleAnotherLabel: " " }).scheduleAnotherLabel).toEqual([MESSAGES.linkName]);
  });

  it("validates custom schedule content with the availability rules (AV-04)", () => {
    const content = { timezone: "America/New_York", weeklyHours: [[], [{ start: 600, end: 540 }], [], [], [], [], []], overrides: [] };
    expect(errorsOf({ ...base(), schedule: { kind: "custom", content } })["schedule.content.weeklyHours"]).toBeDefined();
    const ok = { ...content, weeklyHours: [[], [{ start: 540, end: 1020 }], [], [], [], [], []] };
    expect(validateDraft({ ...base(), schedule: { kind: "custom", content: ok } }).ok).toBe(true);
  });
});

describe("zQuestion", () => {
  const q = (patch: Partial<QuestionDraft>) => ({ id: uuid(1), label: "Pick one", type: "single_select", required: true, enabled: true, answerChoices: ["A", "B"], includeOther: true, ...patch });

  it("choice types need 1 to 50 unique non-empty choices", () => {
    expect(zQuestion.safeParse(q({})).success).toBe(true);
    const empty = zQuestion.safeParse(q({ answerChoices: [] }));
    expect(empty.success).toBe(false);
    const dupe = zQuestion.safeParse(q({ answerChoices: ["A", "a"] }));
    expect(!dupe.success && dupe.error.issues[0]?.message).toBe(MESSAGES.choiceDuplicate);
    const long = zQuestion.safeParse(q({ answerChoices: ["x".repeat(201)] }));
    expect(!long.success && long.error.issues[0]?.message).toBe(MESSAGES.choiceTooLong);
  });

  it("non-choice types drop choices and the other option", () => {
    const r = zQuestion.safeParse(q({ type: "string" }));
    expect(r.success && r.data.answerChoices).toEqual([]);
    expect(r.success && r.data.includeOther).toBe(false);
  });

  it("requires a label of up to 500 characters", () => {
    expect(zQuestion.safeParse(q({ label: " " })).success).toBe(false);
    expect(zQuestion.safeParse(q({ label: "x".repeat(501) })).success).toBe(false);
  });
});

describe("locations helpers", () => {
  it("normalizes positions and display flags", () => {
    const out = normalizeLocations([
      { id: uuid(2), kind: "custom", position: 7, location: " Link " },
      { id: uuid(1), kind: "physical", position: 3, location: "Cafe", additionalInfo: " " },
    ]);
    expect(out).toEqual([
      { id: uuid(2), kind: "custom", position: 0, location: "Link", displayBeforeBooking: false },
      { id: uuid(1), kind: "physical", position: 1, location: "Cafe", displayBeforeBooking: true },
    ]);
  });

  it("identifies singleton kinds by kind only", () => {
    expect(locationIdentity({ id: uuid(1), kind: "google_conference", position: 0 })).toBe("google_conference");
    expect(locationIdentity(physical(1, "Cafe", "1 Main"))).toBe("physical:cafe:1 main:");
  });
});

describe("sections", () => {
  it("maps field errors to editor sections and finds the first failing one", () => {
    expect(sectionOfField("locations.0.location")).toBe("location");
    expect(sectionOfField("draft.slug")).toBe("bookingPage");
    expect(sectionOfField("_form")).toBeNull();
    expect(firstErrorSection({ "questions.1.label": ["x"], name: ["y"] })).toBe("details");
    expect(firstErrorSection({ redirectUrl: ["x"], bufferBeforeMinutes: ["y"] })).toBe("limits");
    expect(draftFieldErrors({ "draft.name": ["a"], slug: ["b"] })).toEqual({ name: ["a"], slug: ["b"] });
    expect(parseEditorSection("limits")).toBe("limits");
    expect(parseEditorSection(["bookingPage"])).toBe("bookingPage");
    expect(parseEditorSection("nope")).toBeNull();
  });
});
