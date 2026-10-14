// "Cancel event" (SPEC CR-06; walkthrough 10.3): the host's cancel modal of the Meetings page. The event summary (color
// dot, name, time in the host's zone, invitee), the optional "Add a cancellation message" textarea (up to 2,000
// characters, included in the invitees' cancellation email as "Reason: ..."), "Cancel" to dismiss and the red
// "Yes, cancel". Canceling cancels the whole meeting (every invitee of a group slot) and frees the slot; the emails go
// out right after. Client component.
"use client";

import { useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useMinuteClock } from "@/components/ui/use-minute-clock";
import { hostCancelMeetingAction } from "./actions";
import { MeetingBrief } from "./meeting-brief";
import { lt } from "./lib/t";
import type { HostMeetingSummary } from "./types";

const MAX_MESSAGE = 2000;

export type HostCancelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meeting: HostMeetingSummary;
  /** After the meeting was canceled (the dialog closes itself and shows "Event canceled"). */
  onCanceled?: (result: { canceledInviteeIds: string[] }) => void;
  /** Focus target on close when the opener is gone (a menu item). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** Business clock (ms) for the "already started" notice; default the browser clock. */
  now?: number;
};

export function HostCancelDialog({ open, onOpenChange, meeting, onCanceled, returnFocusRef, now }: HostCancelDialogProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const active = meeting.invitees.filter((i) => i.status === "active");
  const tick = useMinuteClock();
  const started = Date.parse(meeting.start) <= (now ?? tick ?? 0);

  const close = (v: boolean) => {
    if (busy) return;
    if (!v) {
      setError(null);
      setFormError(null);
    }
    onOpenChange(v);
  };

  const confirm = async () => {
    if (busy) return;
    const message = text.trim();
    if (message.length > MAX_MESSAGE) {
      setError(lt("errors.messageTooLong"));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const r = await hostCancelMeetingAction({ scheduledEventId: meeting.scheduledEventId, message: message || null });
      setBusy(false);
      if (!r.ok) {
        const field = r.error.fieldErrors?.message?.[0];
        if (field) setError(field);
        else setFormError(r.error.message);
        return;
      }
      toast.success(lt("host.cancel.done"));
      setText("");
      onOpenChange(false);
      onCanceled?.(r.data);
    } catch {
      setBusy(false);
      setFormError(lt("errors.network"));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={lt("host.cancel.title")}
      size="md"
      preventOutsideClose={text.trim().length > 0 || busy}
      returnFocusRef={returnFocusRef}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="secondary" disabled={busy}>
              {lt("host.cancel.dismiss")}
            </Button>
          </DialogClose>
          <Button variant="destructive" loading={busy} onClick={() => void confirm()} data-testid="host-cancel-confirm">
            {lt("host.cancel.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <MeetingBrief meeting={meeting} />
        {meeting.isGroup && active.length > 1 && <p className="text-body-md text-ink-2">{lt("host.cancel.groupNotice", { count: active.length })}</p>}
        {started && <p className="text-body-md text-ink-2">{lt("host.cancel.pastNotice")}</p>}
        {formError && (
          <p role="alert" className="rounded-[var(--radius-card)] border border-danger-soft bg-danger-soft px-3 py-2 text-[14px] font-semibold text-danger-text">
            {formError}
          </p>
        )}
        <FormField
          label={lt("host.cancel.messageLabel")}
          hint={active.length === 1 ? lt("host.cancel.messageHint", { name: active[0]!.name }) : lt("host.cancel.messageHintMany")}
          error={error}
        >
          {(c) => (
            <Textarea
              {...c}
              rows={4}
              maxLength={MAX_MESSAGE}
              showCount
              invalid={Boolean(error)}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (error) setError(null);
              }}
            />
          )}
        </FormField>
      </div>
    </Dialog>
  );
}
