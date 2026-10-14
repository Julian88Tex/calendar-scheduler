// URL state of the Meetings page (SPEC MT-01 "tabs are reflected in the URL and keep filters", MT-08 "filters persist
// in the URL", MT-15 keyset pages): parsing is forgiving (bad values fall back to defaults), defaults are left out of
// URLs, a tab or filter change goes back to page 1 and keeps the other filters, and Details only adds ?event=.
import { describe, expect, it } from "vitest";
import { activeFilterCount, cleanSearch, exportHref, hasActiveFilters, isIsoDate, meetingsHref, parseEmailList, parseMeetingsQuery, type MeetingsQuery } from "@/lib/meetings/filters";
import { rangePresets } from "@/lib/meetings/ranges";

const ET1 = "11111111-1111-4111-8111-111111111111";
const ET2 = "22222222-2222-4222-8222-222222222222";
const EV = "33333333-3333-4333-8333-333333333333";

const parse = (qs: string): MeetingsQuery => parseMeetingsQuery(new URLSearchParams(qs));

describe("parseMeetingsQuery", () => {
  it("defaults to Upcoming, active events, no filters, page 1", () => {
    const q = parse("");
    expect(q).toMatchObject({ tab: "upcoming", tabExplicit: false, status: ["active"], statusExplicit: false, eventTypeIds: [], emails: [], q: "", page: 1, after: null, before: null, event: null });
  });

  it("reads every parameter and drops invalid ones", () => {
    const q = parse(`tab=past&status=canceled,active&eventTypes=${ET1},nope,${ET2},${ET1}&emails=Maya@Example.com,bad,%20b@example.com&q=%20%20maya%20%20patel%20&event=${EV}`);
    expect(q.tab).toBe("past");
    expect(q.tabExplicit).toBe(true);
    expect(q.status).toEqual(["active", "canceled"]);
    expect(q.eventTypeIds).toEqual([ET1, ET2]);
    expect(q.emails).toEqual(["maya@example.com", "b@example.com"]);
    expect(q.q).toBe("maya patel");
    expect(q.event).toBe(EV);
  });

  it("falls back on unknown tabs and statuses", () => {
    expect(parse("tab=pending").tab).toBe("upcoming");
    expect(parse("status=deleted").status).toEqual(["active"]);
    expect(parse("event=not-a-uuid").event).toBeNull();
  });

  it("keeps Date Range dates in order and fills a missing end", () => {
    expect(parse("tab=range&start=2026-10-31&end=2026-10-01")).toMatchObject({ start: "2026-10-01", end: "2026-10-31" });
    expect(parse("tab=range&start=2026-10-05")).toMatchObject({ start: "2026-10-05", end: "2026-10-05" });
    expect(parse("tab=range&start=2026-02-30")).toMatchObject({ start: null, end: null });
    expect(parse("tab=upcoming&start=2026-10-01&end=2026-10-02")).toMatchObject({ start: null, end: null });
  });

  it("ignores a cursor without a page beyond 1 and a page without a cursor", () => {
    expect(parse("after=abc").page).toBe(1);
    expect(parse("after=abc").after).toBeNull();
    expect(parse("page=3").page).toBe(1);
    expect(parse("after=abc&page=3")).toMatchObject({ after: "abc", page: 3 });
    expect(parse("after=abc&before=def&page=3")).toMatchObject({ after: "abc", before: null });
    expect(parse("after=a%20b&page=2").after).toBeNull();
  });

  it("caps the search text", () => {
    expect(cleanSearch("x".repeat(500))).toHaveLength(100);
    expect(cleanSearch("a\tb\nc")).toBe("a b c");
  });
});

describe("meetingsHref", () => {
  it("omits the defaults", () => {
    expect(meetingsHref(parse(""))).toBe("/app/meetings");
  });

  it("switches tabs keeping the filters and dropping the page and the expanded meeting", () => {
    const q = parse(`status=canceled&eventTypes=${ET1}&q=maya&after=abc&page=2&event=${EV}`);
    expect(meetingsHref(q, { tab: "past" })).toBe(`/app/meetings?tab=past&status=canceled&eventTypes=${ET1}&q=maya`);
  });

  it("adds and removes ?event= in place (keeps the page)", () => {
    const q = parse("tab=past&after=abc&page=2");
    expect(meetingsHref(q, { event: EV })).toBe(`/app/meetings?tab=past&after=abc&page=2&event=${EV}`);
    expect(meetingsHref(parse(`after=abc&page=2&event=${EV}`), { event: null })).toBe("/app/meetings?after=abc&page=2");
  });

  it("writes Date Range dates only on that tab", () => {
    const q = parse("tab=range&start=2026-10-01&end=2026-10-31");
    expect(meetingsHref(q)).toBe("/app/meetings?tab=range&start=2026-10-01&end=2026-10-31");
    expect(meetingsHref(q, { tab: "upcoming" })).toBe("/app/meetings");
  });

  it("round-trips through the parser", () => {
    const q = parse(`tab=past&status=active,canceled&emails=a@example.com&eventTypes=${ET1}&q=intro&after=abc&page=4&event=${EV}`);
    const again = parse(meetingsHref(q).split("?")[1]!);
    expect({ ...again, tabExplicit: true, statusExplicit: true }).toEqual({ ...q, tabExplicit: true, statusExplicit: true });
  });

  it("builds the export link from the tab and filters only", () => {
    const q = parse(`tab=past&status=canceled&after=abc&page=2&event=${EV}`);
    expect(exportHref(q)).toBe("/api/meetings/export?tab=past&status=canceled");
  });
});

describe("filter helpers", () => {
  it("counts active filters", () => {
    expect(hasActiveFilters(parse(""))).toBe(false);
    expect(activeFilterCount(parse(`status=canceled&eventTypes=${ET1}&emails=a@example.com&q=x`))).toBe(4);
    expect(hasActiveFilters(parse("tab=past"))).toBe(false);
  });

  it("splits invitee email lists", () => {
    expect(parseEmailList("A@example.com; b@example.com\nc@example.com, a@example.com")).toEqual({ emails: ["a@example.com", "b@example.com", "c@example.com"], invalid: [] });
    expect(parseEmailList("a@example.com, nope").invalid).toEqual(["nope"]);
  });

  it("validates calendar dates", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
  });

  it("builds the Date Range presets from today and the week start", () => {
    // Wednesday, October 14, 2026.
    const sunday = rangePresets("2026-10-14", 0);
    expect(sunday.map((p) => [p.label, p.start, p.end])).toEqual([
      ["This week", "2026-10-11", "2026-10-17"],
      ["Next week", "2026-10-18", "2026-10-24"],
      ["This month", "2026-10-01", "2026-10-31"],
      ["Next 30 days", "2026-10-14", "2026-11-12"],
      ["Last 30 days", "2026-09-15", "2026-10-14"],
    ]);
    expect(rangePresets("2026-10-14", 1)[0]).toMatchObject({ start: "2026-10-12", end: "2026-10-18" });
  });
});
