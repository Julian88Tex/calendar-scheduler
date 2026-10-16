// Schedule dialogs (SPEC AV-02): "New schedule" ("Schedule name", Cancel / Create), "Rename schedule" and the delete
// confirmation that asks which schedule the event types using it should switch to (default: the default schedule).
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { scheduleLabel } from "@/components/availability/schedule-select";
import type { ScheduleSummary } from "@/lib/availability/types";
import { SCHEDULE_NAME_MAX } from "@/lib/availability/schemas";

type NameDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  initialName?: string;
  /** Resolves with a field error message, or null on success. */
  onSubmit: (name: string) => Promise<string | null>;
};

function NameDialog({ open, onOpenChange, title, submitLabel, initialName = "", onSubmit }: NameDialogProps) {
  return open ? <OpenNameDialog open onOpenChange={onOpenChange} title={title} submitLabel={submitLabel} initialName={initialName} onSubmit={onSubmit} /> : null;
}

function OpenNameDialog({ onOpenChange, title, submitLabel, initialName = "", onSubmit }: NameDialogProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formId = `schedule-name-${title.replace(/\W+/g, "-").toLowerCase()}`;

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return setError("Enter a schedule name.");
    if (trimmed.length > SCHEDULE_NAME_MAX) return setError(`Use ${SCHEDULE_NAME_MAX} characters or fewer.`);
    setBusy(true);
    try {
      const message = await onSubmit(trimmed);
      if (message) setError(message);
      else onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !busy && onOpenChange(v)}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <FormField label="Schedule name" error={error} required>
          {(control) => (
            <Input
              {...control}
              value={name}
              autoFocus
              maxLength={SCHEDULE_NAME_MAX}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Working hours, exclusions, etc..."
            />
          )}
        </FormField>
      </form>
    </Dialog>
  );
}

export function CreateScheduleDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; onCreate: (name: string) => Promise<string | null> }) {
  return <NameDialog open={props.open} onOpenChange={props.onOpenChange} title="New schedule" submitLabel="Create" onSubmit={props.onCreate} />;
}

export function RenameScheduleDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  onRename: (name: string) => Promise<string | null>;
}) {
  return (
    <NameDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Rename schedule"
      submitLabel="Save"
      initialName={props.currentName}
      onSubmit={props.onRename}
    />
  );
}

export function DeleteScheduleDialog({
  open,
  onOpenChange,
  schedule,
  others,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schedule: ScheduleSummary;
  /** The other schedules (replacement choices). */
  others: ScheduleSummary[];
  onDelete: (replacementId: string | null) => Promise<boolean>;
}) {
  const fallback = others.find((s) => s.isDefault) ?? others[0] ?? null;
  const [replacement, setReplacement] = useState<string | null>(fallback?.id ?? null);
  const [busy, setBusy] = useState(false);
  const inUse = schedule.eventTypeCount;
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        if (v) setReplacement(fallback?.id ?? null);
        onOpenChange(v);
      }}
      title="Delete schedule?"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                if (await onDelete(inUse > 0 ? replacement : null)) onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-body-md text-ink">
        <p>
          <span className="font-semibold">{schedule.name}</span> and its date-specific hours will be deleted.
        </p>
        {inUse > 0 && fallback && (
          <FormField
            label={`${inUse === 1 ? "1 event type uses" : `${inUse} event types use`} this schedule. Choose the schedule ${inUse === 1 ? "it" : "they"} should use instead:`}
          >
            {(control) => (
              <Select
                id={control.id}
                aria-describedby={control["aria-describedby"]}
                value={replacement ?? fallback.id}
                onValueChange={setReplacement}
                options={others.map((s) => ({ value: s.id, label: scheduleLabel(s), textValue: scheduleLabel(s) }))}
              />
            )}
          </FormField>
        )}
      </div>
    </Dialog>
  );
}
