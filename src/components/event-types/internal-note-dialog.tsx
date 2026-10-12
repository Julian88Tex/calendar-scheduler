// InternalNoteDialog (SPEC ET-13): "Add internal note" / "Edit internal note" with a textarea of up to 2,000
// characters, visible only to hosts and admins (never on public pages or in invitee emails). With an eventTypeId the
// note is saved at once (saveInternalNoteAction); without one (a new, unsaved event type) the note is handed to
// onApply and saved with the event type. Used by the Scheduling list and the editor header kebab. Client component.
"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { saveInternalNoteAction } from "@/lib/event-types/actions";
import { INTERNAL_NOTE_MAX } from "@/lib/event-types/constants";

export type InternalNoteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null for an unsaved event type (onApply receives the note). */
  eventTypeId: string | null;
  note: string | null;
  /** After a save: the stored note (null when cleared) and the event type's new version. */
  onSaved?: (note: string | null, version: string) => void;
  onApply?: (note: string) => void;
};

export function InternalNoteDialog(props: InternalNoteDialogProps) {
  // Remount on open so the textarea starts from the current note.
  return props.open ? <NoteDialogBody {...props} /> : null;
}

function NoteDialogBody({ open, onOpenChange, eventTypeId, note, onSaved, onApply }: InternalNoteDialogProps) {
  const [value, setValue] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = `note-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const editing = Boolean(note);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (value.length > INTERNAL_NOTE_MAX) {
      setError(`Use ${INTERNAL_NOTE_MAX.toLocaleString("en-US")} characters or fewer.`);
      return;
    }
    if (!eventTypeId) {
      onApply?.(value.trim());
      onOpenChange(false);
      return;
    }
    setBusy(true);
    const result = await saveInternalNoteAction({ id: eventTypeId, note: value });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.fieldErrors?.note?.[0] ?? result.error.message);
      return;
    }
    toast.success(result.data.note ? "Internal note saved" : "Internal note removed");
    onSaved?.(result.data.note, result.data.version);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title={editing ? "Edit internal note" : "Add internal note"}
      description="Only hosts and admins see this note. It never appears on your booking page or in emails to invitees."
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <FormField label="Internal note" hideLabel error={error}>
          {(c) => (
            <Textarea
              {...c}
              rows={5}
              autoResize
              showCount
              maxLength={INTERNAL_NOTE_MAX}
              value={value}
              invalid={Boolean(error)}
              placeholder="Add a note for yourself and other hosts"
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
            />
          )}
        </FormField>
      </form>
    </Dialog>
  );
}
