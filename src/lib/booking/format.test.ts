// groupSlotsByLocalDate (SCH-22), firstAvailableDate and local date ranges.
import { describe, expect, it } from "vitest";
import type { Slot } from "@/lib/slots/types";
import { firstAvailableDate, groupSlotsByLocalDate, localDateRange, localDateSpan } from "./format";

const slot = (iso: string, remaining = 1): Slot => ({
  start: Date.parse(iso),
  end: Date.parse(iso) + 30 * 60_000,
  inviteesRemaining: remaining,
  eligibleHostIds: [],
  eligibleByPool: {},
});

describe("groupSlotsByLocalDate", () => {
  it("lists a Los Angeles 17:00 slot under the next date in Europe/Berlin at 01:00 (SCH-22)", () => {
    // Oct 26 2026: Berlin is back on CET (+1) while Los Angeles is still on PDT (-7).
    const s = slot("2026-10-27T00:00:00Z"); // 17:00 PDT on Oct 26
    expect(groupSlotsByLocalDate([s], "America/Los_Angeles")).toEqual({
      "2026-10-26": [{ start: "2026-10-27T00:00:00.000Z", remaining: 1 }],
    });
    const berlin = groupSlotsByLocalDate([s], "Europe/Berlin");
    expect(Object.keys(berlin)).toEqual(["2026-10-27"]);
    expect(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(s.start)).toBe("01:00");
  });

  it("keeps the slot order and the remaining seats per date", () => {
    const out = groupSlotsByLocalDate(
      [slot("2030-01-10T15:00:00Z", 3), slot("2030-01-10T23:30:00Z", 2), slot("2030-01-11T15:00:00Z")],
      "America/New_York",
    );
    expect(out).toEqual({
      "2030-01-10": [
        { start: "2030-01-10T15:00:00.000Z", remaining: 3 },
        { start: "2030-01-10T23:30:00.000Z", remaining: 2 },
      ],
      "2030-01-11": [{ start: "2030-01-11T15:00:00.000Z", remaining: 1 }],
    });
    expect(firstAvailableDate(out)).toBe("2030-01-10");
    expect(firstAvailableDate({})).toBeNull();
  });
});

describe("localDateRange", () => {
  it("covers whole local dates, DST safe", () => {
    const r = localDateRange("2026-11-01", "2026-11-01", "America/New_York");
    expect(r.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-11-02T05:00:00.000Z"); // 25 hour day
    expect(localDateSpan("2026-10-01", "2026-12-01")).toBe(62);
  });
});
