import { describe, expect, it } from "vitest";
import { commonDuration, groupOptionsByLocalDate, optionTimeLabel, timesAsText } from "./display";

const LA = "America/Los_Angeles";
const o = (start: string, minutes: number) => ({
  start: new Date(start).toISOString(),
  end: new Date(new Date(start).getTime() + minutes * 60_000).toISOString(),
  allDayDate: null,
  durationMinutes: minutes,
});

describe("option display (MP-07, MP-29)", () => {
  it("groups by the viewer's local date: the same instants can land on other dates", () => {
    const options = [o("2030-10-09T23:30:00-07:00", 60), o("2030-10-09T10:00:00-07:00", 30)];
    expect(groupOptionsByLocalDate(options, LA, LA).map((g) => [g.label, g.options.length])).toEqual([["Wednesday, October 9, 2030", 2]]);
    expect(groupOptionsByLocalDate(options, "Asia/Kolkata", LA).map((g) => g.label)).toEqual(["Wednesday, October 9, 2030", "Thursday, October 10, 2030"]);
  });

  it("labels ranges that end the next day and keeps date-only options on their date", () => {
    expect(optionTimeLabel(o("2030-10-09T23:30:00-07:00", 60), LA)).toBe("11:30pm - 12:30am (ends next day)");
    expect(optionTimeLabel({ start: null, end: null, allDayDate: "2030-10-12", durationMinutes: 1440 }, "Asia/Tokyo")).toBe("All day");
    expect(commonDuration([{ durationMinutes: 30, allDayDate: null }, { durationMinutes: 60, allDayDate: null }])).toBeNull();
    expect(commonDuration([{ durationMinutes: 30, allDayDate: null }])).toBe(30);
  });

  it("copies the times as text with the zone and the link (MP-05)", () => {
    const text = timesAsText([o("2030-10-09T10:00:00-07:00", 30), o("2030-10-10T14:00:00-07:00", 30)], {
      zone: LA,
      pollZone: LA,
      zoneLabel: "Pacific Time - US & Canada",
      link: "http://localhost:3000/p/team-sync",
    });
    expect(text).toBe(
      [
        "Wednesday, October 9, 2030\n10:00am - 10:30am",
        "Thursday, October 10, 2030\n2:00pm - 2:30pm",
        "Times are shown in Pacific Time - US & Canada.\nVote on times: http://localhost:3000/p/team-sync",
      ].join("\n\n"),
    );
  });
});
