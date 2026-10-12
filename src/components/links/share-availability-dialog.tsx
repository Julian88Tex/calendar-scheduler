// OWNER: links-sharing. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// ShareAvailabilityDialog (ARCHITECTURE section 25, SPEC OO-11: share availability by email). Foundation stub: a "Coming soon" dialog.
"use client";

import type { ContactPickerValue } from "../contacts/contact-picker";
import { Dialog } from "../ui/dialog";

export type ShareAvailabilityDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; eventTypeId?: string | null; singleUseLinkId?: string | null; contact?: ContactPickerValue | null };

export function ShareAvailabilityDialog({ open, onOpenChange }: ShareAvailabilityDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Share availability">
      <p className="text-body-md text-ink-2">Coming soon.</p>
    </Dialog>
  );
}
