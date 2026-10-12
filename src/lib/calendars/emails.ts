// OWNER: calendar-integrations.
//
// Email templates of this module (ARCHITECTURE section 13.2): the CAL-15 connection problem email. Pure: returns
// { subject, html, text } through the shared Calendly-style blocks. The button opens the Calendar settings page (GET
// never changes state, GEN-08); reconnecting happens there.
import { appName } from "@/lib/brand";
import { renderEmail, type EmailBrand, type RenderedEmail } from "@/lib/email";
import { absoluteUrl } from "@/lib/url";

const PROVIDER_NAMES: Record<string, string> = {
  google: "Google Calendar",
  microsoft: "Outlook Calendar",
  caldav: "CalDAV calendar",
  ics: "calendar feed",
  calendly_import: "imported calendar",
};

export function connectionProblemEmail(p: {
  name: string | null;
  accounts: { email: string | null; provider: string }[];
  brand: EmailBrand;
}): RenderedEmail {
  const app = appName();
  const first = p.name?.trim().split(/\s+/)[0] || null;
  const list = p.accounts.map((a) => `${PROVIDER_NAMES[a.provider] ?? "Calendar"}${a.email ? `: ${a.email}` : ""}`);
  const one = p.accounts.length === 1;
  return renderEmail({
    subject: "There is a problem with your calendar connection",
    preheader: `Reconnect your calendar so ${app} can keep checking it for conflicts.`,
    heading: "There is a problem with your calendar connection",
    brand: p.brand,
    blocks: [
      { kind: "text", text: first ? `Hi ${first},` : "Hi," },
      {
        kind: "text",
        text: one
          ? `We can't connect to your calendar account. Until you reconnect it, ${app} can't check it for conflicts or add new events to it, so invitees might book times when you're busy.`
          : `We can't connect to some of your calendar accounts. Until you reconnect them, ${app} can't check them for conflicts or add new events to them, so invitees might book times when you're busy.`,
      },
      { kind: "fields", items: [{ label: one ? "Calendar account" : "Calendar accounts", lines: list }] },
      { kind: "button", label: "Reconnect", url: absoluteUrl("/app/availability/calendar-settings") },
      {
        kind: "text",
        muted: true,
        small: true,
        text: "Reconnecting keeps your settings: the calendars checked for conflicts and the calendar new events are added to.",
      },
    ],
    reason: `You're receiving this email because a calendar is connected to your ${app} account. You can turn off calendar connection emails in Settings > Notifications.`,
  });
}
