// Holidays (AV-13): the 10 supported countries with stable year independent keys, substitute days as their own
// entries, and blockedDatesFor with user overrides.
import { describe, expect, it } from "vitest";
import { COUNTRY_NAMES, SUPPORTED_COUNTRIES, blockedDatesFor, getHolidays, holidayKey, holidaysBetween, isSupportedCountry, ruleId } from "@/lib/holidays";

// Built from code points so the source never contains the characters it forbids (GEN-11).
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

const byName = (country: string, year: number) => Object.fromEntries(getHolidays(country, year).map((h) => [h.name, h]));
const dateOf = (country: string, year: number, name: string) => byName(country, year)[name]?.date;

describe("supported countries", () => {
  it("lists the 10 countries with English names", () => {
    expect(SUPPORTED_COUNTRIES).toEqual(["AU", "BR", "CA", "FR", "DE", "MX", "NL", "ES", "GB", "US"]);
    expect(COUNTRY_NAMES.GB).toBe("United Kingdom");
    expect(isSupportedCountry("US")).toBe(true);
    expect(isSupportedCountry("IT")).toBe(false);
  });

  it("returns nothing for unsupported countries or invalid years", () => {
    expect(getHolidays("IT", 2026)).toEqual([]);
    expect(getHolidays("US", 2026.5)).toEqual([]);
    expect(getHolidays("US", 1800)).toEqual([]);
  });

  for (const country of SUPPORTED_COUNTRIES) {
    it(`${country}: holidays for 2026 and 2027 are sorted, in the year, with unique keys that repeat every year`, () => {
      for (const year of [2026, 2027]) {
        const list = getHolidays(country, year);
        expect(list.length).toBeGreaterThanOrEqual(5);
        expect(list.map((h) => h.date)).toEqual([...list.map((h) => h.date)].sort());
        expect(list.every((h) => h.date.startsWith(`${year}-`))).toBe(true);
        expect(new Set(list.map((h) => h.key)).size).toBe(list.length);
        expect(list.every((h) => h.key.startsWith(`${country}:`) && h.key.endsWith(":substitute") === h.substitute)).toBe(true);
        expect(list.every((h) => !DASHES.test(h.name))).toBe(true);
      }
      // Stable keys: the non-substitute keys of consecutive years are (almost always) the same set.
      const keys = (y: number) => new Set(getHolidays(country, y).filter((h) => !h.substitute).map((h) => h.key));
      const a = keys(2027);
      const b = keys(2028);
      const common = [...a].filter((k) => b.has(k));
      expect(common.length).toBeGreaterThanOrEqual(Math.min(a.size, b.size) - 2);
    });
  }

  it("keys stay unique for every country from 2025 to 2035", () => {
    for (const c of SUPPORTED_COUNTRIES) {
      for (let y = 2025; y <= 2035; y++) {
        const list = getHolidays(c, y);
        expect(new Set(list.map((h) => h.key)).size, `${c} ${y}`).toBe(list.length);
      }
    }
  });
});

describe("spot checks", () => {
  it("US: Thanksgiving 2026-11-26 and 2027-11-25 with the same key; Independence Day substitute on Fri Jul 3 2026", () => {
    const tg26 = getHolidays("US", 2026).find((h) => h.name === "Thanksgiving Day")!;
    const tg27 = getHolidays("US", 2027).find((h) => h.name === "Thanksgiving Day")!;
    expect(tg26.date).toBe("2026-11-26");
    expect(tg27.date).toBe("2027-11-25");
    expect(tg26.key).toBe(tg27.key);
    expect(tg26.key).toBe("US:4th_thursday_in_november");
    expect(dateOf("US", 2026, "Labor Day")).toBe("2026-09-07");
    expect(byName("US", 2026)["Independence Day (substitute day)"]).toMatchObject({ date: "2026-07-03", substitute: true, key: "US:07-04:substitute" });
    expect(byName("US", 2026)["Independence Day"]).toMatchObject({ date: "2026-07-04", substitute: false, key: "US:07-04" });
  });

  it("GB: Christmas and the 2027 substitute bank holiday (Dec 27) with its own key; Summer bank holiday (England and Wales)", () => {
    expect(byName("GB", 2026)["Christmas Day"]).toMatchObject({ date: "2026-12-25", key: "GB:12-25", substitute: false });
    expect(byName("GB", 2027)["Christmas Day (substitute day)"]).toMatchObject({ date: "2027-12-27", key: "GB:12-25:substitute", substitute: true });
    expect(byName("GB", 2027)["Boxing Day (substitute day)"]).toMatchObject({ date: "2027-12-28", key: "GB:12-26:substitute" });
    expect(dateOf("GB", 2026, "Boxing Day (substitute day)")).toBe("2026-12-28");
    expect(dateOf("GB", 2026, "Summer bank holiday")).toBe("2026-08-31");
    expect(dateOf("GB", 2027, "Easter Monday")).toBe("2027-03-29");
  });

  it("DE: Tag der Deutschen Einheit on Oct 3 (German Unity Day)", () => {
    expect(byName("DE", 2026)["German Unity Day"]).toMatchObject({ date: "2026-10-03", key: "DE:10-03" });
    expect(dateOf("DE", 2027, "German Unity Day")).toBe("2027-10-03");
    expect(dateOf("DE", 2026, "Good Friday")).toBe("2026-04-03");
  });

  it("other countries", () => {
    expect(dateOf("AU", 2026, "Australia Day")).toBe("2026-01-26");
    expect(dateOf("AU", 2027, "Christmas Day (substitute day)")).toBe("2027-12-27");
    expect(dateOf("BR", 2026, "Tiradentes' Day")).toBe("2026-04-21");
    expect(dateOf("CA", 2026, "Canada Day")).toBe("2026-07-01");
    expect(dateOf("CA", 2027, "Labour Day")).toBe("2027-09-06");
    expect(dateOf("FR", 2026, "Bastille Day")).toBe("2026-07-14");
    expect(dateOf("FR", 2027, "Ascension Day")).toBe("2027-05-06");
    expect(dateOf("MX", 2026, "Independence Day")).toBe("2026-09-16");
    expect(dateOf("MX", 2027, "Revolution Day")).toBe("2027-11-15");
    expect(dateOf("NL", 2026, "King's Day")).toBe("2026-04-27");
    expect(dateOf("ES", 2026, "National Day of Spain")).toBe("2026-10-12");
    expect(dateOf("ES", 2027, "Constitution Day")).toBe("2027-12-06");
  });

  it("returns copies (callers cannot corrupt the cache)", () => {
    const a = getHolidays("US", 2026);
    a[0]!.name = "changed";
    a.pop();
    expect(getHolidays("US", 2026)[0]!.name).toBe("New Year's Day");
    expect(getHolidays("US", 2026).length).toBe(a.length + 1);
  });
});

