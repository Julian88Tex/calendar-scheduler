// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Email core public API (ARCHITECTURE section 13.1, SPEC GEN-15, NT-05, NT-06, NT-20):
// - sendEmail(msg): outbox row by idempotency key, then Resend, SMTP, the owner's Gmail or "stored" (send.ts)
// - resolveEmailTransport: which transport delivers (EMAIL_PROVIDER, Resend, SMTP, the owner's Gmail, outbox) and,
//   for Gmail, the sending account and whether it can send right now (gmail-sender.ts)
// - renderEmailLayout / renderEmailText: the shared responsive layout and its text footer (layout.ts)
// - composeEmail / renderEmail: Calendly-style content blocks rendered to HTML and text together (blocks.ts)
// - buildIcs: invitations and cancellations in UTC (ical.ts); buildMeetingIcs applies the NT-06 rules from the schema
// - meetingSender (NT-20 From name and Reply-To), emailBrandForUser (NT-05 header and footer) (meeting.ts)
// - addToCalendarLinks: Google, Outlook.com, Office 365 and ICS links (BK-22, calendar-links.ts)
// - renderMeetingEmail: Calendly-style confirmation, new event, cancellation, reschedule and reminder emails from a
//   template context (meeting-templates.ts), for lifecycle-core, workflows and polls-core
// - htmlToText, escapeHtml and address helpers
import "server-only";

export type { EmailBrand, EmailCategory, EmailMessage, EmailTransportName, IcsMethod, RenderedEmail, SendEmailResult } from "./types";
export {
  EMAIL_MAX_ATTEMPTS,
  EMAIL_OUTBOX_PATH,
  EMAIL_STALE_SENDING_MS,
  GMAIL_HOLD_MAX_MS,
  GMAIL_HOLD_PREFIX,
  cleanHeaders,
  countHeldEmails,
  defaultFromAddress,
  emailHeaders,
  emailTransportName,
  icsMethodOf,
  isHeldForGmail,
  listUnsubscribeHeaders,
  outboxMessageId,
  releaseHeldEmails,
  resendOutboxEmail,
  retryEmailDelivery,
  sendEmail,
  senderMailbox,
  sweepStuckEmails,
  type OutboxRow,
  type RetryEmailOutcome,
} from "./send";
export {
  EMAIL_PROVIDER_SETTING_KEY,
  GMAIL_SENDER_SETTING_KEY,
  describeEmailTransport,
  emailProviderFromEnv,
  getGmailSender,
  getInstanceOwner,
  resolveEmailTransport,
  type EmailProviderChoice,
  type EmailTransportResolution,
  type EmailTransportSource,
  type GmailSender,
} from "./gmail-sender";
export {
  EMAIL_COLORS,
  EMAIL_FONT_STACK,
  emailButtonHtml,
  emailPrimaryColor,
  renderEmailLayout,
  renderEmailText,
  type EmailLayoutInput,
} from "./layout";
export {
  composeEmail,
  emailBlockHtml,
  emailBlockText,
  renderEmail,
  type ComposeEmailInput,
  type EmailBlock,
  type EmailField,
  type EmailFieldLine,
} from "./blocks";
export { escapeHtml, escapeHtmlMultiline, htmlToText, isAbsoluteHttpUrl, safeHref } from "./html";
export { addressOf, formatAddress, isValidEmailAddress, normalizeRecipients, parseAddress, sanitizeHeaderValue } from "./address";
export { buildIcs, icsContentType, icsUid, type BuildIcsInput } from "./ics";
export {
  addToCalendarLinks,
  googleCalendarUrl,
  office365CalendarUrl,
  outlookCalendarUrl,
  type AddToCalendarLink,
  type CalendarLinkInput,
} from "./calendar-links";
export {
  meetingDateTimeLine,
  meetingEmailFields,
  meetingLocationLines,
  renderMeetingEmail,
  type MeetingEmailInput,
  type MeetingEmailKind,
} from "./meeting-templates";
export {
  buildMeetingIcs,
  emailBrandForUser,
  meetingSender,
  type BuildMeetingIcsInput,
  type MeetingIcs,
  type MeetingSender,
} from "./meeting";
