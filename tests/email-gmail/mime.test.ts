// The raw RFC 5322 message of the Gmail transport (src/lib/email/gmail-mime.ts), parsed back with an independent
// parser: CRLF line breaks and 7-bit output, From with the owner's name, To, Cc, Bcc kept for the Gmail API, Reply-To,
// UTF-8 subjects and names as RFC 2047 encoded words, Date, Message-ID, the headers every email carries
// (Auto-Submitted, X-Auto-Response-Suppress, List-Unsubscribe, List-Unsubscribe-Post), multipart/alternative text and
// HTML, the invitation as text/calendar; method=REQUEST (or CANCEL) plus the invite.ics attachment like the SMTP
// transport, extra attachments, and base64url for the API.
import { describe, expect, it } from "vitest";
import { buildGmailMime, toBase64Url } from "@/lib/email/gmail-mime";
import type { OutgoingEmail } from "@/lib/email/transports";
import { decodeEncodedWords, decodeGmailRaw, leafParts, parseMime } from "./mime";

const ICS_REQUEST = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Kairos//Kairos//EN",
  "METHOD:REQUEST",
  "BEGIN:VEVENT",
  "UID:evt-1@localhost",
  "SEQUENCE:0",
  "DTSTART:20261020T140000Z",
  "DTEND:20261020T143000Z",
  "SUMMARY:30 Minute Meeting with Jordan Lée",
  "ORGANIZER;CN=Jordan Lée:mailto:jordan.lee@gmail.com",
  "ATTENDEE;CN=Sam Rivera;RSVP=TRUE:mailto:sam@example.com",
  "STATUS:CONFIRMED",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");
const ICS_CANCEL = ICS_REQUEST.replace("METHOD:REQUEST", "METHOD:CANCEL").replace("STATUS:CONFIRMED", "STATUS:CANCELLED");

const SUBJECT = "Confirmed: Café ☕ with José Ñúñez on Tuesday, October 20, 2026 at 10:00am (Eastern Time), 30 Minute Meeting";
const HTML = `<!doctype html><html><body><p>Hi Sam,</p><p>Your meeting with Jordan Lée is confirmed ☕.</p><p>${"A long line of text. ".repeat(20)}</p></body></html>`;
const TEXT = "Hi Sam,\n\nYour meeting with Jordan Lée is confirmed.\n\nCancel: http://localhost:3000/cancellations/abc\n";

