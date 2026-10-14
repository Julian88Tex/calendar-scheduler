// "Reschedule" from the Meetings page (SPEC CR-07, CR-08; walkthrough 10.3): a choice between "Reschedule meeting now"
// (the host picks a new time from the event's availability, with the invitee's or the host's time zone and, for
// single-host events, "Override available times"; the invitee gets one reschedule email) and "Share new times to
// meet" (cancels the meeting and emails the invitee "{Host} would like to reschedule" with a "Pick a new time" link,
// an optional message and an optional reminder after 1, 3 or 7 days). One-off and poll meetings can't be rescheduled
// (the dialog says so); "Share new times to meet" needs a meeting that has not started and a bookable event type.
// Client component.
"use client";

import { useRef, useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { useMinuteClock } from "@/components/ui/use-minute-clock";
import lifecycleMessages from "@/lib/i18n/messages/en/lifecycle";
import { hostRequestRescheduleAction, hostRescheduleNowAction } from "./actions";
import { HostTimePicker, pickText, type HostPick } from "./host-time-picker";
import { MeetingBrief, meetingWhen } from "./meeting-brief";
import { lt } from "./lib/t";
import type { HostMeetingSummary } from "./types";

const MAX_MESSAGE = 2000;

export type RescheduleStep = "choice" | "now" | "share";

export type RescheduleChoiceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meeting: HostMeetingSummary;
  /** The invitee to reschedule (default: the first active invitee). */
  inviteeId?: string;
  /** After "Reschedule": the new booking. */
  onRescheduled?: (result: { inviteeId: string; scheduledEventId: string }) => void;
  /** After "Send request". */
  onRequested?: (result: { inviteeId: string }) => void;
  /** Default "choice". */
  initialStep?: RescheduleStep;
  /** Business clock (ms); default the browser clock. */
  now?: number;
  returnFocusRef?: React.RefObject<HTMLElement | null>;
};

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

