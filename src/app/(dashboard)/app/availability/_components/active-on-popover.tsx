// "Active on" (SPEC AV-09; walkthrough 9.2): "Active on: 2 event types" opens the checklist of the user's single-host
// event types; "Apply" assigns the checked ones to this schedule. Checking an event type that uses custom hours asks
// "This event type uses custom hours. Replace them with {schedule}?". Unchecked event types go back to the default
// schedule; the default schedule's own event types cannot be unchecked (they have nowhere else to go).
"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Popover } from "@/components/ui/popover";
import type { ActiveOnEventType } from "@/lib/availability/types";

export type ActiveOnPopoverProps = {
  scheduleId: string;
  scheduleName: string;
  isDefault: boolean;
  eventTypes: ActiveOnEventType[];
  /** Resolves true when applied. */
  onApply: (eventTypeIds: string[], replaceCustom: boolean) => Promise<boolean>;
};

export function activeOnLabel(n: number): string {
  return `Active on: ${n} ${n === 1 ? "event type" : "event types"}`;
}

export function ActiveOnPopover({ scheduleId, scheduleName, isDefault, eventTypes, onApply }: ActiveOnPopoverProps) {
  const activeIds = eventTypes.filter((e) => e.scheduleId === scheduleId).map((e) => e.id);
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set(activeIds));
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string[] | null>(null);

  const apply = async (replaceCustom: boolean) => {
    setBusy(true);
    try {
      const ok = await onApply([...checked], replaceCustom);
      if (ok) setOpen(false);
      return ok;
    } finally {
      setBusy(false);
    }
  };

  const customToReplace = eventTypes.filter((e) => e.custom && checked.has(e.id) && e.scheduleId !== scheduleId);
  const unchanged = activeIds.length === checked.size && activeIds.every((id) => checked.has(id));

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(v) => {
          if (busy) return;
          setOpen(v);
          if (v) setChecked(new Set(activeIds));
        }}
        align="start"
        className="w-[min(340px,calc(100vw-32px))] p-0"
        aria-label="Active on"
        trigger={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-full py-1 text-body-md font-semibold text-primary-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {activeOnLabel(activeIds.length)}
            <ChevronDown aria-hidden="true" className="size-4" />
          </button>
        }
      >
        <div className="border-b border-line px-4 pt-4 pb-3">
          <p className="text-title-sm font-bold text-ink">Active on</p>
          <p className="text-body-sm text-ink-2">Event types that use {scheduleName}</p>
        </div>
        {eventTypes.length === 0 ? (
          <p className="px-4 py-4 text-body-md text-ink-2">You don&apos;t have any event types yet.</p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-3 overflow-y-auto px-4 py-4">
            {eventTypes.map((et) => {
              const locked = isDefault && et.scheduleId === scheduleId;
              return (
                <li key={et.id}>
                  <Checkbox
                    checked={checked.has(et.id)}
                    disabled={busy || locked}
                    onCheckedChange={(on) =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(et.id);
                        else next.delete(et.id);
                        return next;
                      })
                    }
                    label={
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: et.color }} />
                        <span className="min-w-0 truncate">{et.name}</span>
                      </span>
                    }
                    description={et.custom ? "Uses custom hours" : !et.active ? "Off" : undefined}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-col gap-3 border-t border-line px-4 py-3">
          <p className="text-body-sm text-ink-2">
            {isDefault ? "To move an event type off your default schedule, assign it to another schedule." : "Unchecked event types use your default schedule."}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={busy}
              disabled={unchanged || eventTypes.length === 0}
              onClick={() => {
                if (customToReplace.length) setConfirm(customToReplace.map((e) => e.name));
                else void apply(false);
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      </Popover>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm && confirm.length > 1 ? "These event types use custom hours." : "This event type uses custom hours."}
        description={
          confirm && confirm.length > 1
            ? `Replace the custom hours of ${confirm.join(", ")} with ${scheduleName}?`
            : `Replace them with ${scheduleName}?`
        }
        confirmLabel="Replace"
        onConfirm={async () => {
          await apply(true);
        }}
      />
    </>
  );
}
