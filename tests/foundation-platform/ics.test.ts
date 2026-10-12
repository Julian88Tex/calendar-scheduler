// ICS builder (SPEC NT-06, ARCHITECTURE section 13.3): ical-generator in UTC; parsed back with node-ical: correct UTC
// DTSTART/DTEND across DST changes, UID, METHOD, SEQUENCE, STATUS, ORGANIZER and ATTENDEE (RSVP), CRLF and folding.
import ical, { type VEvent } from "node-ical";
import { afterEach, describe, expect, it } from "vitest";
import { buildIcs, icsContentType, icsUid, type BuildIcsInput } from "@/lib/email/ics";
import { resetFakeTime, setFakeNow } from "@/lib/time/now";

afterEach(() => resetFakeTime());

const input = (over: Partial<BuildIcsInput> = {}): BuildIcsInput => ({
  method: "REQUEST",
  uid: icsUid("6f7c1e2a-0000-4000-8000-000000000001", "kairos.example.com"),
  sequence: 0,
  start: new Date("2026-10-20T14:00:00Z"),
  end: new Date("2026-10-20T14:30:00Z"),
  summary: "30 Minute Meeting with Jordan Lee",
  description: "Event Name: 30 Minute Meeting\n\nNeed to make changes to this event?\nCancel: https://kairos.example.com/cancellations/abc",
  location: "https://kairos.example.com/events/6f7c1e2a-0000-4000-8000-000000000001/join",
  url: "https://kairos.example.com/booking/abc",
  organizer: { name: "Jordan Lee", email: "jordan@example.com" },
  attendees: [
    { name: "Sam Rivera", email: "sam@example.com" },
    { email: "guest@example.com" },
    { name: "Co Host", email: "cohost@example.com", role: "OPT" },
  ],
  status: "CONFIRMED",
  ...over,
});

function parse(ics: string) {
  const parsed = ical.sync.parseICS(ics);
  const events = Object.values(parsed).filter((c): c is VEvent => c?.type === "VEVENT");
  expect(events).toHaveLength(1);
  return { event: events[0]!, calendar: parsed.vcalendar as unknown as { method?: string } | undefined };
}

describe("buildIcs", () => {
  it("emits a REQUEST that parses back with UTC times, UID, SEQUENCE, organizer and RSVP attendees", () => {
    setFakeNow("2026-10-12T08:00:00Z");
    const ics = buildIcs(input());
    expect(ics).toContain("METHOD:REQUEST\r\n");
    expect(ics).toContain("DTSTART:20261020T140000Z\r\n");
    expect(ics).toContain("DTEND:20261020T143000Z\r\n");
    expect(ics).not.toContain("TZID");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75)).toBe(true);
    const { event, calendar } = parse(ics);
    expect(calendar?.method).toBe("REQUEST");
    expect(event.uid).toBe("6f7c1e2a-0000-4000-8000-000000000001@kairos.example.com");
    expect(Number(event.sequence)).toBe(0);
    expect(event.start.toISOString()).toBe("2026-10-20T14:00:00.000Z");
    expect(event.end?.toISOString()).toBe("2026-10-20T14:30:00.000Z");
    expect(event.status).toBe("CONFIRMED");
    expect(event.summary).toBe("30 Minute Meeting with Jordan Lee");
    expect(event.description).toContain("Need to make changes to this event?\nCancel: https://kairos.example.com/cancellations/abc");
    expect(event.location).toContain("/join");
    const url = (event as unknown as { url?: string | { val: string } }).url;
    expect(typeof url === "string" ? url : url?.val).toBe("https://kairos.example.com/booking/abc");
    expect(event.dtstamp?.toISOString()).toBe("2026-10-12T08:00:00.000Z");
    const organizer = event.organizer as unknown as { val: string; params: { CN: string } };
    expect(organizer.val.toLowerCase()).toBe("mailto:jordan@example.com");
    expect(organizer.params.CN).toBe("Jordan Lee");
    const attendees = (Array.isArray(event.attendee) ? event.attendee : [event.attendee]) as unknown as {
      val: string;
      params: Record<string, string | boolean>;
    }[];
    expect(attendees.map((a) => a.val.toLowerCase())).toEqual(["mailto:sam@example.com", "mailto:guest@example.com", "mailto:cohost@example.com"]);
    expect(attendees.every((a) => String(a.params.RSVP).toUpperCase() === "TRUE")).toBe(true);
    expect(attendees[2]!.params.ROLE).toBe("OPT-PARTICIPANT");
  });

  it("cancellation: same UID, higher SEQUENCE, METHOD:CANCEL and STATUS:CANCELLED", () => {
    const req = parse(buildIcs(input({ sequence: 1 }))).event;
    const cancelIcs = buildIcs(input({ method: "CANCEL", sequence: 2, status: "CANCELLED" }));
    expect(cancelIcs).toContain("METHOD:CANCEL\r\n");
    const { event, calendar } = parse(cancelIcs);
    expect(calendar?.method).toBe("CANCEL");
    expect(event.uid).toBe(req.uid);
    expect(Number(event.sequence)).toBe(2);
    expect(event.status).toBe("CANCELLED");
    expect(event.transparency).toBe("TRANSPARENT");
  });

  it("keeps instants exact across DST changes in New York and Berlin", () => {
    for (const [start, end] of [
      ["2026-03-08T07:30:00Z", "2026-03-08T08:00:00Z"], // New York spring forward night
      ["2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"], // New York fall back
      ["2026-03-29T00:30:00Z", "2026-03-29T01:30:00Z"], // Berlin spring forward
      ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"], // Berlin fall back
    ] as const) {
      const { event } = parse(buildIcs(input({ start: new Date(start), end: new Date(end) })));
      expect(event.start.toISOString()).toBe(new Date(start).toISOString());
      expect(event.end?.toISOString()).toBe(new Date(end).toISOString());
    }
  });

  it("PUBLISH (Add to calendar download) carries no attendees", () => {
    const ics = buildIcs(input({ method: "PUBLISH" }));
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics).not.toContain("ATTENDEE");
    expect(ics).toContain("ORGANIZER");
  });

  it("all-day events use VALUE=DATE with an exclusive end", () => {
    const ics = buildIcs(input({ allDayDate: "2026-12-24" }));
    expect(ics).toContain("DTSTART;VALUE=DATE:20261224");
    expect(ics).toContain("DTEND;VALUE=DATE:20261225");
  });

  it("escapes text, drops invalid attendee emails and folds long unicode lines", () => {
    const long = "Встреча, планирование; обсуждение ".repeat(6);
    const ics = buildIcs(input({ summary: long, attendees: [{ email: "not-an-email" }, { email: "ok@example.com" }] }));
    expect(ics).toContain("SUMMARY:Встреча\\, планирование\\; обсуждение");
    expect(ics.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75)).toBe(true);
    const { event } = parse(ics);
    expect(String(event.summary).trim()).toBe(long.trim());
    expect(ics).not.toContain("not-an-email");
    expect(ics.replace(/\r\n /g, "")).toContain("MAILTO:ok@example.com");
  });

  it("helpers: content type and UID", () => {
    expect(icsContentType("CANCEL")).toBe("text/calendar; charset=utf-8; method=CANCEL");
    expect(icsUid("abc", "localhost:3000")).toBe("abc@localhost");
    expect(() => buildIcs(input({ uid: "" }))).toThrow(/uid/);
  });
});
