// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// ICS builder (SPEC NT-06, ARCHITECTURE section 13.3) on ical-generator, UTC only (tech-reference 10.3 gotcha: never
// a native Date together with a TZID). One VEVENT per file.
//
// Rules the callers follow (NT-06): UID `{scheduledEventId}@{APP_URL host}` for one-on-one and multi-host meetings
// (kept across reschedules), `{inviteeId}@{host}` for group invitees and hidden poll invites, the provider iCal UID for
// meetings in calendar invitation mode (confirmation page download only). SEQUENCE increments on every change.
// METHOD REQUEST (new or updated), CANCEL (with STATUS CANCELLED) or PUBLISH (a plain "Add to calendar" download,
// which per RFC 5546 carries no ATTENDEE lines). Pure (no I/O); DTSTAMP comes from the app clock.
import icalGenerator, {
  ICalAttendeeRole,
  ICalAttendeeStatus,
  ICalCalendarMethod,
  ICalEventBusyStatus,
  ICalEventStatus,
  ICalEventTransparency,
} from "ical-generator";
import { appName } from "../brand";
import { now } from "../time/now";
import { isValidEmailAddress } from "./address";

export type BuildIcsInput = {
  method: "REQUEST" | "CANCEL" | "PUBLISH";
  uid: string;
  sequence: number;
  start: Date;
  end: Date;
  /** All-day event on this local date (YYYY-MM-DD) instead of start/end times. */
  allDayDate?: string;
  summary: string;
  description: string;
  location?: string | null;
  url?: string | null;
  organizer: { name: string; email: string };
  attendees: { name?: string | null; email: string; role?: "REQ" | "OPT"; rsvp?: boolean }[];
  status: "CONFIRMED" | "CANCELLED";
  prodIdProduct?: string;
  /** DTSTAMP (defaults to now() from the app clock). */
  stamp?: Date;
};

const METHODS: Record<BuildIcsInput["method"], ICalCalendarMethod> = {
  REQUEST: ICalCalendarMethod.REQUEST,
  CANCEL: ICalCalendarMethod.CANCEL,
  PUBLISH: ICalCalendarMethod.PUBLISH,
};

/** The content type for an ICS attachment or alternative part ("text/calendar; charset=utf-8; method=REQUEST"). */
export function icsContentType(method: BuildIcsInput["method"]): string {
  return `text/calendar; charset=utf-8; method=${method}`;
}

/** UID for meetings and invitees: "{id}@{host}" with the port stripped (NT-06). */
export function icsUid(id: string, host: string): string {
  return `${id}@${host.replace(/:\d+$/, "") || "localhost"}`;
}

function cleanText(s: string | null | undefined): string {
  // Strip control characters except line breaks and tabs (ical-generator escapes commas, semicolons and newlines).
  return (s ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function nextDay(date: string): Date {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Builds an iCalendar document with one VEVENT (CRLF line endings, 75-octet folding by ical-generator). */
export function buildIcs(p: BuildIcsInput): string {
  if (!p.uid) throw new Error("buildIcs: uid is required");
  const allDay = typeof p.allDayDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.allDayDate);
  const start = allDay ? new Date(`${p.allDayDate}T00:00:00Z`) : p.start;
  const end = allDay ? nextDay(p.allDayDate!) : p.end;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("buildIcs: invalid start or end");
  const canceled = p.status === "CANCELLED";
  const cal = icalGenerator({
    prodId: { company: p.prodIdProduct ?? appName(), product: "Scheduling", language: "EN" },
    method: METHODS[p.method],
  });
  const organizerEmail = isValidEmailAddress(p.organizer.email) ? p.organizer.email : `no-reply@${p.uid.split("@")[1] ?? "localhost"}`;
  cal.createEvent({
    id: p.uid,
    sequence: Math.max(0, Math.trunc(p.sequence || 0)),
    stamp: p.stamp ?? now(),
    start,
    end,
    allDay,
    summary: cleanText(p.summary),
    description: cleanText(p.description) || null,
    location: p.location ? cleanText(p.location) : null,
    url: p.url || null,
    organizer: { name: cleanText(p.organizer.name) || organizerEmail, email: organizerEmail },
    attendees:
      p.method === "PUBLISH"
        ? []
        : p.attendees
            .filter((a) => isValidEmailAddress(a.email))
            .map((a) => ({
              email: a.email,
              name: a.name ? cleanText(a.name) : undefined,
              rsvp: a.rsvp ?? true,
              role: a.role === "OPT" ? ICalAttendeeRole.OPT : ICalAttendeeRole.REQ,
              status: ICalAttendeeStatus.NEEDSACTION,
            })),
    status: canceled ? ICalEventStatus.CANCELLED : ICalEventStatus.CONFIRMED,
    transparency: canceled ? ICalEventTransparency.TRANSPARENT : ICalEventTransparency.OPAQUE,
    busystatus: canceled ? ICalEventBusyStatus.FREE : ICalEventBusyStatus.BUSY,
  });
  const out = cal.toString();
  return out.endsWith("\r\n") ? out : `${out}\r\n`;
}
