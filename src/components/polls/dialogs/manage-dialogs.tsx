// Lifecycle dialogs of a meeting poll (SPEC MP-21, MP-22; research B8, B9): "Close voting" confirmation, "Reopen voting"
// (a passed deadline must be moved or removed first) and "Reopen poll" after booking (the meeting stays until the host
// books again; optional email to respondents), and "Delete poll" ("The link will stop working.", notify voters, and for
// a scheduled meeting "Keep the scheduled meeting" or "Cancel it too"). Client components.
"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/form-field";
import { RadioGroup } from "@/components/ui/radio-group";
import { TimeInput } from "@/components/ui/time-input";
import { toast } from "@/components/ui/toast";
import { closeVotingAction, deletePollAction, reopenPollAction, reopenVotingAction } from "@/lib/polls/actions";
import { formatDateLong, formatTimeRange } from "@/lib/time/format";
import { localDateOf, wallClockToUtc } from "@/lib/time/luxon";
import { failureMessage, fieldErrorsOf, unwrap } from "../lib/action";
import { pt } from "../lib/t";

export function meetingWhen(start: string, end: string | null, zone: string, hour12: boolean): string {
  const date = formatDateLong(start, zone);
  return end ? `${date}, ${formatTimeRange(start, end, zone, "en", hour12)}` : date;
}

export function CloseVotingDialog({ open, onOpenChange, pollId, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; pollId: string; onDone: () => void }) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={pt("results.closeVotingTitle")}
      description={pt("results.closeVotingBody")}
      confirmLabel={pt("results.closeVoting")}
      onConfirm={async () => {
        await unwrap(closeVotingAction({ pollId }));
        toast.success(pt("list.votingClosedToast"));
        onDone();
      }}
    />
  );
}

export type ReopenDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "voting" | "poll";
  pollId: string;
  deadline: string | null;
  zone: string;
  hour12: boolean;
  /** "Reopen poll": the meeting that stays scheduled. */
  meeting: { start: string; end: string | null } | null;
  respondents: number;
  onDone: () => void;
};

export function ReopenDialog(p: ReopenDialogProps) {
  const [now] = useState(() => Date.now());
  const passed = Boolean(p.deadline && new Date(p.deadline).getTime() <= now);
  const [choice, setChoice] = useState<"keep" | "new" | "remove">(passed ? "new" : "keep");
  const [date, setDate] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<number | null>(17 * 60);
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = localDateOf(new Date(), p.zone);

  const submit = async () => {
    setError(null);
    let deadline: string | null | undefined;
    if (!p.deadline || choice === "keep") deadline = undefined;
    else if (choice === "remove") deadline = null;
    else {
      if (!date || minutes === null) {
        setError(pt("results.deadlinePassed"));
        return;
      }
      deadline = wallClockToUtc(date, minutes, p.zone).toISOString();
    }
    setBusy(true);
    try {
      const input = { pollId: p.pollId, deadline, notify: p.mode === "poll" && notify };
      await unwrap(p.mode === "poll" ? reopenPollAction(input) : reopenVotingAction(input));
      toast.success(pt("list.votingReopenedToast"));
      p.onOpenChange(false);
      p.onDone();
    } catch (e) {
      setError(fieldErrorsOf(e).deadline?.[0] ?? failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const options = [
    ...(p.deadline && !passed ? [{ value: "keep", label: pt("results.keepDeadline") }] : []),
    { value: "new", label: pt("results.newDeadline") },
    ...(p.deadline ? [{ value: "remove", label: pt("results.removeDeadline") }] : []),
  ];

  return (
    <Dialog
      open={p.open}
      onOpenChange={(v) => !busy && p.onOpenChange(v)}
      title={p.mode === "poll" ? pt("results.reopenPollTitle") : pt("results.reopenVotingTitle")}
      description={
        p.mode === "poll" && p.meeting ? pt("results.reopenPollBody", { when: meetingWhen(p.meeting.start, p.meeting.end, p.zone, p.hour12) }) : pt("results.reopenVotingBody")
      }
      footer={
        <>
          <Button variant="secondary" onClick={() => p.onOpenChange(false)} disabled={busy}>
            {pt("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {pt("results.reopen")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {passed && <p className="text-body-md text-warning-text">{pt("results.deadlinePassed")}</p>}
        {p.deadline && <RadioGroup aria-label={pt("details.deadline")} value={choice} onValueChange={(v) => setChoice(v as typeof choice)} options={options} />}
        {choice === "new" && p.deadline ? (
          <div className="flex flex-wrap gap-3">
            <DatePicker value={date} onChange={setDate} min={today} aria-label={pt("details.deadlineDate")} />
            <TimeInput value={minutes} onChange={setMinutes} hour12={p.hour12} aria-label={pt("details.deadlineTime")} />
          </div>
        ) : null}
        {p.mode === "poll" && p.respondents > 0 && <Checkbox label={pt("results.reopenNotify")} checked={notify} onCheckedChange={setNotify} />}
        {error && <FieldError error={error} />}
      </div>
    </Dialog>
  );
}

export type DeleteDialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pollId: string;
  respondents: number;
  /** The scheduled meeting of the poll (booked, or kept by a reopened poll). */
  meeting: { start: string; end: string | null; active: boolean } | null;
  booked: boolean;
  zone: string;
  hour12: boolean;
  onDone: () => void;
};

export function DeleteDialog(p: DeleteDialogProps) {
  const [notify, setNotify] = useState(true);
  const [cancelMeeting, setCancelMeeting] = useState(false);
  const activeMeeting = p.meeting?.active ? p.meeting : null;
  return (
    <ConfirmDialog
      open={p.open}
      onOpenChange={p.onOpenChange}
      title={pt("results.deleteTitle")}
      description={pt("results.deleteBody")}
      confirmLabel={pt("results.deleteConfirm")}
      variant="destructive"
      onConfirm={async () => {
        await unwrap(deletePollAction({ pollId: p.pollId, notify: p.respondents > 0 && !p.booked ? notify : false, cancelMeeting: Boolean(activeMeeting) && cancelMeeting }));
        toast.success(pt("list.deletedToast"));
        p.onDone();
      }}
    >
      <div className="flex flex-col gap-3">
        {activeMeeting && p.booked && (
          <>
            <p className="text-body-md text-ink">{pt("results.deleteMeetingQuestion", { when: meetingWhen(activeMeeting.start, activeMeeting.end, p.zone, p.hour12) })}</p>
            <RadioGroup
              aria-label={pt("results.deleteMeetingQuestion", { when: "" })}
              value={cancelMeeting ? "cancel" : "keep"}
              onValueChange={(v) => setCancelMeeting(v === "cancel")}
              options={[
                { value: "keep", label: pt("results.deleteKeepMeeting") },
                { value: "cancel", label: pt("results.deleteCancelMeeting") },
              ]}
            />
          </>
        )}
        {activeMeeting && !p.booked && (
          <Checkbox label={pt("results.deleteReopenedQuestion", { when: meetingWhen(activeMeeting.start, activeMeeting.end, p.zone, p.hour12) })} checked={cancelMeeting} onCheckedChange={setCancelMeeting} />
        )}
        {p.respondents > 0 && !p.booked && (
          <Checkbox label={p.respondents === 1 ? pt("results.deleteNotifyOne") : pt("results.deleteNotify", { count: p.respondents })} checked={notify} onCheckedChange={setNotify} />
        )}
      </div>
    </ConfirmDialog>
  );
}