describe("ruleId and holidayKey", () => {
  it("reduces rules to their date expression", () => {
    expect(ruleId("01-01 and if sunday then next monday if saturday then previous friday")).toBe("01-01");
    expect(ruleId("substitutes 12-25 if saturday then next monday if sunday then next tuesday")).toBe("12-25");
    expect(ruleId("06-19 and if sunday then next monday if saturday then previous friday since 2021")).toBe("06-19");
    expect(ruleId("easter -2")).toBe("easter_-2");
    expect(ruleId("easter 1")).toBe("easter_1");
    expect(ruleId("1st sunday in October in even years")).toBe("1st_sunday_in_october");
    expect(holidayKey("GB", "substitutes 12-25 if saturday then next monday", true)).toBe("GB:12-25:substitute");
  });
});

describe("blockedDatesFor", () => {
  it("lists observed holidays between two dates, honoring overrides (Off = available)", () => {
    expect(blockedDatesFor("US", {}, "2026-11-01", "2026-12-31", "America/New_York")).toEqual(["2026-11-11", "2026-11-26", "2026-12-25"]);
    expect(blockedDatesFor("US", { "US:4th_thursday_in_november": false }, "2026-11-01", "2026-11-30", "UTC")).toEqual(["2026-11-11"]);
    expect(blockedDatesFor("US", { "US:4th_thursday_in_november": true }, "2026-11-26", "2026-11-26", "UTC")).toEqual(["2026-11-26"]);
  });

  it("includes substitute days unless their own key is turned off", () => {
    expect(blockedDatesFor("GB", {}, "2027-12-24", "2027-12-31", "Europe/London")).toEqual(["2027-12-25", "2027-12-26", "2027-12-27", "2027-12-28"]);
    expect(blockedDatesFor("GB", { "GB:12-25:substitute": false }, "2027-12-24", "2027-12-31", "Europe/London")).toEqual(["2027-12-25", "2027-12-26", "2027-12-28"]);
  });

  it("converts instants to local dates of the zone and spans years", () => {
    // 2026-11-27T02:00Z is still Nov 26 in Los Angeles.
    expect(blockedDatesFor("US", {}, new Date("2026-11-27T02:00:00Z"), new Date("2026-11-27T02:00:00Z"), "America/Los_Angeles")).toEqual(["2026-11-26"]);
    expect(blockedDatesFor("US", {}, new Date("2026-11-27T02:00:00Z"), new Date("2026-11-27T02:00:00Z"), "UTC")).toEqual([]);
    expect(blockedDatesFor("DE", {}, "2026-12-20", "2027-01-05", "Europe/Berlin")).toEqual(["2026-12-25", "2026-12-26", "2027-01-01"]);
  });

  it("returns nothing without a supported country or for an inverted range", () => {
    expect(blockedDatesFor(null, {}, "2026-01-01", "2026-12-31", "UTC")).toEqual([]);
    expect(blockedDatesFor("XX", {}, "2026-01-01", "2026-12-31", "UTC")).toEqual([]);
    expect(blockedDatesFor("US", {}, "2026-12-31", "2026-01-01", "UTC")).toEqual([]);
    expect(blockedDatesFor("US", {}, "not a date", "2026-01-01", "UTC")).toEqual([]);
  });

  it("holidaysBetween lists the current and next year for the settings page", () => {
    const list = holidaysBetween("US", "2026-01-01", "2027-12-31");
    expect(list.length).toBe(getHolidays("US", 2026).length + getHolidays("US", 2027).length);
  });
});
