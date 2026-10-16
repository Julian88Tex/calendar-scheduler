// "Mark as no-show" (SPEC CR-11): absent before the meeting's start time and for canceled invitees; after the start a
// secondary button opens "Mark {name} as a no-show?"; a marked invitee shows the "No-show" badge with "Undo". Marking
// fires invitee_no_show.created (the "No-show marked" workflow trigger) and undo fires invitee_no_show.deleted
// (lifecycle-core). Client component.
"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useMinuteClock } from "@/components/ui/use-minute-clock";
import { setNoShowAction } from "./actions";
import { lt } from "./lib/t";

export type MarkNoShowButtonProps = {
  inviteeId: string;
  inviteeName: string;
  /** Current mark (from the meeting data). */
  noShow: boolean;
  /** ISO start of the meeting: the control exists only once the meeting has started (CR-11). */
  meetingStart: string;
  /** Canceled invitees can't be marked. */
  canceled?: boolean;
  /** Business clock (ms); default the browser clock. */
  now?: number;
  onChange?: (noShow: boolean) => void;
  size?: "sm" | "md";
};

export function MarkNoShowButton({ inviteeId, inviteeName, noShow, meetingStart, canceled, now, onChange, size = "md" }: MarkNoShowButtonProps) {
  const [marked, setMarked] = useState(noShow);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastProp, setLastProp] = useState(noShow);
  const tick = useMinuteClock();
  if (noShow !== lastProp) {
    // A refreshed meeting row wins over the local state.
    setLastProp(noShow);
    setMarked(noShow);
  }
  const at = now ?? tick;
  if (canceled || at === null || Date.parse(meetingStart) > at) return null;

  const apply = async (value: boolean) => {
    const r = await setNoShowAction({ inviteeId, noShow: value });
    if (!r.ok) throw new Error(r.error.message);
    setMarked(value);
    onChange?.(value);
    toast.success(value ? lt("host.noShow.marked", { name: inviteeName }) : lt("host.noShow.unmarked"));
  };

  if (marked) {
    return (
      <span className="inline-flex items-center gap-2" data-testid="no-show-marked">
        <Badge variant="warning">{lt("host.noShow.badge")}</Badge>
        <Button
          variant="tertiary"
          size="sm"
          loading={busy}
          aria-label={lt("host.noShow.undoLabel", { name: inviteeName })}
          onClick={async () => {
            setBusy(true);
            try {
              await apply(false);
            } catch (e) {
              toast.error((e as Error).message || lt("errors.generic"));
            } finally {
              setBusy(false);
            }
          }}
        >
          {lt("host.noShow.undo")}
        </Button>
      </span>
    );
  }

  return (
    <>
      <Button variant="secondary" size={size} onClick={() => setConfirming(true)} data-testid="mark-no-show">
        {lt("host.noShow.mark")}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={lt("host.noShow.confirmTitle", { name: inviteeName })}
        description={lt("host.noShow.confirmBody")}
        confirmLabel={lt("host.noShow.confirm")}
        cancelLabel={lt("host.noShow.dismiss")}
        onConfirm={() => apply(true)}
      />
    </>
  );
}
