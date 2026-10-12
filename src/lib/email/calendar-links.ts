// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// "Add to calendar" links (SPEC BK-22): Google, Outlook.com and Office 365 template URLs (title, UTC times, location and
// details prefilled) plus the ICS download, for invitee emails and the confirmation page. Pure and client safe.
import { getT } from "../i18n";

export type CalendarLinkInput = {
  title: string;
  start: Date;
  end: Date;
  location?: string | null;
  details?: string | null;
  /** All-day on this date (YYYY-MM-DD). */
  allDayDate?: string | null;
};

const compact = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
// Template URLs have practical length limits (about 2,000 characters in some browsers): keep details short.
const clip = (s: string | null | undefined, max: number) => {
  const v = (s ?? "").trim();
  return v.length > max ? `${v.slice(0, max - 3)}...` : v;
};

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Google Calendar "create event" template URL. */
export function googleCalendarUrl(p: CalendarLinkInput): string {
  const q = new URLSearchParams({ action: "TEMPLATE", text: clip(p.title, 300) });
  q.set("dates", p.allDayDate ? `${p.allDayDate.replace(/-/g, "")}/${nextDay(p.allDayDate).replace(/-/g, "")}` : `${compact(p.start)}/${compact(p.end)}`);
  if (p.details) q.set("details", clip(p.details, 1000));
  if (p.location) q.set("location", clip(p.location, 300));
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

function outlookCompose(base: string, p: CalendarLinkInput): string {
  const q = new URLSearchParams({ path: "/calendar/action/compose", rru: "addevent", subject: clip(p.title, 300) });
  if (p.allDayDate) {
    q.set("startdt", p.allDayDate);
    q.set("enddt", nextDay(p.allDayDate));
    q.set("allday", "true");
  } else {
    q.set("startdt", iso(p.start));
    q.set("enddt", iso(p.end));
  }
  if (p.details) q.set("body", clip(p.details, 1000));
  if (p.location) q.set("location", clip(p.location, 300));
  return `${base}?${q.toString()}`;
}

/** Outlook.com (personal accounts) compose URL. */
export function outlookCalendarUrl(p: CalendarLinkInput): string {
  return outlookCompose("https://outlook.live.com/calendar/0/action/compose", p);
}

/** Office 365 (work accounts) compose URL. */
export function office365CalendarUrl(p: CalendarLinkInput): string {
  return outlookCompose("https://outlook.office.com/calendar/0/action/compose", p);
}

export type AddToCalendarLink = { id: "google" | "outlook" | "office365" | "ical"; label: string; url: string };

/** The four BK-22 links with localized labels ("Google", "Outlook.com", "Office 365", "Apple / iCal"). */
export function addToCalendarLinks(p: CalendarLinkInput & { icsUrl: string; locale?: string | null }): AddToCalendarLink[] {
  const t = getT(p.locale ?? "en", "common");
  return [
    { id: "google", label: t("meeting.google"), url: googleCalendarUrl(p) },
    { id: "outlook", label: t("meeting.outlook"), url: outlookCalendarUrl(p) },
    { id: "office365", label: t("meeting.office365"), url: office365CalendarUrl(p) },
    { id: "ical", label: t("meeting.ical"), url: p.icsUrl },
  ];
}
