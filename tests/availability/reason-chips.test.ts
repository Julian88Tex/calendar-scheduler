// Troubleshoot reason chips (docs/SCOPE.md priority 4; SPEC SCH-21, Appendix B): every reason code reads as words
// like "DAILY MAX" and "MEETING LIMIT" ("TOO SOON", never the bare code "TOOSOON"), on the server rendered
// Troubleshoot view built from the real booking-core diagnostics.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExternalBusy } from "@/lib/calendars";

const cal = vi.hoisted(() => ({ busy: {} as Record<string, ExternalBusy[]> }));
vi.mock("@/lib/calendars", () => ({
  getExternalBusy: async (p: { userIds: string[] }) =>
    Object.fromEntries(p.userIds.map((id) => [id, { ok: true, stale: false, nocal: false, busy: cal.busy[id] ?? [] }])),
  getDestinationCalendar: async () => null,
}));
vi.mock("@/lib/links", () => ({
  resolveBookingCode: async () => null,
  consumeLinkInTx: async () => {},
  getReservedIntervals: async () => ({}),
  LinkUsedError: class LinkUsedError extends Error {},
}));
vi.mock("@/lib/polls", () => ({ getPollReservedIntervals: async () => ({}), markPollBookedInTx: async () => {} }));
vi.mock("@/lib/events/registry", () => ({ subscriberKeysFor: () => [], SUBSCRIBER_KEYS: [] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {} }), usePathname: () => "/app/availability" }));

const { REASON_CODES } = await import("@/lib/slots");
const { REASON_CHIP_LABELS, ReasonChip, reasonChipLabel } = await import("@/components/availability/reason-chip");
const { setFakeNow, resetFakeTime } = await import("@/lib/time/now");
const { getTroubleshootDay } = await import("@/lib/availability/troubleshoot");
const { TroubleshootView } = await import("@/app/(dashboard)/app/availability/advanced/troubleshoot/_components/troubleshoot-view");
const { createEventType, createSchedule, createUser } = await import("../factories");
const { useTestDb } = await import("../helpers/db");

const t = useTestDb();
const LA = "America/Los_Angeles";
const h = (hh: number) => hh * 60;
const WEEKDAYS = [[], [{ start: h(9), end: h(17) }], [{ start: h(9), end: h(17) }], [{ start: h(9), end: h(17) }], [{ start: h(9), end: h(17) }], [{ start: h(9), end: h(17) }], []];
/** 2030-10-08 (a Tuesday) hh:mm in Los Angeles (PDT, UTC-7). */
const at = (hh: number, mm = 0) => new Date(Date.UTC(2030, 9, 8, hh + 7, mm));

beforeEach(() => {
  cal.busy = {};
  resetFakeTime();
});

describe("reason chip labels", () => {
  it("label every reason code with uppercase words, never a fused or underscored code", () => {
    for (const code of REASON_CODES) {
      const label = reasonChipLabel(code);
      expect(label, code).toBe(REASON_CHIP_LABELS[code]);
      expect(label, code).toMatch(/^[A-Z]+( [A-Z]+)*$/);
    }
    expect(Object.keys(REASON_CHIP_LABELS).sort()).toEqual([...new Set(REASON_CODES)].sort());
  });

  it("read like the others: TOO SOON, NO CALENDAR, ROUND ROBIN, DAILY MAX, MEETING LIMIT", () => {
    expect(reasonChipLabel("TOOSOON")).toBe("TOO SOON");
    expect(reasonChipLabel("NOCAL")).toBe("NO CALENDAR");
    expect(reasonChipLabel("ROUNDROBIN")).toBe("ROUND ROBIN");
    expect(reasonChipLabel("DAILY_MAX")).toBe("DAILY MAX");
    expect(reasonChipLabel("WEEKLY_MAX")).toBe("WEEKLY MAX");
    expect(reasonChipLabel("MONTHLY_MAX")).toBe("MONTHLY MAX");
    expect(reasonChipLabel("MEETING_LIMIT")).toBe("MEETING LIMIT");
    expect(reasonChipLabel("CALENDAR")).toBe("CALENDAR");
    expect(reasonChipLabel("BUFFER")).toBe("BUFFER");
    // A code added later still reads with spaces.
    expect(reasonChipLabel("NEW_CODE")).toBe("NEW CODE");
  });

  it("renders the dashed chip in both tones", () => {
    expect(renderToStaticMarkup(ReasonChip({ children: "TOO SOON" }))).toMatch(/border-dashed[^"]*bg-pebble[^"]*">TOO SOON<\/span>/);
    expect(renderToStaticMarkup(ReasonChip({ tone: "outside", children: "OUTSIDE HOURS" }))).toMatch(/border-line-medium text-ink-2[^"]*">OUTSIDE HOURS<\/span>/);
  });
});

describe("the Troubleshoot view", () => {
  it("shows the minimum notice chip as TOO SOON next to the other chips", async () => {
    const user = await createUser(t.db, { timezone: LA });
    const schedule = await createSchedule(t.db, { userId: user.id, timezone: LA, weeklyHours: WEEKDAYS as never });
    const { eventType } = await createEventType(t.db, {
      owner: user,
      name: "30 Minute Virtual",
      durationMinutes: 30,
      overrides: { scheduleId: schedule.id, slotIncrementMinutes: 15, bufferBeforeMinutes: 15, bufferAfterMinutes: 15, minimumNoticeMinutes: 240, dateRangeType: "rolling", dateRangeDays: 60 },
    });
    cal.busy[user.id] = [{ start: at(13), end: at(14), allDay: false, title: "Dentist", calendarId: "cal-1", externalId: "ext-1" }];
    setFakeNow(at(7, 59));
    const day = await getTroubleshootDay({ orgId: user.organizationId, orgRole: user.orgRole, user }, { date: "2030-10-08", eventTypeId: eventType.id });
    expect(day.error).toBeNull();
    const text = renderToStaticMarkup(createElement(TroubleshootView, { day }))
      .replace(/<[^>]+>/g, " ")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ");
    expect(text).toContain("TOO SOON Too soon: invitees must schedule at least 4 hours in advance");
    expect(text).toContain("CALENDAR Conflicts with \"Dentist\"");
    expect(text).toContain("BUFFER");
    expect(text).toContain("OUTSIDE HOURS");
    expect(text).not.toContain("TOOSOON");
  });
});
