import { describe, expect, it } from "vitest";
import { buildPollCsv, csvField, csvFileName } from "./csv";
import { commonDuration, groupOptionsByLocalDate, optionLongLabel, optionShortLabel, optionTimeLabel } from "./display";

describe("CSV export (MP-32)", () => {
  it("one row per participant, Yes / If need be / No / blank cells", () => {
    const csv = buildPollCsv(
      [
        { id: "o1", label: "Tue, Oct 20, 10:00am" },
        { id: "o2", label: "Wed, Oct 21, 2:00pm" },
      ],
      [
        { name: "Ana Lima", email: "ana@example.com", status: "responded", votes: { o1: "yes", o2: "if_need_be" }, commentCount: 1 },
        { name: "Bob", email: null, status: "declined", votes: { o1: "no", o2: "no" }, commentCount: 0 },
        { name: "Ivy", email: "ivy@example.com", status: "invited", votes: {}, commentCount: 0 },
      ],
    );
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('Name,Email,Status,Comments,"Tue, Oct 20, 10:00am","Wed, Oct 21, 2:00pm"');
    expect(lines[1]).toBe("Ana Lima,ana@example.com,Responded,1,Yes,If need be");
    expect(lines[2]).toBe("Bob,,Declined,0,No,No");
    expect(lines[3]).toBe("Ivy,ivy@example.com,\"Invited, no response\",0,,");
  });

  it("quotes and neutralizes formulas", () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField("-5")).toBe("'-5");
    expect(csvField("a\nb")).toBe('"a\nb"');
  });

  it("file names", () => {
    expect(csvFileName("Team Sync: Q4!")).toBe("team-sync-q4-responses.csv");
    expect(csvFileName("!!!")).toBe("meeting-poll-responses.csv");
  });
});

describe("option display (MP-07, MP-29)", () => {
  const o1 = { start: "2026-10-20T14:00:00Z", end: "2026-10-20T14:30:00Z", allDayDate: null, durationMinutes: 30 };
  const late = { start: "2026-10-21T03:30:00Z", end: "2026-10-21T05:00:00Z", allDayDate: null, durationMinutes: 90 };
  const day = { start: null, end: null, allDayDate: "2026-10-23", durationMinutes: 1440 };

  it("labels times in the viewer's zone, with (ends next day)", () => {
    expect(optionTimeLabel(o1, "America/New_York")).toBe("10:00am - 10:30am");
    expect(optionTimeLabel(o1, "Asia/Kolkata", { hour12: false })).toBe("19:30 - 20:00");
    expect(optionTimeLabel(late, "America/New_York")).toBe("11:30pm - 1:00am (ends next day)");
    expect(optionTimeLabel(day, "Asia/Kolkata")).toBe("All day");
    expect(optionLongLabel(o1, "America/New_York")).toBe("Tuesday, October 20, 2026, 10:00am - 10:30am");
    expect(optionShortLabel(o1, "America/New_York")).toBe("Tue, Oct 20, 10:00am");
  });

  it("groups by the viewer's local date; date-only options keep their date for everyone", () => {
    const groups = groupOptionsByLocalDate([late, o1, day], "Asia/Kolkata", "America/New_York");
    expect(groups.map((g) => g.date)).toEqual(["2026-10-20", "2026-10-21", "2026-10-23"]);
    expect(groups[1]!.label).toBe("Wednesday, October 21, 2026");
    const ny = groupOptionsByLocalDate([late, o1, day], "America/New_York", "America/New_York");
    expect(ny.map((g) => [g.date, g.options.length])).toEqual([
      ["2026-10-20", 2],
      ["2026-10-23", 1],
    ]);
  });

  it("common duration or Varies", () => {
    expect(commonDuration([o1, o1])).toBe(30);
    expect(commonDuration([o1, late])).toBeNull();
    expect(commonDuration([day])).toBe(1440);
  });
});
