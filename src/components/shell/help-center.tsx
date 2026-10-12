// OWNER: foundation-ui.
//
// The in-app Help center (SPEC GEN-19 "Help center" with how-to articles written for this app, narrowed by
// docs/SCOPE.md): a dialog with one collapsible article per feature the owner uses (sharing the link, event types,
// available hours, meeting limits, Google Calendar, Troubleshoot, reminders, rescheduling and canceling, meeting
// polls), opened from the sidebar Help flyout and the account menu. The public /help page belongs to the marketing
// site, which docs/SCOPE.md does not build, so the dashboard carries its own help. Also the GEN-19 "What's new"
// changelog dialog.
"use client";

import type * as React from "react";
import { APP_NAME } from "@/lib/brand";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "../ui/accordion";
import { Dialog } from "../ui/dialog";

export type HelpArticle = { id: string; title: string; paragraphs: string[] };

/** How-to articles for the features in docs/SCOPE.md (plain data; unit tested for scope and copy rules). */
export const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    id: "share-link",
    title: "Share your scheduling link",
    paragraphs: [
      "Your booking page lists every event type that is turned on and not secret. Invitees pick an event, a day and a time, then enter their details.",
      "Copy the link from the account menu (Share your link) or from an event type card on Scheduling. Change the link itself in Settings, My link.",
    ],
  },
  {
    id: "event-types",
    title: "Create and edit event types",
    paragraphs: [
      "Choose + Create, then One-on-one. Give the event a name, duration and color, add the locations invitees can choose (Google Meet, an in-person place or a location the invitee enters) and the questions they answer when they book.",
      "Turn an event type on or off, copy its link, duplicate or delete it from its card on Scheduling.",
    ],
  },
  {
    id: "availability",
    title: "Set your available hours",
    paragraphs: [
      "Open Availability. Each schedule has weekly hours plus date-specific hours for days that are different. Times follow the schedule's time zone.",
      "Create more than one schedule (for example working hours and evenings) and choose the schedule each event type uses in the event type editor.",
    ],
  },
  {
    id: "limits",
    title: "Control how many meetings you get",
    paragraphs: [
      "For each event type you can add buffer time before and after meetings, require minimum notice, limit how far ahead invitees can book, choose the start time increments and cap the number of meetings per day or per week.",
      "To cap meetings across all event types, open Availability, Advanced settings and set the meeting limits per day and per week.",
    ],
  },
  {
    id: "google-calendar",
    title: "Connect Google Calendar",
    paragraphs: [
      "Open Integrations & apps, then Google Calendar, and connect your Google account. Busy events on the calendars you check for conflicts block those times; events marked as free do not, and all-day busy events block the whole day.",
      "New meetings are added to the calendar you choose, with a Google Meet link when the location is Google Meet. Moving or deleting that event in Google Calendar reschedules or cancels the meeting.",
    ],
  },
  {
    id: "troubleshoot",
    title: "See why a time is not available",
    paragraphs: [
      "Use Troubleshoot on the Availability page, or the Troubleshoot link on your own booking page while you are signed in.",
      "Pick a day to see every start time with its status and the reason it is blocked: outside your hours, a Google Calendar event, a buffer, minimum notice, the date range, a meeting limit or an existing meeting.",
    ],
  },
  {
    id: "reminders",
    title: "Reminders and notifications",
    paragraphs: [
      "Invitees get a confirmation email with a calendar invitation and a reminder email before the meeting (24 hours before by default). You can add reminders or change their timing for each event type.",
      "You get an email for every new, rescheduled and canceled meeting. Every invitee email has links to reschedule or cancel.",
    ],
  },
  {
    id: "reschedule-cancel",
    title: "Reschedule or cancel a meeting",
    paragraphs: [
      "Invitees reschedule or cancel with the links in their emails or on the confirmation page.",
      "To cancel a meeting yourself, open Meetings, find the meeting and choose Cancel. After a meeting you can mark the invitee as a no-show.",
    ],
  },
  {
    id: "polls",
    title: "Find a time with a meeting poll",
    paragraphs: [
      "Choose + Create, then Meeting poll. Offer a few times, share the poll link and see which times work for everyone.",
      "When you have a winner, book it: every participant gets a calendar invitation.",
    ],
  },
];

/** GEN-19 "What's new" sections (the features docs/SCOPE.md keeps). */
export const CHANGELOG: readonly { title: string; items: string[] }[] = [
  {
    title: "Scheduling",
    items: [
      "One-on-one event types with Google Meet, in-person places or a location the invitee enters, plus your own questions.",
      "Meeting polls to find a time that works for a group, then book it in one step.",
    ],
  },
  {
    title: "Availability",
    items: [
      "Named schedules with weekly and date-specific hours, chosen per event type.",
      "Buffers, minimum notice, date ranges and meeting limits per event type and across all of them.",
      "Troubleshoot shows why each start time is or is not available.",
    ],
  },
  {
    title: "Calendar and email",
    items: [
      "Google Calendar conflict checking, new meetings added with a Google Meet link, and moved or deleted events kept in sync.",
      "Confirmation, reminder, reschedule and cancellation emails with calendar invitations.",
    ],
  },
];

export type HelpCenterDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Instance operator email for the "Report a problem" footer link (MK-02). */
  operatorEmail?: string | null;
};

export function reportProblemHref(operatorEmail: string): string {
  const to = encodeURIComponent(operatorEmail).replace(/%40/g, "@");
  return `mailto:${to}?subject=${encodeURIComponent(`Report a problem with ${APP_NAME}`)}`;
}

export function HelpCenterDialog({ open, onOpenChange, operatorEmail }: HelpCenterDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Help center" description={`How to get the most out of ${APP_NAME}.`} size="lg">
      <Accordion type="single" collapsible className="-mt-1">
        {HELP_ARTICLES.map((a) => (
          <AccordionItem key={a.id} value={a.id}>
            <AccordionTrigger>{a.title}</AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-col gap-2">
                {a.paragraphs.map((p) => (
                  <p key={p}>{p}</p>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
      {operatorEmail && (
        <p className="mt-5 text-body-md text-ink-2">
          Still stuck?{" "}
          <a href={reportProblemHref(operatorEmail)} className="font-semibold text-primary-text underline-offset-2 hover:underline">
            Report a problem
          </a>
        </p>
      )}
    </Dialog>
  );
}

export function WhatsNewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="What's new" description={`Recent improvements to ${APP_NAME}.`} size="md">
      <div className="flex flex-col gap-5">
        {CHANGELOG.map((section): React.ReactNode => (
          <section key={section.title}>
            <h3 className="text-title-sm text-ink">{section.title}</h3>
            <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-body-md text-ink">
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
