// Reason labels and hints (SCH-21, Appendix B).
import { describe, expect, it } from "vitest";
import { REASON_CODES, REASON_PRIORITY, isReasonCode, reasonHint, reasonLabel, sortReasons } from "@/lib/slots";

// Built from code points so the source never contains the characters it forbids (GEN-11).
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

describe("reasonLabel", () => {
  it("uses Calendly's chip labels", () => {
    expect(reasonLabel("DAILY_MAX")).toBe("DAILY MAX");
    expect(reasonLabel("WEEKLY_MAX")).toBe("WEEKLY MAX");
    expect(reasonLabel("MONTHLY_MAX")).toBe("MONTHLY MAX");
    expect(reasonLabel("MEETING_LIMIT")).toBe("MEETING LIMIT");
    expect(reasonLabel("CALENDAR")).toBe("CALENDAR");
    expect(reasonLabel("ROUNDROBIN")).toBe("ROUND ROBIN");
    expect(reasonLabel("TOOSOON")).toBe("TOO SOON");
    expect(reasonLabel("NOCAL")).toBe("NO CALENDAR");
  });
});

describe("reasonHint", () => {
  it("returns the Appendix B meaning and fix for every code", () => {
    for (const code of REASON_CODES) {
      const hint = reasonHint(code);
      expect(hint.meaning.length).toBeGreaterThan(5);
      expect(hint.fix.length).toBeGreaterThan(5);
      expect(`${hint.meaning} ${hint.fix}`).not.toMatch(DASHES);
    }
    expect(reasonHint("CALENDAR")).toEqual({ meaning: 'A "Busy" calendar event is blocking the time', fix: 'Change the event to "Free" or remove it' });
    expect(reasonHint("BUFFER")).toEqual({ meaning: "A buffer is blocking this time", fix: "Edit or remove the buffer" });
    expect(reasonHint("UNFAIR").fix).toBe("Adjust distribution settings");
  });

  it("names the product in the NOCAL meaning", () => {
    const before = process.env.NEXT_PUBLIC_APP_NAME;
    process.env.NEXT_PUBLIC_APP_NAME = "Acme Scheduling";
    try {
      expect(reasonHint("NOCAL")).toEqual({ meaning: "Acme Scheduling can't access your calendar", fix: "Reconnect your calendar" });
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_APP_NAME;
      else process.env.NEXT_PUBLIC_APP_NAME = before;
    }
  });
});

describe("ordering", () => {
  it("every code has a priority and sortReasons dedupes", () => {
    expect([...REASON_PRIORITY].sort()).toEqual([...REASON_CODES].sort());
    expect(sortReasons(["BUFFER", "CALENDAR", "PAST", "CALENDAR"])).toEqual(["PAST", "CALENDAR", "BUFFER"]);
    expect(isReasonCode("HOST")).toBe(true);
    expect(isReasonCode("NOPE")).toBe(false);
  });
});
