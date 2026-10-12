// Time zones, formatting and wall-clock math (SPEC GEN-06, GEN-10, GEN-23).
import { describe, expect, it } from "vitest";
import {
  formatDateLong,
  formatDateMedium,
  formatDateShort,
  formatDuration,
  formatMeetingWhen,
  formatMonthYear,
  formatNumericDate,
  formatOffset,
  formatTime,
  formatTimeRange,
  formatZoneLabel,
  formatZoneWithTime,
  hour12For,
  isoDateInZone,
} from "@/lib/time/format";
import {
  DateTime,
  Settings,
  addDays,
  eachDate,
  localDateOf,
  localMinutesOf,
  monthBounds,
  startOfLocalDay,
  wallClockToUtc,
  weekdayOf,
  zoneOffsetMinutes,
} from "@/lib/time/luxon";
import {
  TIME_ZONES,
  ZONE_GROUPS,
  ZONE_NAMES_EN,
  currentLocalTime,
  findZoneEntry,
  friendlyZoneName,
  groupForZone,
  groupedZones,
  isValidTimeZone,
  offsetMinutesAt,
  searchZones,
  zoneOrUtc,
  zonesEquivalent,
} from "@/lib/time/zones";

const OCT14 = new Date("2026-10-14T14:00:00Z"); // Wednesday; 10:00am New York (EDT)

