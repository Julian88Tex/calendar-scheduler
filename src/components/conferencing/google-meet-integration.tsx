// OWNER: conferencing.
//
// Integrations > Google Meet (SPEC VID-07, VID-11, CAL-21; docs/SCOPE.md: Meet is created through the Google Calendar
// event, so there is no separate Meet account to connect). Shows whether new meetings get Meet links and, when they
// don't, why and the one action that fixes it (connect or reconnect Google Calendar, choose a Google calendar to add
// events to); the event types that use Google Meet; the requirements checklist; how links reach invitees (the stable
// join link). Server component: every action is a link.
import type { Route } from "next";
import Link from "next/link";
import type * as React from "react";
import { ArrowRight, CalendarDays, Check, Pencil, RefreshCw, Settings2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ProviderLogo } from "@/components/ui/provider-logo";
import { cn } from "@/lib/cn";
import { CALENDAR_SETTINGS_PAGE_PATH, googleMeetConnectHref, type GoogleMeetStatus, type MeetEventType } from "@/lib/conferencing/options";
import { CONFERENCING_COPY } from "@/lib/conferencing/kinds";
import { MeetConnectNotices } from "./meet-connect-notices";
import type { MeetNotice } from "./notices";

export type GoogleMeetIntegrationProps = {
  status: GoogleMeetStatus;
  eventTypes: MeetEventType[];
  appName: string;
  isAdmin: boolean;
  notices: MeetNotice[];
};

type StateView = { badge: { label: string; variant: "success" | "warning" | "danger" | "neutral" }; title: string; body: string; tone: "success" | "info" | "warning" | "error" };

function stateView(s: GoogleMeetStatus, isAdmin: boolean): StateView {
  const calendar = s.calendar ? `${s.calendar.name}${s.calendar.accountEmail && s.calendar.accountEmail !== s.calendar.name ? ` (${s.calendar.accountEmail})` : ""}` : null;
  switch (s.state) {
    case "ready":
      return {
        badge: { label: "Ready", variant: "success" },
        tone: "success",
        title: "Google Meet is ready",
        body: `New meetings on event types that use Google Meet get a Meet link from ${calendar ?? "your Google Calendar"}.`,
      };
    case "not_configured":
      return {
        badge: { label: "Not configured on this server", variant: "neutral" },
        tone: "info",
        title: "Google isn't set up on this server yet",
        body: isAdmin
          ? "Google Meet links come from Google Calendar. Create a Google Cloud OAuth client and add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the server environment. docs/GOOGLE_SETUP.md walks through every step."
          : "Ask your administrator to set up Google sign in and Calendar access for this server.",
      };
    case "not_connected":
      return {
        badge: { label: "Not connected", variant: "neutral" },
        tone: "info",
        title: "Connect Google Calendar to use Google Meet",
        body: "Google Meet links are created by your Google Calendar when a meeting is booked, so connecting Google Calendar is all it takes.",
      };
    case "needs_reauth":
      return {
        badge: { label: "Action required", variant: "danger" },
        tone: "error",
        title: "Reconnect Google Calendar",
        body: "We can't access your Google Calendar anymore, so new meetings won't get Google Meet links until you reconnect it.",
      };
    case "meet_disabled":
      return {
        badge: { label: "Action required", variant: "warning" },
        tone: "warning",
        title: `Google Meet is turned off for ${s.calendar?.name ?? "this calendar"}`,
        body: "Ask your Google Workspace administrator to allow Google Meet, or choose another Google calendar to add events to.",
      };
    case "no_destination":
    case "destination_not_google":
    default:
      return {
        badge: { label: "Action required", variant: "warning" },
        tone: "warning",
        title: "Choose a Google calendar to add events to",
        body: CONFERENCING_COPY.meetRequiresGoogle,
      };
  }
}

function MeetTile({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center border border-line bg-white", size === "lg" ? "size-14 rounded-[12px]" : "size-10 rounded-[8px]")}
    >
      <ProviderLogo provider="meet" size={size === "lg" ? 34 : 24} />
    </span>
  );
}

function PrimaryAction({ status }: { status: GoogleMeetStatus }) {
  switch (status.state) {
    case "ready":
      return (
        <Button asChild variant="secondary" leftIcon={<Settings2 aria-hidden="true" />}>
          <Link href={CALENDAR_SETTINGS_PAGE_PATH as Route}>Calendar settings</Link>
        </Button>
      );
    case "not_connected":
      return status.serverConfigured ? (
        <Button asChild variant="primary" leftIcon={<CalendarDays aria-hidden="true" />}>
          <a href={googleMeetConnectHref()}>Connect Google Calendar</a>
        </Button>
      ) : null;
    case "needs_reauth":
      return status.serverConfigured ? (
        <Button asChild variant="primary" leftIcon={<RefreshCw aria-hidden="true" />}>
          <a href={googleMeetConnectHref(status.reconnectConnectionId)}>Reconnect Google Calendar</a>
        </Button>
      ) : (
        <Button asChild variant="secondary" leftIcon={<Settings2 aria-hidden="true" />}>
          <Link href={CALENDAR_SETTINGS_PAGE_PATH as Route}>Calendar settings</Link>
        </Button>
      );
    case "not_configured":
      return null;
    default:
      return (
        <Button asChild variant="primary" leftIcon={<Settings2 aria-hidden="true" />}>
          <Link href={CALENDAR_SETTINGS_PAGE_PATH as Route}>Choose a calendar</Link>
        </Button>
      );
  }
}

