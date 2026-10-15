// OWNER: gmail (email sending from the owner's Gmail).
//
// The raw RFC 5322 message the Gmail transport hands to users.messages.send (src/lib/email/gmail-transport.ts), built
// with nodemailer's MailComposer, the same MIME composer the SMTP transport uses, so every transport produces the same
// structure:
//   multipart/mixed
//     multipart/alternative
//       text/plain; charset=utf-8
//       text/html; charset=utf-8
//       text/calendar; charset=utf-8; method=REQUEST | CANCEL        (when the email carries an invitation)
//     application/ics; name=invite.ics (attachment)                  (the same invitation as a file)
//     further attachments (for example cancel.ics on a reschedule)
// Headers: From "Owner Name <owner@gmail.com>", To, Cc, Bcc (kept: Gmail delivers to Bcc recipients and strips the
// header), Reply-To, Subject (RFC 2047 encoded when it is not plain ASCII), Date (business clock), a stable Message-ID
// per outbox row, MIME-Version, and the headers every email carries (Auto-Submitted, X-Auto-Response-Suppress,
// List-Unsubscribe and List-Unsubscribe-Post). CRLF line breaks throughout. File and URL access are disabled, so no
// content can make the composer read a local file or fetch a URL.
import "server-only";
import type { OutgoingEmail } from "./transports";

export type GmailMimeInput = {
  msg: OutgoingEmail;
  /** The mailbox Gmail sends as: the owner's name and the connected Google account's address. */
  from: { name: string | null; address: string };
  /** `<...@host>`: stable per outbox row, so a re-sent copy is recognized as the same message. */
  messageId: string;
  date: Date;
};

/**
 * Headers the message structure owns. The Gmail API reads the recipients from the message itself (there is no SMTP
 * envelope), so an extra header must never add a recipient, replace the sender or change the MIME structure.
 */
const RESERVED_HEADERS = new Set([
  "from",
  "sender",
  "to",
  "cc",
  "bcc",
  "reply-to",
  "subject",
  "date",
  "message-id",
  "in-reply-to",
  "references",
  "return-path",
  "mime-version",
  "content-type",
  "content-transfer-encoding",
  "content-disposition",
]);

/** True for a header the message structure owns (recipients, sender, subject, Message-ID, MIME headers). */
export function isReservedHeader(name: string): boolean {
  return RESERVED_HEADERS.has(name.trim().toLowerCase());
}

/** The extra headers of a message (Auto-Submitted, List-Unsubscribe and so on) without the reserved ones. */
export function extraHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !isReservedHeader(name)));
}

/** Builds the raw message (bytes, CRLF line breaks). */
export async function buildGmailMime(p: GmailMimeInput): Promise<Buffer> {
  const { default: MailComposer } = await import("nodemailer/lib/mail-composer");
  const { msg } = p;
  const composer = new MailComposer({
    from: { name: p.from.name ?? "", address: p.from.address },
    to: msg.to,
    ...(msg.cc.length ? { cc: msg.cc } : {}),
    ...(msg.bcc.length ? { bcc: msg.bcc } : {}),
    ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    headers: extraHeaders(msg.headers),
    messageId: p.messageId,
    date: p.date,
    ...(msg.ics ? { icalEvent: { method: msg.ics.method, filename: msg.ics.filename, content: msg.ics.content } } : {}),
    ...(msg.attachments.length
      ? {
          attachments: msg.attachments.map((a) => ({
            filename: a.filename,
            content: a.contentBase64,
            encoding: "base64",
            contentType: a.contentType,
          })),
        }
      : {}),
    newline: "win",
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const node = composer.compile();
  // MailComposer drops Bcc from the headers (SMTP sends it in the envelope); the Gmail API reads recipients from the
  // headers, so it must stay.
  node.keepBcc = true;
  return node.build();
}

/** RFC 4648 section 5 base64url without padding, the `raw` encoding of the Gmail API. */
export function toBase64Url(bytes: Buffer): string {
  return bytes.toString("base64url");
}