describe("zone catalog", () => {
  it("has valid, unique ids in GEN-06 groups with Calendly style names", () => {
    const ids = TIME_ZONES.map((z) => z.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const z of TIME_ZONES) {
      expect(isValidTimeZone(z.id), z.id).toBe(true);
      expect(ZONE_GROUPS).toContain(z.group);
      expect(z.name).not.toMatch(/[\u2013\u2014]/);
    }
    expect(ZONE_NAMES_EN["America/New_York"]).toBe("Eastern Time - US & Canada");
    expect(ZONE_NAMES_EN["America/Los_Angeles"]).toBe("Pacific Time - US & Canada");
    expect(ZONE_NAMES_EN["Europe/Berlin"]).toBe("Central European Time");
    expect(groupedZones().map((g) => g.group)).toEqual([...ZONE_GROUPS]);
  });

  it("resolves aliases and legacy names, and accepts any valid IANA zone", () => {
    expect(friendlyZoneName("Asia/Kolkata")).toBe("India, Sri Lanka Time");
    expect(friendlyZoneName("Asia/Calcutta")).toBe("India, Sri Lanka Time");
    expect(friendlyZoneName("Europe/Kyiv")).toBe("Eastern European Time");
    expect(friendlyZoneName("Europe/Paris")).toBe("Central European Time");
    expect(friendlyZoneName("America/Detroit")).toBe("Eastern Time - US & Canada");
    expect(friendlyZoneName("UTC")).toBe("UTC Time");
    expect(friendlyZoneName("Etc/UTC")).toBe("UTC Time");
    expect(findZoneEntry("America/Godthab")?.id).toBe("America/Nuuk");
    expect(isValidTimeZone("Asia/Calcutta")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(zoneOrUtc("Mars/Olympus")).toBe("UTC");
    expect(zoneOrUtc("Asia/Calcutta")).toBe("Asia/Calcutta");
    // A real zone without a catalog entry still gets a readable name and a group.
    expect(friendlyZoneName("America/Argentina/Cordoba")).toMatch(/Time/);
    expect(groupForZone("America/Argentina/Cordoba")).toBe("AMERICA");
    const extra = groupedZones({ extraZone: "America/Argentina/Cordoba" });
    expect(extra.find((g) => g.group === "AMERICA")!.zones.some((z) => z.id === "America/Argentina/Cordoba")).toBe(true);
  });

  it("localizes zone names for invitee locales (GEN-10) and accepts a catalog override", () => {
    expect(friendlyZoneName("Europe/Berlin", "de")).toBe("Mitteleuropäische Zeit");
    expect(friendlyZoneName("Europe/Berlin", "en")).toBe("Central European Time");
    expect(friendlyZoneName("Europe/Berlin", "fr", { "Europe/Berlin": "Heure d'Europe centrale (catalogue)" })).toBe(
      "Heure d'Europe centrale (catalogue)",
    );
    expect(formatZoneLabel("America/New_York", "en")).toBe("Eastern Time - US & Canada");
  });

  it("shows the current local time next to each zone", () => {
    expect(currentLocalTime("America/New_York", { at: OCT14 })).toBe("10:00am");
    expect(currentLocalTime("America/New_York", { at: OCT14, hour12: false })).toBe("10:00");
    expect(formatZoneWithTime("America/New_York", { at: new Date("2026-10-14T22:53:00Z") })).toBe(
      "Eastern Time - US & Canada (6:53pm)",
    );
  });

  it("searches names and ids", () => {
    expect(searchZones("eastern").map((z) => z.id)).toContain("America/New_York");
    expect(searchZones("new york").map((z) => z.id)).toContain("America/New_York");
    expect(searchZones("berlin").map((z) => z.id)).toEqual(["Europe/Berlin"]);
    expect(searchZones("").length).toBe(TIME_ZONES.length);
  });

  it("compares zones by offset now and in six months (GEN-23)", () => {
    expect(zonesEquivalent("Asia/Kolkata", "Asia/Calcutta", OCT14)).toBe(true);
    expect(zonesEquivalent("America/New_York", "America/Toronto", OCT14)).toBe(true);
    expect(zonesEquivalent("America/New_York", "America/Chicago", OCT14)).toBe(false);
    // Same offset in October but not in winter: Phoenix (no DST) vs Los Angeles.
    expect(zonesEquivalent("America/Phoenix", "America/Los_Angeles", new Date("2026-07-01T12:00:00Z"))).toBe(false);
    expect(zonesEquivalent("Asia/Kolkata", "Mars/Olympus", OCT14)).toBe(false);
    expect(offsetMinutesAt("America/New_York", OCT14)).toBe(-240);
    expect(offsetMinutesAt("America/New_York", new Date("2026-12-01T12:00:00Z"))).toBe(-300);
    expect(offsetMinutesAt("Asia/Kolkata", OCT14)).toBe(330);
  });
});

describe("formatting (GEN-06)", () => {
  it("formats times as 9:00am (12h, lowercase, no space) or 09:00 (24h)", () => {
    expect(formatTime(new Date("2026-10-14T13:00:00Z"), "America/New_York")).toBe("9:00am");
    expect(formatTime(new Date("2026-10-14T13:00:00Z"), "America/New_York", "en", false)).toBe("09:00");
    expect(formatTime(new Date("2026-10-14T16:30:00Z"), "America/New_York")).toBe("12:30pm");
    expect(formatTime(new Date("2026-10-14T04:05:00Z"), "America/New_York")).toBe("12:05am");
    expect(formatTime(new Date("2026-10-14T04:05:00Z"), "America/New_York", "en", false)).toBe("00:05");
    expect(formatTime(new Date("2026-10-14T12:00:00Z"), "Europe/Berlin", "de", false)).toBe("14:00");
  });

  it("formats dates with the %A, %B %-d, %Y family and ranges", () => {
    expect(formatDateLong(OCT14, "America/New_York")).toBe("Wednesday, October 14, 2026");
    expect(formatDateMedium(OCT14, "America/New_York")).toBe("Wednesday, October 14");
    expect(formatDateShort(OCT14, "America/New_York")).toBe("Oct 14");
    expect(formatMonthYear(OCT14, "America/New_York")).toBe("October 2026");
    expect(formatTimeRange(OCT14, new Date("2026-10-14T14:30:00Z"), "America/New_York")).toBe("10:00am - 10:30am");
    expect(formatMeetingWhen(OCT14, new Date("2026-10-14T14:30:00Z"), "America/New_York")).toBe(
      "10:00am - 10:30am, Wednesday, October 14, 2026",
    );
    // The local date differs from the UTC date late in the evening.
    expect(formatDateLong(new Date("2026-10-15T02:00:00Z"), "America/Los_Angeles")).toBe("Wednesday, October 14, 2026");
    expect(formatDateLong(OCT14, "Europe/Berlin", "de")).toBe("Mittwoch, 14. Oktober 2026");
    expect(formatNumericDate(OCT14, "America/New_York")).toBe("10/14/2026");
    expect(formatNumericDate(OCT14, "America/New_York", "DD/MM/YYYY")).toBe("14/10/2026");
    expect(isoDateInZone(new Date("2026-10-15T02:00:00Z"), "America/Los_Angeles")).toBe("2026-10-14");
    expect(formatOffset("America/New_York", OCT14)).toBe("GMT-04:00");
    expect(formatOffset("UTC", OCT14)).toBe("GMT+00:00");
  });

  it("formats durations and picks 12h or 24h", () => {
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(60)).toBe("1 hr");
    expect(formatDuration(90)).toBe("1 hr 30 min");
    expect(formatDuration(120)).toBe("2 hrs");
    expect(hour12For("24h")).toBe(false);
    expect(hour12For("12h", "de")).toBe(true);
    expect(hour12For(null, "en-US")).toBe(true);
    expect(hour12For(null, "de-DE")).toBe(false);
  });
});

