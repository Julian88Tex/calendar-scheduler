// OWNER: calendar-integrations.
//
// Integrations > Google Calendar (SPEC CAL-21, CAL-02, CAL-14, CAL-16; docs/SCOPE.md): what the integration does
// ("How it works"), the connected Google accounts with Reconnect and Disconnect, connect (another) account, the
// permissions requested, and how quickly host-side changes sync (push notifications on public https deployments,
// otherwise every background job run).
"use client";

import type { Route } from "next";
import Link from "next/link";
import { Check, RefreshCw, Settings2, Unplug } from "lucide-react";
import { useState } from "react";
import type { CalendarSettingsView, SettingsConnection } from "@/lib/calendars/settings";
import { disconnectCalendar } from "@/lib/calendars/actions";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/toast";
import { ConnectCalendarDialog } from "./connect-calendar-dialog";
import { CALENDAR_SETTINGS_PATH, ConnectionStatusBadge, connectionProblemText, googleConnectHref, ProviderTile } from "./shared";

export type GoogleCalendarIntegrationProps = {
  view: CalendarSettingsView;
  appName: string;
  isAdmin: boolean;
};

const DETAIL_PATH = "/app/integrations/calendars/google";

export function GoogleCalendarIntegration({ view, appName, isAdmin }: GoogleCalendarIntegrationProps) {
  const google = view.connections.filter((c) => c.provider === "google");
  const total = view.connections.length;
  const howItWorks = [
    `${appName} checks the calendars you choose for conflicts, so invitees only see times when you're free.`,
    "Events marked Free, invitations you declined and working locations don't block your availability. Busy events, out of office and all-day events do.",
    "New meetings are added to the calendar you choose, with the invitee as a guest and a Google Meet link when the event type uses Google Meet.",
    `Moving or deleting a meeting's event in Google Calendar reschedules or cancels the meeting in ${appName} and notifies your invitees.`,
  ];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <ProviderTile provider="google" size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="text-title-md text-ink">Google Calendar</h2>
              <p className="mt-1 text-body-md text-ink-2">Check Gmail and Google Workspace calendars for conflicts and add new events as they are scheduled.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <ConnectCalendarDialog
                  googleConfigured={view.googleConfigured}
                  count={total}
                  maxAccounts={view.maxAccounts}
                  isAdmin={isAdmin}
                  next={DETAIL_PATH}
                  triggerLabel={google.length ? "Connect another account" : "Connect Google Calendar"}
                  triggerVariant={google.length ? "secondary" : "primary"}
                />
                {google.length > 0 && (
                  <Button asChild variant="tertiary" leftIcon={<Settings2 aria-hidden="true" />}>
                    <Link href={CALENDAR_SETTINGS_PATH as Route}>Calendar settings</Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
          {!view.googleConfigured && (
            <Banner className="mt-5" variant="info" title="Not configured on this server">
              {isAdmin
                ? "Create a Google Cloud OAuth client and add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the server environment. docs/GOOGLE_SETUP.md walks through every step."
                : "Ask your administrator to set up Google sign in and Calendar access for this server."}
            </Banner>
          )}
        </Card>

        {google.length > 0 && (
          <Card padding="none" role="region" aria-labelledby="google-accounts-heading">
            <h2 id="google-accounts-heading" className="px-5 pt-5 text-title-md text-ink sm:px-6 sm:pt-6">
              Connected accounts
            </h2>
            <ul className="mt-4 border-t border-line">
              {google.map((c) => (
                <AccountRow key={c.id} connection={c} canReconnect={view.googleConfigured} />
              ))}
            </ul>
          </Card>
        )}

        <Card role="region" aria-labelledby="how-it-works-heading">
          <h2 id="how-it-works-heading" className="text-title-md text-ink">
            How it works
          </h2>
          <ul className="mt-4 flex flex-col gap-3">
            {howItWorks.map((line) => (
              <li key={line} className="flex items-start gap-3 text-body-md text-ink">
                <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <aside className="flex min-w-0 flex-col gap-6">
        <Card>
          <h2 className="text-title-sm text-ink">Permissions</h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-body-md text-ink-2">
            <li>See your calendars and the events on them, to find busy times.</li>
            <li>Create, change and delete the events you schedule here.</li>
          </ul>
          <p className="mt-3 text-body-sm text-ink-2">Disconnecting revokes this access.</p>
        </Card>
        <Card>
          <h2 className="text-title-sm text-ink">Changes made in Google Calendar</h2>
          <p className="mt-3 text-body-md text-ink-2">
            {view.pushNotifications
              ? "Google notifies us when your calendar changes, so moved or deleted meetings update within seconds."
              : "Moved or deleted meetings are picked up every time background jobs run (about every 10 minutes when a scheduler pings the server)."}
          </p>
        </Card>
      </aside>
    </div>
  );
}

function AccountRow({ connection: c, canReconnect }: { connection: SettingsConnection; canReconnect: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const label = c.email ?? c.displayName ?? "Google account";
  const problem = connectionProblemText(c.status);
  const reconnectHref = googleConnectHref({ next: DETAIL_PATH, reconnectId: c.id });
  const checked = c.calendars.filter((cal) => cal.checkConflicts).length;
  return (
    <li className="border-b border-line px-5 py-4 last:border-b-0 sm:px-6">
      <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap sm:gap-4">
        <ProviderTile provider="google" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-title-sm text-ink" title={label}>
            {label}
          </p>
          <p className="text-body-md text-ink-2">
            Checking {checked} of {c.calendars.length} {c.calendars.length === 1 ? "calendar" : "calendars"} for conflicts
          </p>
        </div>
        <ConnectionStatusBadge status={c.status} />
        <div className="flex gap-2">
          {canReconnect && c.status !== "active" && (
            <Button asChild size="sm" variant="secondary" leftIcon={<RefreshCw aria-hidden="true" />}>
              <a href={reconnectHref}>Reconnect</a>
            </Button>
          )}
          <Button size="sm" variant="secondary" leftIcon={<Unplug aria-hidden="true" />} onClick={() => setConfirm(true)} aria-label={`Disconnect ${label}`}>
            Disconnect
          </Button>
        </div>
      </div>
      {problem && (
        <Banner className="mt-3" variant={c.status === "needs_reauth" ? "error" : "warning"}>
          {problem}
        </Banner>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Disconnect ${label}?`}
        description="Events already added to this calendar stay there, but new meetings won't be added and it won't be checked for conflicts."
        confirmLabel="Disconnect"
        variant="destructive"
        onConfirm={async () => {
          const r = await disconnectCalendar({ connectionId: c.id });
          if (!r.ok) throw new Error(r.error.message);
          toast.success("Calendar disconnected");
          if (r.data.destinationCleared) toast.info("New meetings won't be added to a calendar until you choose a calendar to add events to.");
        }}
      />
    </li>
  );
}
