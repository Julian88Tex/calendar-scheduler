// CSV export of the Meetings page (SPEC MT-11): Calendly's column order, one row per invitee, times in the exporter's
// zone with their offset. Pure: the route handler (src/app/api/meetings/export/route.ts) streams the lines that
// export.ts builds from these helpers.
//
// Cells are quoted per RFC 4180 (quotes doubled; fields with a comma, quote or line break quoted) and protected
// against spreadsheet formula injection: a cell starting with =, @, a tab or a carriage return, or with + or - and
// not a plain number (phone numbers stay as they are), gets a leading apostrophe.
import { DateTime } from "@/lib/time/luxon";

/** MT-11 header, Calendly order. */
export const CSV_HEADER: readonly string[] = [
  "User Name",
  "Team",
  "Invitee Name",
  "Invitee First Name",
  "Invitee Last Name",
  "Invitee Email",
  "Invitee Time Zone",
  "Invitee accepted marketing emails",
  "Text Reminder Number",
  "Event Type Name",
  "Start Date & Time",
  "End Date & Time",
  "Location",
  "Event Created Date & Time",
  "Canceled",
  "Canceled By",
  "Cancellation Reason",
  ...Array.from({ length: 10 }, (_, i) => [`Question ${i + 1}`, `Response ${i + 1}`]).flat(),
  "UTM Campaign",
  "UTM Source",
  "UTM Medium",
  "UTM Term",
  "UTM Content",
  "Salesforce UUID",
  "Event Price",
  "Payment Currency",
  "Guest Email(s)",
  "Invitee Reconfirmed",
  "Marked as No-Show",
  "Meeting Notes",
  "Group",
  "User Email",
  "Event UUID",
  "Invitee UUID",
  "Invitee scheduled by",
  "Scheduling method",
];

const PLAIN_NUMBER = /^[+-]?[\d\s().-]+$/;

/** One CSV cell (quoted when needed, formula-safe). */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "boolean" ? (value ? "true" : "false") : String(value);
  if (/^[=@\t\r]/.test(s) || (/^[+-]/.test(s) && !PLAIN_NUMBER.test(s))) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One CSV line with CRLF. */
export function csvLine(cells: readonly (string | number | boolean | null | undefined)[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}

/** "2026-10-14 10:00:00 -07:00": an instant in the exporter's zone with its offset (MT-11). */
export function csvDateTime(date: Date | null | undefined, zone: string): string {
  if (!date) return "";
  return DateTime.fromJSDate(date, { zone }).toFormat("yyyy-MM-dd HH:mm:ss ZZ");
}

/** The fields of one export row, before they are put in header order. */
export type CsvRowInput = {
  userName: string;
  team: string | null;
  inviteeName: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  inviteeTimeZone: string | null;
  marketingConsent: boolean;
  textReminderNumber: string | null;
  eventTypeName: string;
  start: Date;
  end: Date;
  location: string;
  createdAt: Date;
  canceled: boolean;
  canceledBy: string | null;
  cancelReason: string | null;
  /** In question order; only the first 10 are exported. */
  questions: { question: string; answer: string }[];
  utmCampaign: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  salesforceUuid: string | null;
  price: string | null;
  currency: string | null;
  guests: string[];
  reconfirmed: boolean;
  noShow: boolean;
  notes: string | null;
  group: boolean;
  userEmail: string;
  eventId: string;
  inviteeId: string;
  scheduledBy: string | null;
  schedulingMethod: string | null;
};

/** The cells of one row in CSV_HEADER order. */
export function csvRow(r: CsvRowInput, zone: string): string[] {
  const qa: string[] = [];
  for (let i = 0; i < 10; i++) {
    const q = r.questions[i];
    qa.push(q?.question ?? "", q?.answer ?? "");
  }
  return [
    r.userName,
    r.team ?? "",
    r.inviteeName,
    r.firstName ?? "",
    r.lastName ?? "",
    r.email,
    r.inviteeTimeZone ?? "",
    r.marketingConsent ? "true" : "false",
    r.textReminderNumber ?? "",
    r.eventTypeName,
    csvDateTime(r.start, zone),
    csvDateTime(r.end, zone),
    r.location,
    csvDateTime(r.createdAt, zone),
    r.canceled ? "true" : "false",
    r.canceledBy ?? "",
    r.cancelReason ?? "",
    ...qa,
    r.utmCampaign ?? "",
    r.utmSource ?? "",
    r.utmMedium ?? "",
    r.utmTerm ?? "",
    r.utmContent ?? "",
    r.salesforceUuid ?? "",
    r.price ?? "",
    r.currency ?? "",
    r.guests.join(", "),
    r.reconfirmed ? "true" : "false",
    r.noShow ? "true" : "false",
    r.notes ?? "",
    r.group ? "true" : "false",
    r.userEmail,
    r.eventId,
    r.inviteeId,
    r.scheduledBy ?? "",
    r.schedulingMethod ?? "",
  ];
}

/** "meetings-upcoming-2026-10-14.csv". */
export function exportFilename(tab: string, today: string): string {
  return `meetings-${tab.replace(/[^a-z]/g, "")}-${today.replace(/[^0-9-]/g, "")}.csv`;
}