describe("luxon helpers and DST (GEN-06)", () => {
  it("pins luxon's default zone to UTC", () => {
    expect(Settings.defaultZone.name).toBe("UTC");
    expect(DateTime.fromISO("2026-10-14T14:00:00Z").zoneName).toBe("UTC");
  });

  it("builds 9:00 local on both sides of the New York and Berlin DST changes", () => {
    // New York: DST starts 2026-03-08, ends 2026-11-01.
    expect(wallClockToUtc("2026-03-07", 540, "America/New_York").toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(wallClockToUtc("2026-03-09", 540, "America/New_York").toISOString()).toBe("2026-03-09T13:00:00.000Z");
    expect(wallClockToUtc("2026-10-31", 540, "America/New_York").toISOString()).toBe("2026-10-31T13:00:00.000Z");
    expect(wallClockToUtc("2026-11-02", 540, "America/New_York").toISOString()).toBe("2026-11-02T14:00:00.000Z");
    // Berlin: DST starts 2026-03-29, ends 2026-10-25.
    expect(wallClockToUtc("2026-03-28", 540, "Europe/Berlin").toISOString()).toBe("2026-03-28T08:00:00.000Z");
    expect(wallClockToUtc("2026-03-30", 540, "Europe/Berlin").toISOString()).toBe("2026-03-30T07:00:00.000Z");
    expect(wallClockToUtc("2026-10-24", 540, "Europe/Berlin").toISOString()).toBe("2026-10-24T07:00:00.000Z");
    expect(wallClockToUtc("2026-10-26", 540, "Europe/Berlin").toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });

  it("shifts nonexistent times forward and takes the earlier instant for ambiguous ones", () => {
    // 02:30 does not exist on 2026-03-08 in New York: it becomes 03:30 EDT.
    expect(wallClockToUtc("2026-03-08", 150, "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
    // 01:30 happens twice on 2026-11-01: the earlier (EDT, -04:00) instant.
    expect(wallClockToUtc("2026-11-01", 90, "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z");
    // 1440 = the next local midnight (a 23 hour day in spring).
    expect(wallClockToUtc("2026-03-08", 1440, "America/New_York").toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(() => wallClockToUtc("2026-3-8", 0, "UTC")).toThrow();
    expect(() => wallClockToUtc("2026-03-08", 1441, "UTC")).toThrow();
  });

  it("computes local dates, minutes, weekdays and day starts in a zone", () => {
    const late = new Date("2026-10-15T02:00:00Z");
    expect(localDateOf(late, "America/Los_Angeles")).toBe("2026-10-14");
    expect(localDateOf(late, "Europe/Berlin")).toBe("2026-10-15");
    expect(localMinutesOf(OCT14, "America/New_York")).toBe(600);
    expect(weekdayOf("2026-10-14", "America/New_York")).toBe(3); // Wednesday
    expect(weekdayOf("2026-10-18", "UTC")).toBe(0); // Sunday
    expect(weekdayOf(late, "America/Los_Angeles")).toBe(3);
    expect(startOfLocalDay("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(startOfLocalDay(late, "America/Los_Angeles").toISOString()).toBe("2026-10-14T07:00:00.000Z");
    expect(zoneOffsetMinutes("Europe/Berlin", OCT14)).toBe(120);
  });

  it("steps calendar days and months", () => {
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(eachDate("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
    expect(monthBounds("2026-02")).toEqual({ start: "2026-02-01", end: "2026-03-01" });
    expect(() => monthBounds("2026-13")).toThrow();
  });
});
