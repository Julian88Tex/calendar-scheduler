import { describe, expect, it } from "vitest";
import {
  copyDayTimes,
  dayEnd,
  dayStart,
  freeTimesForDay,
  gridRows,
  instantsForWallTime,
  localDate,
  optionFromCell,
  weekDates,
  workingIntervals,
} from "./grid";

const NY = "America/New_York";
const BERLIN = "Europe/Berlin";

describe("wall clock to instants (MP-29)", () => {
  it("spring forward gap: 02:30 does not exist on 2026-03-08 in New York", () => {
    expect(instantsForWallTime("2026-03-08", 150, NY)).toEqual([]);
    expect(instantsForWallTime("2026-03-08", 180, NY)).toEqual([Date.parse("2026-03-08T07:00:00Z")]);
  });

  it("fall back overlap: 01:30 happens twice on 2026-11-01 in New York (EDT then EST)", () => {
    expect(instantsForWallTime("2026-11-01", 90, NY)).toEqual([Date.parse("2026-11-01T05:30:00Z"), Date.parse("2026-11-01T06:30:00Z")]);
    expect(instantsForWallTime("2026-11-01", 150, NY)).toEqual([Date.parse("2026-11-01T07:30:00Z")]);
  });

  it("Europe/Berlin: 2026-03-29 02:00 gap and 2026-10-25 02:00 overlap", () => {
    expect(instantsForWallTime("2026-03-29", 120, BERLIN)).toEqual([]);
    expect(instantsForWallTime("2026-10-25", 150, BERLIN)).toEqual([Date.parse("2026-10-25T00:30:00Z"), Date.parse("2026-10-25T01:30:00Z")]);
  });
});

describe("grid rows", () => {
  it("marks nonexistent cells and adds labelled repeated rows on fall back days", () => {
    const rows = gridRows(["2026-03-08", "2026-11-01"], NY, { step: 30, now: 0 });
    const r0230 = rows.find((r) => r.minutes === 150 && r.variant === 0)!;
    expect(r0230.cells["2026-03-08"]).toEqual({ state: "nonexistent" });
    const first = rows.find((r) => r.minutes === 60 && r.variant === 0)!;
    const second = rows.find((r) => r.minutes === 60 && r.variant === 1)!;
    expect(first.cells["2026-11-01"]).toMatchObject({ state: "ok", offsetLabel: "EDT" });
    expect(second.cells["2026-11-01"]).toMatchObject({ state: "ok", offsetLabel: "EST" });
    expect(second.cells["2026-03-08"]).toEqual({ state: "absent" });
    // 48 half-hour rows plus the two repeated rows of the fall back hour.
    expect(rows.length).toBe(50);
  });

  it("flags past cells", () => {
    const rows = gridRows(["2026-10-20"], NY, { step: 60, now: Date.parse("2026-10-20T14:30:00Z") });
    expect(rows[10]!.cells["2026-10-20"]).toMatchObject({ past: true }); // 10:00 EDT = 14:00Z
    expect(rows[11]!.cells["2026-10-20"]).toMatchObject({ past: false });
  });

  it("durations are absolute minutes across the fall back change", () => {
    const [edt] = instantsForWallTime("2026-11-01", 90, NY);
    const o = optionFromCell(edt!, 60);
    expect(o).toEqual({ start: "2026-11-01T05:30:00.000Z", end: "2026-11-01T06:30:00.000Z" }); // ends 01:30 EST
  });

  it("week dates honor the week start", () => {
    expect(weekDates("2026-10-21", 0)).toEqual(["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"]);
    expect(weekDates("2026-10-18", 1)[0]).toBe("2026-10-12");
  });
});

describe("copy and fill", () => {
  it("copying a day's times keeps the wall clock across a DST change", () => {
    // 09:00 Berlin on Friday 2026-10-23 (CEST, UTC+2) copied to Monday 2026-10-26 (CET, UTC+1).
    const copied = copyDayTimes([{ start: "2026-10-23T07:00:00Z", end: "2026-10-23T07:30:00Z" }], "2026-10-23", ["2026-10-26"], BERLIN);
    expect(copied).toEqual([{ start: "2026-10-26T08:00:00.000Z", end: "2026-10-26T08:30:00.000Z" }]);
  });

  it("local days and all-day bounds follow the zone (23 and 25 hour days)", () => {
    expect(dayEnd("2026-03-08", NY) - dayStart("2026-03-08", NY)).toBe(23 * 3_600_000);
    expect(dayEnd("2026-11-01", NY) - dayStart("2026-11-01", NY)).toBe(25 * 3_600_000);
    expect(localDate(Date.parse("2026-10-21T02:00:00Z"), NY)).toBe("2026-10-20");
  });

  it("working intervals apply overrides, then add all free times skips busy blocks", () => {
    const weekly = [[], [{ start: 540, end: 720 }], [], [], [], [], []] as { start: number; end: number }[][];
    const working = workingIntervals({ timeZone: NY, weekly, overrides: { "2026-10-26": [{ start: 600, end: 660 }] } }, ["2026-10-19", "2026-10-26"]);
    expect(working).toEqual([
      { start: Date.parse("2026-10-19T13:00:00Z"), end: Date.parse("2026-10-19T16:00:00Z") },
      { start: Date.parse("2026-10-26T14:00:00Z"), end: Date.parse("2026-10-26T15:00:00Z") },
    ]);
    const free = freeTimesForDay({
      date: "2026-10-19",
      zone: NY,
      durationMinutes: 60,
      working,
      busy: [{ start: Date.parse("2026-10-19T14:15:00Z"), end: Date.parse("2026-10-19T14:45:00Z") }],
      now: 0,
    });
    expect(free).toEqual([
      { start: "2026-10-19T13:00:00.000Z", end: "2026-10-19T14:00:00.000Z" },
      { start: "2026-10-19T14:45:00.000Z", end: "2026-10-19T15:45:00.000Z" },
    ]);
  });
});
