// OWNER: workflows.
//
// The reminder rows of the event type editor's "Notifications and workflows" section (SPEC ET-25, NT-09;
// docs/SCOPE.md workflows lite), Calendly style: one row per notification with its icon, title, timing summary
// ("Sent 24 hours before event"), On/Off status and a three-dots menu (Edit, On/Off). Rows: "Email reminders" (to
// invitees) and "Email reminders to host". Switching a row on, or changing its timing, also schedules reminders for
// meetings that are already booked; the row then shows how many upcoming meetings have one. A warning appears when
// this server cannot send reminders on time (no recent /api/cron run where cron dispatches jobs, or overdue
// reminders). Loads its own data through a Server Action unless the editor passes `initial`.
"use client";

import { BellRing, Mail, MoreVertical, Pencil, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSwitchItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import { loadEventTypeRemindersAction, setEventTypeRemindersEnabledAction } from "@/lib/workflows/actions";
import { deliveryProblem, deliveryRemedy } from "@/lib/workflows/delivery-copy";
import { offsetsSummary } from "@/lib/workflows/timing";
import type { EventTypeRemindersView, ReminderDeliveryView, ReminderKind } from "@/lib/workflows/types";
import { REMINDER_COPY, ReminderDialog } from "./reminder-dialog";

export type RemindersSectionProps = {
  eventTypeId: string;
  canEdit: boolean;
  initial?: EventTypeRemindersView | null;
};

const KINDS: ReminderKind[] = ["invitee", "host"];
const ICONS: Record<ReminderKind, typeof Mail> = { invitee: Mail, host: BellRing };
/** After a change that backfills, refresh the counts once the background job had time to run. */
const REFRESH_AFTER_MS = 4_000;

/** "Reminders may be sent late": shown when reminders are on and this deployment cannot send them on time. */
export function DeliveryWarning({ delivery }: { delivery: ReminderDeliveryView }) {
  return (
    <Banner variant="warning" role="status" title="Reminders may be sent late">
      <span className="flex flex-col gap-2">
        <span>
          {deliveryProblem(delivery)} {deliveryRemedy(delivery)}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <code className="min-w-0 rounded-[6px] border border-line bg-surface px-2 py-1 text-[13px] break-all text-ink">{delivery.cronUrl}</code>
          <CopyButton value={delivery.cronUrl} size="sm" label="Copy URL" toastMessage="URL copied" />
        </span>
      </span>
    </Banner>
  );
}

function scheduledLine(n: number): string | null {
  if (n <= 0) return null;
  return `Scheduled for ${n} upcoming ${n === 1 ? "meeting" : "meetings"}`;
}

export function RemindersSection({ eventTypeId, canEdit, initial }: RemindersSectionProps) {
  const [view, setView] = useState<EventTypeRemindersView | null>(initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initial);
  const [editing, setEditing] = useState<ReminderKind | null>(null);
  const [pending, setPending] = useState<ReminderKind | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  /** Fetches the view; `quiet` refreshes keep the current rows on failure. */
  const load = useCallback(
    async (quiet = false) => {
      try {
        const res = await loadEventTypeRemindersAction({ eventTypeId });
        if (!alive.current) return;
        if (res.ok) {
          setView(res.data);
          setLoadError(null);
        } else if (!quiet) setLoadError(res.error.message);
      } catch {
        if (alive.current && !quiet) setLoadError("We couldn't load your reminders. Check your connection and try again.");
      } finally {
        if (alive.current && !quiet) setLoading(false);
      }
    },
    [eventTypeId],
  );

  const retry = () => {
    setLoading(true);
    setLoadError(null);
    void load();
  };

  useEffect(() => {
    alive.current = true;
    if (!initial) {
      loadEventTypeRemindersAction({ eventTypeId }).then(
        (res) => {
          if (!alive.current) return;
          if (res.ok) setView(res.data);
          else setLoadError(res.error.message);
          setLoading(false);
        },
        () => {
          if (!alive.current) return;
          setLoadError("We couldn't load your reminders. Check your connection and try again.");
          setLoading(false);
        },
      );
    }
    return () => {
      alive.current = false;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [eventTypeId, initial]);

  const refreshSoon = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void load(true), REFRESH_AFTER_MS);
  };

  const toggle = async (kind: ReminderKind, enabled: boolean) => {
    if (!view || pending) return;
    setPending(kind);
    const title = REMINDER_COPY[kind].title;
    try {
      const res = await setEventTypeRemindersEnabledAction({ eventTypeId, kind, enabled });
      if (!res.ok) {
        toast.error(res.error.message);
        return;
      }
      setView(res.data);
      const row = res.data[kind];
      const message = enabled ? `${title} turned on` : `${title} turned off`;
      if (enabled) {
        toast.success(message, {
          description: `Sent ${offsetsSummary(row.offsets)}`,
          action: { label: "Edit", onClick: () => setEditing(kind) },
        });
        refreshSoon();
      } else toast.success(message);
    } catch {
      toast.error("Something went wrong. Try again.");
    } finally {
      setPending(null);
    }
  };

  if (loading && !view) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        <span role="status" className="sr-only">
          Loading reminders
        </span>
        {KINDS.map((k) => (
          <div key={k} className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line px-4 py-3.5">
            <Skeleton width={20} height={20} rounded="full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton width="40%" height={16} />
              <Skeleton width="60%" height={14} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!view) {
    return (
      <Banner
        variant="error"
        role="alert"
        action={
          <Button size="sm" variant="secondary" leftIcon={<RefreshCw aria-hidden="true" />} onClick={retry}>
            Try again
          </Button>
        }
      >
        {loadError ?? "We couldn't load your reminders."}
      </Banner>
    );
  }

  const editable = canEdit && view.canEdit;
  const delivery = view.delivery;
  const anyOn = view.invitee.enabled || view.host.enabled;

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="event-type-reminders">
      {anyOn && delivery.warning && <DeliveryWarning delivery={delivery} />}
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
        {KINDS.map((kind) => {
          const row = view[kind];
          const copy = REMINDER_COPY[kind];
          const Icon = ICONS[kind];
          const summary = row.enabled ? `Sent ${offsetsSummary(row.offsets)}` : copy.offDescription;
          const scheduled = row.enabled ? scheduledLine(row.scheduledMeetings) : null;
          const titleId = `reminder-row-${kind}-title`;
          return (
            <li key={kind} className="flex min-w-0 items-start gap-3 px-4 py-3.5" aria-labelledby={titleId}>
              <span className={cn("mt-0.5 inline-flex shrink-0 [&_svg]:size-5", row.enabled ? "text-primary-text" : "text-ink-2")}>
                <Icon aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                {editable ? (
                  <button
                    type="button"
                    id={titleId}
                    onClick={() => setEditing(kind)}
                    className="text-left text-title-sm text-ink hover:text-primary-text hover:underline"
                  >
                    {copy.title}
                  </button>
                ) : (
                  <span id={titleId} className="text-title-sm text-ink">
                    {copy.title}
                  </span>
                )}
                <p className="text-body-md text-ink-2">{summary}</p>
                {scheduled && <p className="mt-0.5 text-body-sm text-ink-2">{scheduled}</p>}
              </div>
              <span className={cn("mt-0.5 shrink-0 text-body-sm font-semibold", row.enabled ? "text-success-text" : "text-ink-2")}>
                {row.enabled ? "On" : "Off"}
              </span>
              {editable && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton size="sm" aria-label={`${copy.title} options`} loading={pending === kind} className="-mt-1">
                      <MoreVertical aria-hidden="true" />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    <DropdownMenuItem icon={<Pencil aria-hidden="true" />} onSelect={() => setEditing(kind)}>
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuSwitchItem checked={row.enabled} disabled={pending !== null} onCheckedChange={(v) => void toggle(kind, v)}>
                      Send reminders
                    </DropdownMenuSwitchItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          );
        })}
      </ul>
      {!editable && view.readOnlyReason && <p className="text-body-sm text-ink-2">{view.readOnlyReason}</p>}
      {editing && (
        <ReminderDialog
          open
          onOpenChange={(v) => {
            if (!v) setEditing(null);
          }}
          kind={editing}
          view={view}
          onSaved={(next) => {
            setView(next);
            refreshSoon();
          }}
        />
      )}
    </div>
  );
}