function Requirement({ done, children }: { done: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-body-md text-ink">
      {done ? (
        <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
      ) : (
        <X aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-3" />
      )}
      <span>
        {children}
        <span className="sr-only">{done ? " (done)" : " (not done yet)"}</span>
      </span>
    </li>
  );
}

export function GoogleMeetIntegration({ status, eventTypes, appName, isAdmin, notices }: GoogleMeetIntegrationProps) {
  const view = stateView(status, isAdmin);
  const hasAccount = status.accounts.some((a) => a.status !== "needs_reauth");
  const googleCalendarChosen = status.state === "ready" || status.state === "meet_disabled" || (status.state === "needs_reauth" && status.calendar !== null);
  const howItWorks = [
    "Google Meet links are created by your Google Calendar when a meeting is booked on an event type that uses Google Meet.",
    `While booking, invitees see "${CONFERENCING_COPY.beforeBooking}" The link is on their confirmation page and in their emails and calendar invitation.`,
    `Every meeting also has a join link on ${appName} that opens the current Meet link, even after the meeting is rescheduled.`,
    "Rescheduling keeps the same Meet link. Canceling removes the calendar event and its Meet.",
    `If a Meet link can't be added, the meeting is still booked and shows "${CONFERENCING_COPY.toFollow}"`,
  ];
  return (
    <div className="flex flex-col gap-6">
      <MeetConnectNotices notices={notices} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <MeetTile size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="text-title-md text-ink">Google Meet</h2>
                  <Badge variant={view.badge.variant} size="sm">
                    {view.badge.label}
                  </Badge>
                </div>
                <p className="mt-1 text-body-md text-ink-2">Add a Google Meet link to meetings booked on your Google Calendar.</p>
              </div>
            </div>
            <Banner className="mt-5" variant={view.tone} title={view.title} role="none">
              {view.body}
            </Banner>
            <div className="mt-4 flex flex-wrap gap-2 empty:hidden">
              <PrimaryAction status={status} />
            </div>
          </Card>

          <Card padding="none" role="region" aria-labelledby="meet-event-types-heading">
            <div className="px-5 pt-5 sm:px-6 sm:pt-6">
              <h2 id="meet-event-types-heading" className="text-title-md text-ink">
                Event types using Google Meet
              </h2>
              {eventTypes.length > 0 && status.state !== "ready" && (
                <p className="mt-1 text-body-md text-ink-2">Until Google Meet is ready, meetings booked on these event types show &quot;{CONFERENCING_COPY.toFollow}&quot;</p>
              )}
            </div>
            {eventTypes.length === 0 ? (
              <div className="px-5 pt-3 pb-5 sm:px-6 sm:pb-6">
                <p className="text-body-md text-ink-2">None of your event types use Google Meet yet. Choose Google Meet as the location of an event type to give its meetings a Meet link.</p>
                <Button asChild className="mt-4" variant="secondary">
                  <Link href={"/app/scheduling" as Route}>Go to Scheduling</Link>
                </Button>
              </div>
            ) : (
              <ul className="mt-4 border-t border-line">
                {eventTypes.map((et) => (
                  <li key={et.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-b-0 sm:px-6">
                    <span
                      aria-hidden="true"
                      className="inline-block size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: /^#[0-9a-fA-F]{3,8}$/.test(et.color) ? et.color : undefined }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-title-sm text-ink" title={et.name}>
                        {et.name}
                      </p>
                      {!et.onlyLocation && <p className="text-body-sm text-ink-2">Google Meet is one of several locations</p>}
                    </div>
                    {!et.active && (
                      <Badge variant="neutral" size="sm">
                        Off
                      </Badge>
                    )}
                    <Button asChild size="sm" variant="tertiary" leftIcon={<Pencil aria-hidden="true" />}>
                      <Link href={`/app/event-types/${et.id}` as Route} aria-label={`Edit ${et.name}`}>
                        Edit
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card role="region" aria-labelledby="meet-how-heading">
            <h2 id="meet-how-heading" className="text-title-md text-ink">
              How it works
            </h2>
            <ul className="mt-4 flex flex-col gap-3">
              {howItWorks.map((text) => (
                <li key={text} className="flex items-start gap-3 text-body-md text-ink">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <aside className="flex min-w-0 flex-col gap-6" aria-label="Google Meet requirements">
          <Card>
            <h2 className="text-title-sm text-ink">Requirements</h2>
            <ul className="mt-3 flex flex-col gap-3">
              <Requirement done={hasAccount}>A connected Google Calendar account</Requirement>
              <Requirement done={googleCalendarChosen}>A Google calendar chosen to add events to</Requirement>
              <Requirement done={status.state === "ready"}>Google Meet allowed for that calendar (personal Gmail accounts always allow it)</Requirement>
            </ul>
            {status.accounts.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <p className="text-body-sm text-ink-2">Google accounts</p>
                <ul className="mt-2 flex flex-col gap-1">
                  {status.accounts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 text-body-md text-ink">
                      <span className="min-w-0 truncate" title={a.email ?? undefined}>
                        {a.email ?? "Google account"}
                      </span>
                      {a.status === "needs_reauth" && (
                        <Badge variant="danger" size="sm">
                          Action required
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
          <Card>
            <h2 className="text-title-sm text-ink">Google Calendar</h2>
            <p className="mt-3 text-body-md text-ink-2">Meet links follow your Google Calendar connection. Manage accounts, conflicts and the calendar to add events to there.</p>
            <Button asChild className="mt-4" variant="tertiary" size="sm" rightIcon={<ArrowRight aria-hidden="true" />}>
              <Link href={"/app/integrations/calendars/google" as Route}>Google Calendar integration</Link>
            </Button>
          </Card>
        </aside>
      </div>
    </div>
  );
}
