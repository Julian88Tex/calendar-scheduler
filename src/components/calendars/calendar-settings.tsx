// OWNER: calendar-integrations.
//
// Availability > Calendar settings (SPEC CAL-01, CAL-06, CAL-07, CAL-08, CAL-13, CAL-14, CAL-15, CAL-16; walkthrough
// 9.3): the "Calendar connections" card ("{n} of 6 calendar accounts", one row per account with its status and a
// kebab with Reconnect / Disconnect, "+ Connect calendar account"), and the "Configuration" card: "Calendars to check
// for conflicts" (per account, Edit opens the selection modal), "Calendar to add events to" (single choice across
// accounts or None, Edit opens the modal) with the destination's sync settings ("Include buffers on this calendar",
// "Automatically sync cancellations and reschedules from this calendar to {AppName}"). Changes save immediately.
"use client";

import { AlertTriangle, MoreVertical, RefreshCw, Unplug } from "lucide-react";
import { useMemo, useState, useTransition } from "react";
import type { CalendarSettingsView, SettingsCalendar, SettingsConnection } from "@/lib/calendars/settings";
import { disconnectCalendar, saveCalendarSyncSettings, saveConflictCalendars, saveDestinationCalendar } from "@/lib/calendars/actions";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Illustration } from "@/components/ui/illustration";
import { RadioGroup } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/components/ui/toast";
import { ConnectCalendarDialog } from "./connect-calendar-dialog";
import { CalendarDot, ConnectionStatusBadge, connectionProblemText, googleConnectHref, providerMeta, ProviderTile } from "./shared";

export type CalendarSettingsProps = {
  view: CalendarSettingsView;
  appName: string;
  isAdmin: boolean;
};

type Result = { ok: true } | { ok: false; error: { message: string } };

function reportFailure(r: Result): boolean {
  if (r.ok) return false;
  toast.error(r.error.message);
  return true;
}

const accountLabel = (c: Pick<SettingsConnection, "email" | "displayName" | "provider">) => c.email ?? c.displayName ?? providerMeta(c.provider).name;

