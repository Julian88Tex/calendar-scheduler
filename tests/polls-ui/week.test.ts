// Week grid model of the poll creation calendar (SPEC MP-02, MP-29): 15 minute rows in the grid zone, the fall back
// hour as one contiguous repeated block with offset labels, the spring forward gap as nonexistent cells, pixel and
// instant mapping both ways, segments across local midnight, and side by side lanes for overlapping times.
import { describe, expect, it } from "vitest";
import { assignLanes, buildWeekModel, hourText, initialScrollRow, instantAt, segmentsFor, STEP_MS, yOf } from "@/components/polls/lib/week";

const NY = "America/New_York";
const H = 20;
const ms = (iso: string) => new Date(iso).getTime();

describe("hourText", () => {
  it("formats 12 and 24 hour gutter labels", () => {
    expect(hourText(0, true)).toBe("12am");
    expect(hourText(9 * 60, true)).toBe("9am");
    expect(hourText(12 * 60, true)).toBe("12pm");
    expect(hourText(13 * 60 + 30, true)).toBe("1:30pm");
    expect(hourText(9 * 60, false)).toBe("09:00");
    expect(hourText(23 * 60 + 45, false)).toBe("23:45");
  });
});

describe("buildWeekModel on an ordinary week", () => {
  const dates = ["2026-10-19", "2026-10-20"];
  const model = buildWeekModel(dates, NY, { now: ms("2026-10-19T14:00:00Z"), hour12: true });

  it("has 96 rows with hour labels on full hours", () => {
    expect(model.rows).toHaveLength(96);
    expect(model.rows[0]!.hourLabel).toBe("12am");
    expect(model.rows[1]!.hourLabel).toBeNull();
    expect(model.rows[40]!.hourLabel).toBe("10am");
  });

  it("maps each cell to the UTC instant of the wall time and flags past cells", () => {
    const cell = model.cells["2026-10-19"]![40]!;
    expect(cell).toEqual({ state: "ok", start: ms("2026-10-19T14:00:00Z"), past: false });
    expect(model.cells["2026-10-19"]![39]).toMatchObject({ state: "ok", past: true });
    expect(model.bounds["2026-10-20"]).toEqual({ start: ms("2026-10-20T04:00:00Z"), end: ms("2026-10-21T04:00:00Z") });
  });

  it("converts between pixels and instants", () => {
    const tenAm = ms("2026-10-20T14:00:00Z");
    expect(yOf(model, "2026-10-20", tenAm, H)).toBe(40 * H);
    expect(yOf(model, "2026-10-20", tenAm + STEP_MS / 2, H)).toBe(40.5 * H);
    expect(instantAt(model, "2026-10-20", 40 * H + 3, H)).toBe(tenAm);
    // 5 minute snapping (Alt drag) inside a row, and rounding to the nearest boundary for drag ends.
    expect(instantAt(model, "2026-10-20", 40 * H + 9, H, { snapMinutes: 5 })).toBe(tenAm + 5 * 60_000);
    expect(instantAt(model, "2026-10-20", 40 * H + 15, H, { mode: "round" })).toBe(tenAm + STEP_MS);
    expect(instantAt(model, "2026-10-20", 96 * H + 50, H)).toBe(model.bounds["2026-10-20"]!.end);
  });

  it("splits an interval across local midnight into two segments", () => {
    const segs = segmentsFor(model, { start: ms("2026-10-20T03:00:00Z"), end: ms("2026-10-20T05:00:00Z") }, H);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ date: "2026-10-19", bottom: 96 * H, continuesAfter: true, continuesBefore: false });
    expect(segs[1]).toMatchObject({ date: "2026-10-20", top: 0, continuesBefore: true, continuesAfter: false });
  });

  it("scrolls first to half an hour before working hours, else 7am", () => {
    expect(model.rows[initialScrollRow(model, 9 * 60)]!.minutes).toBe(8 * 60 + 30);
    expect(model.rows[initialScrollRow(model, null)]!.minutes).toBe(6 * 60 + 30);
  });
});

describe("buildWeekModel across daylight saving changes", () => {
  it("lays the repeated fall back hour out as one block labelled with its offsets", () => {
    const model = buildWeekModel(["2026-10-31", "2026-11-01"], NY, { now: 0, hour12: true });
    expect(model.rows).toHaveLength(100);
    const ones = model.rows.filter((r) => r.minutes === 60);
    expect(ones.map((r) => [r.variant, r.hourLabel])).toEqual([
      [0, "1am (EDT)"],
      [1, "1am (EST)"],
    ]);
    // The repeated rows follow the first block: 1:00, 1:15, 1:30, 1:45 (EDT) then 1:00 ... 1:45 (EST).
    const block = model.rows.slice(4, 12).map((r) => `${r.minutes}:${r.variant}`);
    expect(block).toEqual(["60:0", "75:0", "90:0", "105:0", "60:1", "75:1", "90:1", "105:1"]);
    // Instants increase top to bottom on the fall back date; the repeated rows are absent the day before.
    const starts = model.index["2026-11-01"]!.map((c) => c.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(model.index["2026-11-01"]!.map((c) => c.row)).toEqual([...model.index["2026-11-01"]!.map((c) => c.row)].sort((a, b) => a - b));
    expect(model.cells["2026-10-31"]![8]).toEqual({ state: "absent" });
    expect(model.cells["2026-11-01"]![4]).toMatchObject({ start: ms("2026-11-01T05:00:00Z") });
    expect(model.cells["2026-11-01"]![8]).toMatchObject({ start: ms("2026-11-01T06:00:00Z") });
  });

  it("marks the skipped spring forward hour as nonexistent", () => {
    const model = buildWeekModel(["2026-03-08"], NY, { now: 0, hour12: true });
    expect(model.rows).toHaveLength(96);
    for (const row of [8, 9, 10, 11]) expect(model.cells["2026-03-08"]![row]).toEqual({ state: "nonexistent" });
    expect(instantAt(model, "2026-03-08", 9 * H, H)).toBeNull();
    // A drag end over the gap lands on the next real instant (3:00am EDT).
    expect(instantAt(model, "2026-03-08", 9 * H, H, { mode: "round" })).toBe(ms("2026-03-08T07:00:00Z"));
  });
});

describe("assignLanes", () => {
  it("puts overlapping times side by side and keeps separate clusters full width", () => {
    const out = assignLanes([
      { id: "a", start: 0, end: 30 },
      { id: "b", start: 15, end: 45 },
      { id: "c", start: 30, end: 60 },
      { id: "d", start: 100, end: 130 },
    ]);
    const by = Object.fromEntries(out.map((o) => [o.id, [o.lane, o.lanes]]));
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
  });
});