const base = (over: Partial<OutgoingEmail> = {}): OutgoingEmail => ({
  from: { name: "ignored", address: "ignored@example.com" },
  to: ["Sam Rivera <sam@example.com>", "ana@example.com"],
  cc: ["cc@example.com"],
  bcc: ["hidden@example.com"],
  replyTo: "jordan@example.com",
  subject: SUBJECT,
  html: HTML,
  text: TEXT,
  ics: { method: "REQUEST", content: ICS_REQUEST, filename: "invite.ics" },
  attachments: [],
  headers: {
    "Auto-Submitted": "auto-generated",
    "X-Auto-Response-Suppress": "OOF, AutoReply",
    "List-Unsubscribe": "<http://localhost:3000/p/abc/unsubscribe?t=tok>, <mailto:unsubscribe@example.com>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  },
  idempotencyKey: "kairos-outbox-1",
  tags: [],
  ...over,
});

const DATE = new Date("2026-10-14T16:05:00Z");

async function build(over: Partial<OutgoingEmail> = {}, from = { name: "Jordan Lée", address: "jordan.lee@gmail.com" }) {
  const bytes = await buildGmailMime({ msg: base(over), from, messageId: "<kairos-outbox-1@localhost>", date: DATE });
  const raw = bytes.toString("latin1");
  return { bytes, raw, msg: parseMime(raw) };
}

describe("Gmail raw message", () => {
  it("is 7-bit with CRLF line breaks and lines within the RFC 5322 limit", async () => {
    const { bytes, raw } = await build();
    expect([...bytes].every((b) => b < 128)).toBe(true);
    expect(raw.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const line of raw.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
  });

  it("has the owner's From, the recipients (Bcc kept for the API), Reply-To, Date, Message-ID and MIME-Version", async () => {
    const { msg, raw } = await build();
    const from = msg.header("from")!;
    expect(from).toContain("Jordan Lée");
    expect(from).toContain("<jordan.lee@gmail.com>");
    // The display name is an encoded word on the wire (non-ASCII).
    expect(msg.headers.find((h) => h.name === "From")!.raw).toMatch(/=\?UTF-8\?[BQ]\?/i);
    expect(msg.header("to")).toBe("Sam Rivera <sam@example.com>, ana@example.com");
    expect(msg.header("cc")).toBe("cc@example.com");
    expect(msg.header("bcc")).toBe("hidden@example.com");
    expect(msg.header("reply-to")).toBe("jordan@example.com");
    expect(msg.header("message-id")).toBe("<kairos-outbox-1@localhost>");
    expect(new Date(msg.header("date")!).toISOString()).toBe(DATE.toISOString());
    expect(msg.header("mime-version")).toBe("1.0");
    expect(raw).not.toMatch(/^X-Mailer:/im);
  });

  it("encodes a UTF-8 subject per RFC 2047 and decodes back to the exact subject", async () => {
    const { msg } = await build();
    const rawSubject = msg.headers.find((h) => h.name === "Subject")!.raw;
    expect(rawSubject).toMatch(/^=\?UTF-8\?[BQ]\?/i);
    expect(msg.header("subject")).toBe(SUBJECT);
    // A plain ASCII subject stays readable.
    const ascii = await build({ subject: "New Event: Sam Rivera, 10:00am Tuesday, October 20, 2026" });
    expect(ascii.msg.headers.find((h) => h.name === "Subject")!.raw).toBe("New Event: Sam Rivera, 10:00am Tuesday, October 20, 2026");
    expect(decodeEncodedWords("=?UTF-8?Q?Caf=C3=A9?= =?UTF-8?B?4piV?=")).toBe("Café☕");
  });

  it("carries the headers every transport sets (Auto-Submitted, List-Unsubscribe one-click)", async () => {
    const { msg } = await build();
    expect(msg.header("auto-submitted")).toBe("auto-generated");
    expect(msg.header("x-auto-response-suppress")).toBe("OOF, AutoReply");
    expect(msg.header("list-unsubscribe")).toBe("<http://localhost:3000/p/abc/unsubscribe?t=tok>, <mailto:unsubscribe@example.com>");
    expect(msg.header("list-unsubscribe-post")).toBe("List-Unsubscribe=One-Click");
  });

  it("is multipart/mixed: alternative text, HTML and text/calendar; method=REQUEST, then the invite.ics attachment", async () => {
    const { msg } = await build();
    expect(msg.contentType).toBe("multipart/mixed");
    const [alternative, attachment] = msg.parts;
    expect(alternative!.contentType).toBe("multipart/alternative");
    const [text, html, calendar] = alternative!.parts;
    expect(text!.contentType).toBe("text/plain");
    expect(text!.params.charset?.toLowerCase()).toBe("utf-8");
    expect(text!.text()).toBe(TEXT.replace(/\n/g, "\r\n"));
    expect(html!.contentType).toBe("text/html");
    expect(html!.text()).toBe(HTML);
    expect(calendar!.contentType).toBe("text/calendar");
    expect(calendar!.params.method).toBe("REQUEST");
    expect(calendar!.params.charset?.toLowerCase()).toBe("utf-8");
    expect(calendar!.text()).toBe(ICS_REQUEST);
    expect(attachment!.contentType).toBe("application/ics");
    expect(attachment!.disposition).toBe("attachment");
    expect(attachment!.params.name ?? attachment!.dispositionParams.filename).toBe("invite.ics");
    expect(attachment!.text()).toBe(ICS_REQUEST);
  });

  it("sends a cancellation as text/calendar; method=CANCEL with its attachment, plus extra attachments", async () => {
    const { msg } = await build({
      ics: { method: "CANCEL", content: ICS_CANCEL, filename: "invite.ics" },
      attachments: [{ filename: "cancel.ics", contentType: "text/calendar; charset=utf-8; method=CANCEL", contentBase64: Buffer.from(ICS_CANCEL).toString("base64") }],
    });
    const leaves = leafParts(msg);
    const calendar = leaves.find((p) => p.contentType === "text/calendar" && !p.disposition)!;
    expect(calendar.params.method).toBe("CANCEL");
    expect(calendar.text()).toContain("STATUS:CANCELLED");
    const files = leaves.filter((p) => p.disposition === "attachment");
    expect(files.map((p) => p.params.name ?? p.dispositionParams.filename).sort()).toEqual(["cancel.ics", "invite.ics"]);
    const extra = files.find((p) => (p.params.name ?? p.dispositionParams.filename) === "cancel.ics")!;
    expect(extra.contentType).toBe("text/calendar");
    expect(extra.params.method).toBe("CANCEL");
    expect(extra.text()).toBe(ICS_CANCEL);
  });

  it("without an invitation is multipart/alternative with the text and HTML parts only", async () => {
    const { msg } = await build({ ics: null, cc: [], bcc: [], replyTo: null });
    expect(msg.contentType).toBe("multipart/alternative");
    expect(msg.parts.map((p) => p.contentType)).toEqual(["text/plain", "text/html"]);
    expect(msg.header("cc")).toBeNull();
    expect(msg.header("bcc")).toBeNull();
    expect(msg.header("reply-to")).toBeNull();
  });

  it("keeps an ASCII display name readable and never lets a header value break into a new header", async () => {
    const { msg } = await build({ subject: "Hello\r\nBcc: attacker@example.com" }, { name: "Jordan Lee", address: "jordan.lee@gmail.com" });
    expect(msg.header("from")).toBe("Jordan Lee <jordan.lee@gmail.com>");
    expect(msg.headerAll("bcc")).toEqual(["hidden@example.com"]);
    expect(msg.header("subject")).not.toMatch(/[\r\n]/);
  });

  it("encodes as base64url without padding for users.messages.send and decodes to the same bytes", async () => {
    const { bytes } = await build();
    const encoded = toBase64Url(bytes);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(encoded, "base64url").equals(bytes)).toBe(true);
    expect(decodeGmailRaw(encoded)).toBe(bytes.toString("latin1"));
  });
});
