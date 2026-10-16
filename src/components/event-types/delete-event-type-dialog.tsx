// DeleteEventTypeDialog (SPEC ET-12): "Delete event type?" with Calendly's body copy, "Cancel" and a red "Delete".
// Used by the Scheduling list kebab (event-types-list) and the editor header kebab. Soft deletes through
// deleteEventTypeAction (audited, GEN-17) and toasts on success. Client component.
"use client";

import { toast } from "@/components/ui/toast";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { deleteEventTypeAction } from "@/lib/event-types/actions";
import { DELETE_BODY, DELETE_TITLE } from "@/lib/event-types/constants";

export type DeleteEventTypeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventType: { id: string; name: string };
  /** Called after the event type was deleted (navigate away, refresh the list). */
  onDeleted?: (id: string) => void;
};

export function DeleteEventTypeDialog({ open, onOpenChange, eventType, onDeleted }: DeleteEventTypeDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={DELETE_TITLE}
      description={DELETE_BODY}
      confirmLabel="Delete"
      cancelLabel="Cancel"
      variant="destructive"
      onConfirm={async () => {
        const result = await deleteEventTypeAction({ id: eventType.id });
        if (!result.ok) throw new Error(result.error.message);
        toast.success(`${eventType.name} was deleted`);
        onDeleted?.(eventType.id);
      }}
    />
  );
}