export function RescheduleChoiceDialog({ open, onOpenChange, meeting, inviteeId, onRescheduled, onRequested, initialStep = "choice", now, returnFocusRef }: RescheduleChoiceDialogProps) {
  const tick = useMinuteClock();
  const clock = now ?? tick ?? 0;
  const invitee = meeting.invitees.find((i) => i.id === inviteeId) ?? meeting.invitees.find((i) => i.status === "active") ?? null;
  const reschedulable = meeting.status === "active" && meeting.source !== "one_off" && meeting.source !== "poll" && invitee?.status === "active";
  const started = Date.parse(meeting.start) <= clock;
  const shareAllowed = !started && meeting.eventTypeBookable;
  const allowOverride = meeting.hostCount <= 1;

  const [step, setStep] = useState<RescheduleStep>(initialStep);
  const [choice, setChoice] = useState<"now" | "share">(initialStep === "share" && shareAllowed ? "share" : "now");
  const [pick, setPick] = useState<HostPick | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [message, setMessage] = useState("");
  const [reminder, setReminder] = useState<"" | "1" | "3" | "7">("");
  const [error, setError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);

  const reset = () => {
    setStep(initialStep);
    setChoice(initialStep === "share" && shareAllowed ? "share" : "now");
    setPick(null);
    setMessage("");
    setReminder("");
    setError(null);
    setMessageError(null);
    requestId.current = null;
  };
  const close = (v: boolean) => {
    if (busy) return;
    if (!v) reset();
    onOpenChange(v);
  };

  const name = invitee?.name ?? "";
  const pickedText = pickText(pick, meeting);

  const rescheduleNow = async () => {
    if (!invitee || busy) return;
    if (!pick || (pick.kind === "override" && (!pick.date || pick.minutes === null))) {
      setError(pick?.kind === "override" ? lt("host.reschedule.overrideMissing") : lt("host.reschedule.chooseTime"));
      return;
    }
    setBusy(true);
    setError(null);
    requestId.current ??= newRequestId();
    try {
      const input =
        pick.kind === "slot"
          ? { inviteeId: invitee.id, start: pick.start, override: false, clientRequestId: requestId.current }
          : { inviteeId: invitee.id, date: pick.date!, minutes: pick.minutes!, zone: pick.zone, override: true, clientRequestId: requestId.current };
      const r = await hostRescheduleNowAction(input);
      setBusy(false);
      if (!r.ok) {
        setError(r.error.message);
        requestId.current = null;
        if (r.error.code === "conflict" && pick.kind === "slot") {
          setPick(null);
          setReloadKey((k) => k + 1);
        }
        return;
      }
      toast.success(lt("host.reschedule.rescheduled"));
      reset();
      onOpenChange(false);
      onRescheduled?.(r.data);
    } catch {
      setBusy(false);
      requestId.current = null;
      setError(lt("errors.network"));
    }
  };

  const share = async () => {
    if (!invitee || busy) return;
    const text = message.trim();
    if (text.length > MAX_MESSAGE) {
      setMessageError(lt("errors.messageTooLong"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await hostRequestRescheduleAction({ inviteeId: invitee.id, message: text || null, reminderDays: reminder ? (Number(reminder) as 1 | 3 | 7) : null });
      setBusy(false);
      if (!r.ok) {
        const field = r.error.fieldErrors?.message?.[0];
        if (field) setMessageError(field);
        else setError(r.error.message);
        return;
      }
      toast.success(lt("host.reschedule.shared", { name }));
      reset();
      onOpenChange(false);
      onRequested?.(r.data);
    } catch {
      setBusy(false);
      setError(lt("errors.network"));
    }
  };

  const alert = error && (
    <p role="alert" className="rounded-[var(--radius-card)] border border-danger-soft bg-danger-soft px-3 py-2 text-[14px] font-semibold text-danger-text">
      {error}
    </p>
  );
  const dismiss = (
    <DialogClose asChild>
      <Button variant="secondary" disabled={busy}>
        {lt("host.reschedule.dismiss")}
      </Button>
    </DialogClose>
  );
  const back = (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={() => {
        setStep("choice");
        setError(null);
      }}
    >
      {lt("host.reschedule.back")}
    </Button>
  );

  let title = lt("host.reschedule.title");
  let body: React.ReactNode;
  let footer: React.ReactNode;
  if (!reschedulable || !invitee) {
    body = (
      <div className="flex flex-col gap-4">
        <MeetingBrief meeting={meeting} />
        <p className="text-body-md text-ink-2">{meeting.status === "active" ? lt("host.reschedule.notReschedulable") : lt("reschedule.blockedBody.canceled")}</p>
      </div>
    );
    footer = dismiss;
  } else if (step === "now") {
    title = lt("host.reschedule.pickTitle");
    body = (
      <div className="flex flex-col gap-4">
        <p className="text-body-md text-ink-2">{lt("host.reschedule.pickIntro", { eventName: meeting.eventName, name })}</p>
        {alert}
        <HostTimePicker meeting={meeting} invitee={invitee} allowOverride={allowOverride} now={clock} value={pick} onChange={(p) => {
            setPick(p);
            setError(null);
          }} reloadKey={reloadKey} />
        <p className="text-[14px] font-semibold text-ink" aria-live="polite" data-testid="new-time">
          {pickedText ? lt("host.reschedule.newTime", { when: pickedText }) : null}
        </p>
      </div>
    );
    footer = (
      <>
        {initialStep === "choice" ? back : dismiss}
        <Button loading={busy} disabled={!pickedText} onClick={() => void rescheduleNow()} data-testid="host-reschedule-submit">
          {lt("host.reschedule.submitNow")}
        </Button>
      </>
    );
  } else if (step === "share") {
    title = lt("host.reschedule.shareTitle");
    body = (
      <div className="flex flex-col gap-4">
        <p className="text-body-md text-ink-2">{lt("host.reschedule.shareIntro", { when: meetingWhen(meeting), name })}</p>
        {alert}
        <FormField label={lt("host.reschedule.messageLabel", { name })} error={messageError}>
          {(c) => (
            <Textarea
              {...c}
              rows={4}
              maxLength={MAX_MESSAGE}
              showCount
              invalid={Boolean(messageError)}
              placeholder={lt("host.reschedule.messagePlaceholder", { name })}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                if (messageError) setMessageError(null);
              }}
            />
          )}
        </FormField>
        <FormField label={lt("host.reschedule.reminderLabel")}>
          {(c) => (
            <NativeSelect
              {...c}
              value={reminder}
              onChange={(e) => setReminder(e.target.value as "" | "1" | "3" | "7")}
              options={[
                { value: "", label: lt("host.reschedule.reminderNone") },
                { value: "1", label: lt("host.reschedule.reminderDays1") },
                { value: "3", label: lt("host.reschedule.reminderDays3") },
                { value: "7", label: lt("host.reschedule.reminderDays7") },
              ]}
            />
          )}
        </FormField>
      </div>
    );
    footer = (
      <>
        {initialStep === "choice" ? back : dismiss}
        <Button loading={busy} onClick={() => void share()} data-testid="host-share-submit">
          {lt("host.reschedule.submitShare")}
        </Button>
      </>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <MeetingBrief meeting={meeting} />
        <RadioGroup
          variant="cards"
          aria-label={lt("host.reschedule.choiceLabel")}
          value={choice}
          onValueChange={(v) => setChoice(v === "share" ? "share" : "now")}
          options={[
            { value: "now", label: lt("host.reschedule.nowLabel"), description: lt("host.reschedule.nowDescription", { name }) },
            {
              value: "share",
              label: lt("host.reschedule.shareLabel"),
              description: shareAllowed ? lt("host.reschedule.shareDescription", { name }) : started ? lt("host.reschedule.sharePast") : lifecycleMessages.errors.requestEventTypeOff,
              disabled: !shareAllowed,
            },
          ]}
        />
      </div>
    );
    footer = (
      <>
        {dismiss}
        <Button
          onClick={() => {
            setStep(choice === "share" && shareAllowed ? "share" : "now");
            setError(null);
          }}
          data-testid="host-reschedule-next"
        >
          {lt("host.reschedule.next")}
        </Button>
      </>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      title={title}
      size={step === "now" && reschedulable ? "lg" : "md"}
      preventOutsideClose={busy || message.trim().length > 0 || pick !== null}
      returnFocusRef={returnFocusRef}
      footer={footer}
    >
      {body}
    </Dialog>
  );
}
