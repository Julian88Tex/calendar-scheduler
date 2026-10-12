// Share modal of an event type card (SPEC ET-04 share icon, walkthrough 5.3, narrowed by docs/SCOPE.md to the "Copy
// link" part: no single-use links, emailed times or embeds): "Share {Event name}", the booking link in a read-only
// field (selected on focus) and a "Copy link" button, with a note when the event type is secret or turned off.
// Client component.
"use client";

import { useId } from "react";
import type * as React from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog } from "@/components/ui/dialog";

export type ShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventType: { name: string; publicUrl: string; secret: boolean; active: boolean } | null;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
};

export function ShareDialog({ open, onOpenChange, eventType, returnFocusRef }: ShareDialogProps) {
  const inputId = `share-link-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (!eventType) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Share ${eventType.name}`}
      description="Send this link to invitees so they can pick a time."
      returnFocusRef={returnFocusRef}
      footer={
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {!eventType.active && (
          <Banner variant="warning" role="none">This event type is turned off. Invitees can&apos;t book it until you turn it on.</Banner>
        )}
        {eventType.active && eventType.secret && (
          <Banner variant="info" role="none">This event type is secret: it isn&apos;t listed on your landing page, so only people with this link can book it.</Banner>
        )}
        <div className="flex flex-col gap-2">
          <label htmlFor={inputId} className="text-label text-ink">
            Booking link
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id={inputId}
              readOnly
              value={eventType.publicUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="h-10 min-w-0 flex-1 rounded-[var(--radius-input)] border border-line bg-cloud px-3 text-[14px] text-ink outline-none focus:border-primary focus:outline-2 focus:outline-offset-1 focus:outline-focus"
            />
            <CopyButton value={eventType.publicUrl} variant="primary" />
          </div>
        </div>
      </div>
    </Dialog>
  );
}
