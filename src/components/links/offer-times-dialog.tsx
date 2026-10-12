// OWNER: links-sharing. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// OfferTimesDialog (ARCHITECTURE section 25, SPEC OO-10: offered time slots as rich HTML for an email). Foundation stub: a "Coming soon" dialog.
"use client";

import { Dialog } from "../ui/dialog";

export type OfferTimesDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; eventTypeId: string };

export function OfferTimesDialog({ open, onOpenChange }: OfferTimesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Offer time slots">
      <p className="text-body-md text-ink-2">Coming soon.</p>
    </Dialog>
  );
}
