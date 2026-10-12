// Candidate grid (SCH-10) and candidate merging.
import { describe, expect, it } from "vitest";
import { gridStarts, mergeCandidates, shortBlockStarts, spotCandidates } from "./candidates";
import { NY, UTC, at, timeOf } from "./testing";

const t = (time: string, date = "2026-10-13", zone = UTC) => at(`${date} ${time}`, zone);
const opts = (extra: Partial<Parameters<typeof gridStarts>[2]> = {}) => ({
  durationMs: 30 * 60_000,
  incrementMinutes: 30,
  alignment: "interval_start" as const,
  rangeZone: UTC,
  from: t("00:00"),
  to: t("00:00", "2026-10-14"),
  ...extra,
});
const block = (s: string, e: string) => ({ start: t(s), end: t(e) });
const times = (list: number[], zone = UTC) => list.map((s) => timeOf(s, zone));

describe("gridStarts", () => {
  it("interval_start steps from each anchor's start while the meeting fits the containment block", () => {
    const anchors = [block("09:05", "11:00")];
    expect(times(gridStarts(anchors, anchors, opts()))).toEqual(["09:05", "09:35", "10:05"]);
  });

  it("hour alignment snaps to multiples of the increment since local midnight", () => {
    const anchors = [block("09:05", "11:00")];
    expect(times(gridStarts(anchors, anchors, opts({ alignment: "hour" })))).toEqual(["09:30", "10:00", "10:30"]);
    expect(times(gridStarts(anchors, anchors, opts({ alignment: "hour", incrementMinutes: 45 })))).toEqual(["09:45", "10:30"]);
  });

  it("a start may cross into the next anchor when containment continues", () => {
    const anchors = [block("22:00", "23:59"), { start: t("23:59"), end: t("02:00", "2026-10-14") }];
    const containment = [{ start: t("22:00"), end: t("02:00", "2026-10-14") }];
    expect(times(gridStarts(anchors, containment, opts({ durationMs: 60 * 60_000, to: t("00:00", "2026-10-15") })))).toEqual([
      "22:00",
      "22:30",
      "23:00",
      "23:30",
      "23:59",
      "00:29",
      "00:59",
    ]);
  });

  it("respects [from, to) without moving the grid", () => {
    const anchors = [block("09:00", "12:00")];
    expect(times(gridStarts(anchors, anchors, opts({ from: t("10:10"), to: t("11:30") })))).toEqual(["10:30", "11:00"]);
  });

  it("hour alignment skips nonexistent times on spring forward days", () => {
    const anchors = [{ start: at("2026-03-08 00:00", NY), end: at("2026-03-08 06:00", NY) }];
    const starts = gridStarts(anchors, anchors, opts({ alignment: "hour", rangeZone: NY, from: anchors[0]!.start, to: anchors[0]!.end }));
    expect(times(starts, NY)).toEqual(["00:00", "00:30", "01:00", "01:30", "03:00", "03:30", "04:00", "04:30", "05:00", "05:30"]);
  });

  it("an increment of 0 or below is treated as 1 minute instead of looping forever", () => {
    const anchors = [block("09:00", "09:03")];
    expect(gridStarts(anchors, anchors, opts({ incrementMinutes: 0, durationMs: 60_000 }))).toHaveLength(3);
  });
});

describe("helpers", () => {
  it("shortBlockStarts reports containment blocks shorter than the duration", () => {
    expect(times(shortBlockStarts([block("09:00", "09:20"), block("10:00", "11:00")], 30 * 60_000, t("00:00"), t("23:00")))).toEqual(["09:00"]);
  });

  it("mergeCandidates sorts, dedupes and keeps real origins over diagnostic ones", () => {
    const merged = mergeCandidates([
      [{ start: 2, end: 3, origin: "holiday" }],
      [
        { start: 2, end: 3, origin: "grid" },
        { start: 1, end: 2, origin: "group" },
      ],
    ]);
    expect(merged).toEqual([
      { start: 1, end: 2, origin: "group" },
      { start: 2, end: 3, origin: "grid" },
    ]);
  });

  it("spotCandidates keeps valid spots inside [from, to)", () => {
    expect(
      spotCandidates(
        [
          { start: 5, end: 10 },
          { start: 10, end: 9 },
          { start: 50, end: 60 },
        ],
        0,
        40,
      ),
    ).toEqual([{ start: 5, end: 10, origin: "spot" }]);
  });
});
