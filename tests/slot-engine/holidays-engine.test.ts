// AV-13 end to end through the engine: holidays from src/lib/holidays become blockedDates of a schedule, beat
// date-specific hours, and the user's Off switch restores the date. Troubleshooting shows HOLIDAY.
import { describe, expect, it } from "vitest";
import { blockedDatesFor, getHolidays } from "@/lib/holidays";
import { computeSlots } from "@/lib/slots";
import { LA, LONDON, at, dayRange, host, input, rules, schedule, startLocals, weekly } from "@/lib/slots/testing";

const range = { start: "2026-11-20", end: "2026-11-30" };

function run(overrides: Record<string, boolean>, extra: { dateOverrides?: Record<string, { start: number; end: number }[]> } = {}) {
  const blockedDates = blockedDatesFor("US", overrides, range.start, range.end, LA);
  return computeSlots(
    input({
      rules: rules({ incrementMinutes: 60, rangeZone: LA }),
      hosts: [host("h", { schedule: schedule(LA, weekly({ all: [["09:00", "17:00"]] }), { blockedDates, overrides: extra.dateOverrides ?? {} }) })],
      query: dayRange("2026-11-26", LA),
    }),
  );
}

describe("holidays in the slot engine (AV-13)", () => {
  it("with United States selected and Thanksgiving On, Nov 26 2026 has no slots; turning it Off restores them", () => {
    expect(run({}).slots).toEqual([]);
    const key = getHolidays("US", 2026).find((h) => h.name === "Thanksgiving Day")!.key;
    expect(run({ [key]: false }).slots).toHaveLength(8);
  });

  it("holidays beat date-specific hours", () => {
    expect(run({}, { dateOverrides: { "2026-11-26": [{ start: 600, end: 720 }] } }).slots).toEqual([]);
  });

  it("troubleshooting shows HOLIDAY on the times the holiday removed", () => {
    const blockedDates = blockedDatesFor("US", {}, range.start, range.end, LA);
    const r = computeSlots(
      input({
        rules: rules({ incrementMinutes: 60, rangeZone: LA }),
        hosts: [host("h", { schedule: schedule(LA, weekly({ all: [["09:00", "17:00"]] }), { blockedDates }) })],
        query: { ...dayRange("2026-11-26", LA), troubleshoot: true },
      }),
    );
    expect(r.diagnostics!.map((d) => d.reasons.join())).toEqual(Array(8).fill("HOLIDAY"));
  });

  it("the UK 2027 substitute day for Christmas (Dec 27) blocks the Monday while it is On", () => {
    const zone = LONDON;
    const sched = (blockedDates: string[]) => schedule(zone, weekly({ weekdays: [["09:00", "17:00"]] }), { blockedDates });
    const slotsFor = (overrides: Record<string, boolean>) =>
      startLocals(
        computeSlots(
          input({
            rules: rules({ incrementMinutes: 240, rangeZone: zone }),
            hosts: [host("h", { schedule: sched(blockedDatesFor("GB", overrides, "2027-12-27", "2027-12-29", zone)) })],
            query: { rangeStart: at("2027-12-27 00:00", zone), rangeEnd: at("2027-12-30 00:00", zone) },
          }),
        ),
        zone,
      );
    expect(slotsFor({})).toEqual(["2027-12-29 09:00", "2027-12-29 13:00"]);
    expect(slotsFor({ "GB:12-25:substitute": false })).toEqual(["2027-12-27 09:00", "2027-12-27 13:00", "2027-12-29 09:00", "2027-12-29 13:00"]);
  });
});
