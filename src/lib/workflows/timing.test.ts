// Reminder timing helpers: natural units, labels, the 365 day limit (NT-11) and the 3 timings rule (NT-09).
import { describe, expect, it } from "vitest";
import { SaveRemindersSchema } from "./schemas";
import { MAX_OFFSET_MINUTES, offsetDuration, offsetLabel, offsetsSummary, sortOffsets, splitOffset, TIMING_MESSAGES, toOffsetMinutes, validateTimings } from "./timing";

describe("offsets", () => {
  it("converts amounts and units to minutes", () => {
    expect(toOffsetMinutes(24, "hours")).toBe(1440);
    expect(toOffsetMinutes(2, "days")).toBe(2880);
    expect(toOffsetMinutes(15, "minutes")).toBe(15);
    expect(toOffsetMinutes(0, "hours")).toBeNaN();
    expect(toOffsetMinutes(1.5, "hours")).toBeNaN();
  });

  it("splits offsets into their natural unit (24 hours stays in hours like Calendly)", () => {
    expect(splitOffset(1440)).toEqual({ amount: 24, unit: "hours" });
    expect(splitOffset(2880)).toEqual({ amount: 2, unit: "days" });
    expect(splitOffset(60)).toEqual({ amount: 1, unit: "hours" });
    expect(splitOffset(90)).toEqual({ amount: 90, unit: "minutes" });
    expect(splitOffset(MAX_OFFSET_MINUTES)).toEqual({ amount: 365, unit: "days" });
  });

  it("labels offsets", () => {
    expect(offsetLabel(1440)).toBe("24 hours before event");
    expect(offsetDuration(60)).toBe("1 hour");
    expect(offsetDuration(1)).toBe("1 minute");
    expect(offsetDuration(4320)).toBe("3 days");
    expect(offsetsSummary([60, 1440])).toBe("24 hours and 1 hour before event");
    expect(offsetsSummary([15, 60, 2880])).toBe("2 days, 1 hour and 15 minutes before event");
    expect(offsetsSummary([])).toBe("");
    expect(sortOffsets([60, 1440, 60])).toEqual([1440, 60]);
  });
});

describe("validation", () => {
  it("accepts up to 365 days and rejects 366 days with the NT-11 message", () => {
    expect(validateTimings([{ amount: 365, unit: "days" }])).toEqual({});
    expect(validateTimings([{ amount: 366, unit: "days" }])).toEqual({ "0": "Choose a time up to 365 days." });
    expect(validateTimings([{ amount: 8761, unit: "hours" }])).toEqual({ "0": TIMING_MESSAGES.max });
  });

  it("rejects empty, zero, duplicate and more than 3 timings", () => {
    expect(validateTimings([])).toEqual({ list: TIMING_MESSAGES.none });
    expect(validateTimings([{ amount: 0, unit: "minutes" }])).toEqual({ "0": TIMING_MESSAGES.amount });
    expect(validateTimings([{ amount: 24, unit: "hours" }, { amount: 1, unit: "days" }])).toEqual({ "1": TIMING_MESSAGES.duplicate });
    const four = [1, 2, 3, 4].map((amount) => ({ amount, unit: "hours" as const }));
    expect(validateTimings(four).list).toBe(TIMING_MESSAGES.tooMany);
  });

  it("the save schema reports timing errors on the row", () => {
    const base = {
      eventTypeId: "00000000-0000-4000-8000-000000000001",
      kind: "invitee",
      enabled: true,
      subject: null,
      bodyHtml: null,
      includeCancelRescheduleLinks: true,
    };
    expect(SaveRemindersSchema.safeParse({ ...base, timings: [{ amount: 24, unit: "hours" }] }).success).toBe(true);
    const bad = SaveRemindersSchema.safeParse({ ...base, timings: [{ amount: 366, unit: "days" }] });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]).toMatchObject({ path: ["timings", 0, "amount"], message: "Choose a time up to 365 days." });
    expect(SaveRemindersSchema.safeParse({ ...base, timings: [{ amount: "3", unit: "hours" }] }).success).toBe(true);
    expect(SaveRemindersSchema.safeParse({ ...base, kind: "sms", timings: [{ amount: 3, unit: "hours" }] }).success).toBe(false);
  });
});
