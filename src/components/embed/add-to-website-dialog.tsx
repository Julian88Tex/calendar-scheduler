// OWNER: webhooks-embed. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// AddToWebsiteDialog (SPEC API-14): inline, popup widget and popup text embed codes for an event type, landing page,
// team page or routing form. Foundation stub: a dialog with the plain link.
"use client";

import { CopyButton } from "../ui/copy-button";
import { Dialog } from "../ui/dialog";

export type AddToWebsiteTarget = {
  kind: "event_type" | "landing_page" | "team_page" | "routing_form";
  /** Absolute public URL. */
  url: string;
  name: string;
};

export type AddToWebsiteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: AddToWebsiteTarget;
};

export function AddToWebsiteDialog({ open, onOpenChange, target }: AddToWebsiteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add to website" description={target.name}>
      <p className="mb-3 break-all text-body-md">{target.url}</p>
      <CopyButton value={target.url} />
    </Dialog>
  );
}
