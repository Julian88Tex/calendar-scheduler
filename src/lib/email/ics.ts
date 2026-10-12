// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// ICS builder (ARCHITECTURE section 13.3, SPEC NT-06). UTC dates only (tech-reference 10.3 gotcha). UID rules: callers
// pass scheduled_events.provider_ical_uid when the meeting's notificationMode is calendar_invitation (confirmation page
// download only), otherwise ics_uid. Foundation stub: a minimal, valid single VEVENT written by hand (RFC 5545 text
// escaping and 75-octet line folding, CRLF line endings).
import { appName } from "../brand";

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
  attendees: { name?: string | null; email: string; role?: "REQ" | "OPT" }[];
  status: "CONFIRMED" | "CANCELLED";
  prodIdProduct?: string;
};

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const param = (s: string) => `"${s.replace(/"/g, "'")}"`;

function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

/** Builds an iCalendar document with one VEVENT. */
export function buildIcs(p: BuildIcsInput): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${p.prodIdProduct ?? appName()}//Scheduling//EN`,
    "CALSCALE:GREGORIAN",
    `METHOD:${p.method}`,
    "BEGIN:VEVENT",
    `UID:${p.uid}`,
    `SEQUENCE:${p.sequence}`,
    `DTSTAMP:${utc(new Date())}`,
  ];
  if (p.allDayDate) {
    const d = p.allDayDate.replace(/-/g, "");
    const next = new Date(`${p.allDayDate}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`);
  } else {
    lines.push(`DTSTART:${utc(p.start)}`, `DTEND:${utc(p.end)}`);
  }
  lines.push(`SUMMARY:${text(p.summary)}`, `DESCRIPTION:${text(p.description)}`);
  if (p.location) lines.push(`LOCATION:${text(p.location)}`);
  if (p.url) lines.push(`URL:${p.url}`);
  lines.push(`ORGANIZER;CN=${param(p.organizer.name)}:mailto:${p.organizer.email}`);
  for (const a of p.attendees) {
    const cn = a.name ? `;CN=${param(a.name)}` : "";
    const role = a.role === "OPT" ? "OPT-PARTICIPANT" : "REQ-PARTICIPANT";
    lines.push(`ATTENDEE${cn};ROLE=${role};PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`);
  }
  lines.push(`STATUS:${p.status}`, "END:VEVENT", "END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
