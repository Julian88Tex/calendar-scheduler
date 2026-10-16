// CSV builder of the Meetings export (SPEC MT-11): Calendly's exact header, RFC 4180 quoting, formula-safe cells,
// times in the exporter's zone with offset, questions padded to 10 pairs.
import { describe, expect, it } from "vitest";
import { CSV_HEADER, csvCell, csvDateTime, csvLine, csvRow, exportFilename, type CsvRowInput } from "@/lib/meetings/csv";

const MT11 =
  "User Name,Team,Invitee Name,Invitee First Name,Invitee Last Name,Invitee Email,Invitee Time Zone,Invitee accepted marketing emails," +
  "Text Reminder Number,Event Type Name,Start Date & Time,End Date & Time,Location,Event Created Date & Time,Canceled,Canceled By," +
  "Cancellation Reason,Question 1,Response 1,Question 2,Response 2,Question 3,Response 3,Question 4,Response 4,Question 5,Response 5," +
  "Question 6,Response 6,Question 7,Response 7,Question 8,Response 8,Question 9,Response 9,Question 10,Response 10,UTM Campaign," +
  "UTM Source,UTM Medium,UTM Term,UTM Content,Salesforce UUID,Event Price,Payment Currency,Guest Email(s),Invitee Reconfirmed," +
  "Marked as No-Show,Meeting Notes,Group,User Email,Event UUID,Invitee UUID,Invitee scheduled by,Scheduling method";

const row = (over: Partial<CsvRowInput> = {}): CsvRowInput => ({
  userName: "Julian Joseph",
  team: null,
  inviteeName: "Maya Patel",
  firstName: "Maya",
  lastName: "Patel",
  email: "maya.patel@example.com",
  inviteeTimeZone: "America/New_York",
  marketingConsent: false,
  textReminderNumber: null,
  eventTypeName: "30 Minute Virtual",
  start: new Date("2026-10-14T17:00:00Z"),
  end: new Date("2026-10-14T17:30:00Z"),
  location: "https://meet.google.com/abc-defg-hij",
  createdAt: new Date("2026-10-10T08:15:00Z"),
  canceled: false,
  canceledBy: null,
  cancelReason: null,
  questions: [{ question: "What would you like to discuss?", answer: "Roadmap, \"Q4\" launch" }],
  utmCampaign: null,
  utmSource: "newsletter",
  utmMedium: null,
  utmTerm: null,
  utmContent: null,
  salesforceUuid: null,
  price: null,
  currency: null,
  guests: ["a@example.com", "b@example.com"],
  reconfirmed: false,
  noShow: true,
  notes: "Line one\nLine two",
  group: false,
  userEmail: "owner@example.com",
  eventId: "e1",
  inviteeId: "i1",
  scheduledBy: null,
  schedulingMethod: null,
  ...over,
});

describe("CSV header", () => {
  it("is exactly the MT-11 column list in Calendly order", () => {
    expect(CSV_HEADER.join(",")).toBe(MT11);
    expect(CSV_HEADER).toHaveLength(55);
  });
});

describe("csvCell", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(true)).toBe("true");
  });

  it("neutralizes spreadsheet formulas but keeps phone numbers", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("-15")).toBe("-15");
    expect(csvCell("+1 (415) 555-0100")).toBe("+1 (415) 555-0100");
    expect(csvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(csvCell("-x")).toBe("'-x");
  });
});

describe("csvRow", () => {
  it("puts every field in header order with times in the exporter's zone", () => {
    const cells = csvRow(row(), "America/Los_Angeles");
    expect(cells).toHaveLength(CSV_HEADER.length);
    const at = (name: string) => cells[CSV_HEADER.indexOf(name)];
    expect(at("Start Date & Time")).toBe("2026-10-14 10:00:00 -07:00");
    expect(at("End Date & Time")).toBe("2026-10-14 10:30:00 -07:00");
    expect(at("Event Created Date & Time")).toBe("2026-10-10 01:15:00 -07:00");
    expect(at("Question 1")).toBe("What would you like to discuss?");
    expect(at("Response 1")).toBe('Roadmap, "Q4" launch');
    expect(at("Question 10")).toBe("");
    expect(at("Guest Email(s)")).toBe("a@example.com, b@example.com");
    expect(at("Marked as No-Show")).toBe("true");
    expect(at("Canceled")).toBe("false");
    expect(at("UTM Source")).toBe("newsletter");
    expect(at("Meeting Notes")).toBe("Line one\nLine two");
    expect(at("Invitee UUID")).toBe("i1");
  });

  it("keeps only the first 10 questions", () => {
    const questions = Array.from({ length: 12 }, (_, i) => ({ question: `Q${i + 1}`, answer: `A${i + 1}` }));
    const cells = csvRow(row({ questions }), "UTC");
    expect(cells[CSV_HEADER.indexOf("Question 10")]).toBe("Q10");
    expect(cells.join("|")).not.toContain("Q11");
  });

  it("ends lines with CRLF", () => {
    expect(csvLine(["a", "b,c"])).toBe('a,"b,c"\r\n');
  });

  it("formats offsets across DST", () => {
    expect(csvDateTime(new Date("2026-12-01T17:00:00Z"), "America/Los_Angeles")).toBe("2026-12-01 09:00:00 -08:00");
    expect(csvDateTime(null, "UTC")).toBe("");
  });

  it("names the file after the tab and day", () => {
    expect(exportFilename("past", "2026-10-14")).toBe("meetings-past-2026-10-14.csv");
  });
});