export function CalendarSettings({ view, appName, isAdmin }: CalendarSettingsProps) {
  const connections = view.connections;
  return (
    <div className="flex max-w-[880px] flex-col gap-6">
      <ConnectionsCard view={view} isAdmin={isAdmin} />
      {connections.length > 0 && <ConfigurationCard view={view} appName={appName} />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Calendar connections

function ConnectionsCard({ view, isAdmin }: { view: CalendarSettingsView; isAdmin: boolean }) {
  const count = view.connections.length;
  const connect = (
    <ConnectCalendarDialog googleConfigured={view.googleConfigured} count={count} maxAccounts={view.maxAccounts} isAdmin={isAdmin} triggerVariant={count ? "secondary" : "primary"} />
  );
  return (
    <Card padding="none" role="region" aria-labelledby="calendar-connections-heading">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 pt-5 sm:px-6 sm:pt-6">
        <div className="min-w-0">
          <h2 id="calendar-connections-heading" className="text-title-md text-ink">
            Calendar connections
          </h2>
          <p className="mt-1 text-body-md text-ink-2">
            {count} of {view.softLimit} calendar accounts
          </p>
        </div>
        {count > 0 && connect}
      </div>
      {count === 0 ? (
        <EmptyState
          className="py-10"
          illustration={<Illustration name="calendar" size={120} />}
          heading="Connect your calendar"
          body="Connect your calendar to auto-check for busy times and add new events as they are scheduled."
          action={connect}
        />
      ) : (
        <ul className="mt-4 border-t border-line" aria-label="Connected calendar accounts">
          {view.connections.map((c) => (
            <ConnectionRow key={c.id} connection={c} googleConfigured={view.googleConfigured} />
          ))}
        </ul>
      )}
      {count > view.softLimit && (
        <p className="px-5 pb-5 text-body-md text-warning-text sm:px-6">
          You have more than {view.softLimit} calendar accounts connected. Every account is checked for conflicts on each booking, which can slow your booking page down.
        </p>
      )}
    </Card>
  );
}

function ConnectionRow({ connection: c, googleConfigured }: { connection: SettingsConnection; googleConfigured: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const meta = providerMeta(c.provider);
  const label = accountLabel(c);
  const problem = connectionProblemText(c.status);
  const canReconnect = c.provider === "google" && googleConfigured;
  const reconnectHref = googleConnectHref({ reconnectId: c.id });
  return (
    <li className="border-b border-line px-5 py-4 last:border-b-0 sm:px-6">
      <div className="flex items-center gap-3 sm:gap-4">
        <ProviderTile provider={meta.logo} />
        <div className="min-w-0 flex-1">
          <p className="text-title-sm text-ink">{c.provider === "calendly_import" ? (c.displayName ?? meta.name) : meta.name}</p>
          <p className="truncate text-body-md text-ink-2" title={label}>
            {c.provider === "calendly_import" ? "Read only" : label}
          </p>
        </div>
        <ConnectionStatusBadge status={c.status} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton aria-label={`Options for ${label}`}>
              <MoreVertical aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {canReconnect && (
              <DropdownMenuItem asChild>
                <a href={reconnectHref}>
                  <RefreshCw aria-hidden="true" className="text-ink-2" />
                  Reconnect
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem destructive icon={<Unplug aria-hidden="true" />} onSelect={() => setConfirm(true)}>
              Disconnect
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {problem && (
        <Banner
          className="mt-3"
          variant={c.status === "needs_reauth" ? "error" : "warning"}
          action={
            canReconnect ? (
              <Button asChild size="sm" variant={c.status === "needs_reauth" ? "primary" : "secondary"}>
                <a href={reconnectHref}>Reconnect</a>
              </Button>
            ) : undefined
          }
        >
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
          if (r.data.destinationCleared) {
            toast.info("New meetings won't be added to a calendar until you choose a calendar to add events to.");
          }
        }}
      />
    </li>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Configuration

function ConfigurationCard({ view, appName }: { view: CalendarSettingsView; appName: string }) {
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [destinationOpen, setDestinationOpen] = useState(false);
  const allCalendars = useMemo(() => view.connections.flatMap((c) => c.calendars.map((cal) => ({ cal, conn: c }))), [view.connections]);
  const destination = allCalendars.find((x) => x.cal.id === view.destinationCalendarId) ?? null;
  const anyChecked = allCalendars.some((x) => x.cal.checkConflicts);
  const writable = allCalendars.filter((x) => x.cal.canWrite);
  const [pending, start] = useTransition();

  return (
    <Card padding="none" role="region" aria-labelledby="calendar-configuration-heading">
      <div className="px-5 pt-5 sm:px-6 sm:pt-6">
        <h2 id="calendar-configuration-heading" className="text-title-md text-ink">
          Configuration
        </h2>
        <p className="mt-1 text-body-md text-ink-2">Set which calendars we use to check for busy times.</p>
      </div>

      <section aria-labelledby="conflicts-heading" className="px-5 py-5 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 id="conflicts-heading" className="text-title-sm text-ink">
              Calendars to check for conflicts
            </h3>
            <p className="mt-0.5 text-body-md text-ink-2">These calendars will be used to prevent double bookings</p>
          </div>
          <Button variant="tertiary" size="sm" onClick={() => setConflictsOpen(true)} aria-label="Edit calendars to check for conflicts">
            Edit
          </Button>
        </div>
        <ul className="mt-4 flex flex-col gap-3">
          {view.connections.map((c) => {
            const checked = c.calendars.filter((cal) => cal.checkConflicts);
            return (
              <li key={c.id} className="rounded-[var(--radius-card)] border border-line p-4">
                <div className="flex items-center gap-2.5">
                  <ProviderTile provider={providerMeta(c.provider).logo} size="sm" />
                  <span className="min-w-0 truncate text-[14px] font-semibold text-ink">{accountLabel(c)}</span>
                </div>
                {checked.length ? (
                  <>
                    <p className="mt-3 text-body-sm text-ink-2">
                      Checking {checked.length} of {c.calendars.length} {c.calendars.length === 1 ? "calendar" : "calendars"}
                    </p>
                    <ul className="mt-1.5 flex flex-col gap-1.5">
                      {checked.map((cal) => (
                        <li key={cal.id} className="flex min-w-0 items-center gap-2 text-body-md text-ink">
                          <CalendarDot color={cal.color} />
                          <span className="truncate">{cal.name}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-3 text-body-md text-ink-2">No calendars from this account are checked for conflicts.</p>
                )}
              </li>
            );
          })}
        </ul>
        {!anyChecked && (
          <Banner className="mt-4" variant="warning" icon={<AlertTriangle aria-hidden="true" />}>
            No calendars are checked for conflicts, so invitees can book times when you&apos;re busy.
          </Banner>
        )}
      </section>

      <Separator />

      <section aria-labelledby="destination-heading" className="px-5 py-5 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 id="destination-heading" className="text-title-sm text-ink">
              Calendar to add events to
            </h3>
            <p className="mt-0.5 text-body-md text-ink-2">Set the calendar you would like to add new events to as they&apos;re scheduled</p>
          </div>
          <Button variant="tertiary" size="sm" onClick={() => setDestinationOpen(true)} aria-label="Edit calendar to add events to" disabled={writable.length === 0}>
            Edit
          </Button>
        </div>
        <div className="mt-4 rounded-[var(--radius-card)] border border-line p-4">
          {destination ? (
            <>
              <div className="flex items-center gap-2.5">
                <ProviderTile provider={providerMeta(destination.conn.provider).logo} size="sm" />
                <span className="min-w-0 truncate text-[14px] font-semibold text-ink">{accountLabel(destination.conn)}</span>
              </div>
              <p className="mt-3 flex min-w-0 items-center gap-2 text-body-md text-ink" data-testid="destination-calendar">
                <CalendarDot color={destination.cal.color} />
                <span className="truncate">{destination.cal.name}</span>
              </p>
            </>
          ) : (
            <p className="text-body-md text-ink-2" data-testid="destination-calendar">
              {writable.length
                ? "None. New meetings aren't added to a calendar; invitees get email confirmations with a calendar invite instead."
                : "None of your connected calendars can receive events."}
            </p>
          )}
        </div>
        {destination && !destination.cal.checkConflicts && (
          <Banner
            className="mt-4"
            variant="info"
            action={
              <Button
                size="sm"
                variant="secondary"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const r = await saveConflictCalendars({ changes: [{ calendarId: destination.cal.id, checked: true }] });
                    if (!reportFailure(r)) toast.success("Changes saved");
                  })
                }
              >
                Check it for conflicts
              </Button>
            }
          >
            {destination.cal.name} isn&apos;t checked for conflicts. Free/busy rules work best when the calendar you add events to is also checked.
          </Banner>
        )}
        {destination && <SyncSettings key={destination.cal.id} calendar={destination.cal} appName={appName} />}
      </section>

      <ConflictsDialog open={conflictsOpen} onOpenChange={setConflictsOpen} connections={view.connections} />
      <DestinationDialog open={destinationOpen} onOpenChange={setDestinationOpen} connections={view.connections} current={view.destinationCalendarId} />
    </Card>
  );
}

function SyncSettings({ calendar, appName }: { calendar: SettingsCalendar; appName: string }) {
  const [includeBuffers, setIncludeBuffers] = useState(calendar.includeBuffers);
  const [syncChanges, setSyncChanges] = useState(calendar.syncChanges);
  const [, start] = useTransition();
  const save = (patch: { includeBuffers?: boolean; syncChanges?: boolean }, undo: () => void) =>
    start(async () => {
      const r = await saveCalendarSyncSettings({ calendarId: calendar.id, ...patch });
      if (reportFailure(r)) undo();
      else toast.success("Changes saved");
    });
  return (
    <div className="mt-5 flex flex-col gap-3" role="group" aria-labelledby="sync-settings-heading">
      <h4 id="sync-settings-heading" className="text-label text-ink">
        Sync settings
      </h4>
      <Checkbox
        checked={includeBuffers}
        onCheckedChange={(v) => {
          setIncludeBuffers(v);
          save({ includeBuffers: v }, () => setIncludeBuffers(!v));
        }}
        label="Include buffers on this calendar"
        description="Adds the buffer time before and after your meetings as separate busy events titled “Buffer: {meeting}”."
      />
      <Checkbox
        checked={syncChanges}
        onCheckedChange={(v) => {
          setSyncChanges(v);
          save({ syncChanges: v }, () => setSyncChanges(!v));
        }}
        label={`Automatically sync cancellations and reschedules from this calendar to ${appName}`}
        description="Deleting a meeting's event in your calendar cancels the meeting, and moving it reschedules the meeting. Invitees are notified."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Dialogs

function ConflictsDialog({ open, onOpenChange, connections }: { open: boolean; onOpenChange: (v: boolean) => void; connections: SettingsConnection[] }) {
  const initial = useMemo(() => new Map(connections.flatMap((c) => c.calendars.map((cal) => [cal.id, cal.checkConflicts] as const))), [connections]);
  const [draft, setDraft] = useState<Map<string, boolean>>(initial);
  const [pending, start] = useTransition();
  const changes = [...draft].filter(([id, v]) => initial.get(id) !== v).map(([calendarId, checked]) => ({ calendarId, checked }));
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) setDraft(new Map(initial));
        onOpenChange(v);
      }}
      size="md"
      title="Check for conflicts"
      description="Set the calendar(s) to check for conflicts to prevent double bookings."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            loading={pending}
            disabled={changes.length === 0}
            onClick={() =>
              start(async () => {
                const r = await saveConflictCalendars({ changes });
                if (reportFailure(r)) return;
                toast.success("Changes saved");
                onOpenChange(false);
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {connections.map((c) => (
          <fieldset key={c.id} className="flex flex-col gap-3">
            <legend className="mb-3 flex items-center gap-2.5 text-[14px] font-semibold text-ink">
              <ProviderTile provider={providerMeta(c.provider).logo} size="sm" />
              <span className="min-w-0 truncate">{accountLabel(c)}</span>
            </legend>
            {c.calendars.length === 0 && <p className="text-body-md text-ink-2">This account has no calendars.</p>}
            {c.calendars.map((cal) => (
              <Checkbox
                key={cal.id}
                checked={draft.get(cal.id) ?? false}
                onCheckedChange={(v) => setDraft((d) => new Map(d).set(cal.id, v))}
                label={
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <CalendarDot color={cal.color} />
                    <span className="truncate">{cal.name}</span>
                  </span>
                }
                description={!cal.canWrite ? "View only" : cal.isPrimary ? "Primary calendar" : undefined}
              />
            ))}
          </fieldset>
        ))}
      </div>
    </Dialog>
  );
}

const NONE = "none";

function DestinationDialog({
  open,
  onOpenChange,
  connections,
  current,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  connections: SettingsConnection[];
  current: string | null;
}) {
  const [value, setValue] = useState<string>(current ?? NONE);
  const [pending, start] = useTransition();
  const groups = connections.map((c) => ({ c, cals: c.calendars.filter((cal) => cal.canWrite) })).filter((g) => g.cals.length > 0);
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v) setValue(current ?? NONE);
        onOpenChange(v);
      }}
      size="md"
      title="Add to calendar"
      description="Select the calendar new events are added to as they're scheduled. Changing it affects new meetings only."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            loading={pending}
            disabled={value === (current ?? NONE)}
            onClick={() =>
              start(async () => {
                const r = await saveDestinationCalendar({ calendarId: value === NONE ? null : value });
                if (reportFailure(r)) return;
                toast.success("Changes saved");
                onOpenChange(false);
              })
            }
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {groups.map(({ c, cals }) => (
          <div key={c.id} className="flex flex-col gap-3">
            <p id={`dest-${c.id}`} className="flex items-center gap-2.5 text-[14px] font-semibold text-ink">
              <ProviderTile provider={providerMeta(c.provider).logo} size="sm" />
              <span className="min-w-0 truncate">{accountLabel(c)}</span>
            </p>
            <RadioGroup
              aria-labelledby={`dest-${c.id}`}
              value={cals.some((cal) => cal.id === value) ? value : ""}
              onValueChange={setValue}
              options={cals.map((cal) => ({
                value: cal.id,
                label: (
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <CalendarDot color={cal.color} />
                    <span className="truncate">{cal.name}</span>
                  </span>
                ),
                description: cal.isPrimary ? "Primary calendar" : undefined,
              }))}
            />
          </div>
        ))}
        <div className="border-t border-line pt-4">
          <RadioGroup
            aria-label="Other options"
            value={value === NONE ? NONE : ""}
            onValueChange={setValue}
            options={[{ value: NONE, label: "None", description: "Don't add new meetings to a calendar. Invitees get email confirmations instead." }]}
          />
        </div>
      </div>
    </Dialog>
  );
}
