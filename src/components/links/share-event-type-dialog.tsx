// OWNER: links-sharing. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// ShareEventTypeDialog (ARCHITECTURE section 25, SPEC OO-10: the share modal (Copy link, Add times to email, Add to website)). Foundation stub: a "Coming soon" dialog.
"use client";

import { Dialog } from "../ui/dialog";

export type ShareEventTypeDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; eventTypeId: string };

export function ShareEventTypeDialog({ open, onOpenChange }: ShareEventTypeDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Share">
      <p className="text-body-md text-ink-2">Coming soon.</p>
    </Dialog>
  );
}
