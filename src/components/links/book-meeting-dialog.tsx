// OWNER: links-sharing. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// BookMeetingDialog (ARCHITECTURE section 25, SPEC OO-13: book a meeting on behalf of an invitee). Foundation stub: a "Coming soon" dialog.
"use client";

import type { ContactPickerValue } from "../contacts/contact-picker";
import { Dialog } from "../ui/dialog";

export type BookMeetingDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; eventTypeId?: string | null; contact?: ContactPickerValue | null };

export function BookMeetingDialog({ open, onOpenChange }: BookMeetingDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Book meeting">
      <p className="text-body-md text-ink-2">Coming soon.</p>
    </Dialog>
  );
}
