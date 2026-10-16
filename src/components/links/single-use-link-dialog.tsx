// OWNER: links-sharing. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// SingleUseLinkDialog (ARCHITECTURE section 25, SPEC OO-01, OO-02: single-use links with an optional contact and customization). Foundation stub: a "Coming soon" dialog.
"use client";

import { Dialog } from "../ui/dialog";

export type SingleUseLinkDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; eventTypeId: string };

export function SingleUseLinkDialog({ open, onOpenChange }: SingleUseLinkDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Create single-use link">
      <p className="text-body-md text-ink-2">Coming soon.</p>
    </Dialog>
  );
}
