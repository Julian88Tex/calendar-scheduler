// The kebab menu of a meeting poll (SPEC MP-16 header actions, MP-26 card actions): Edit, Invite people, Close voting /
// Reopen voting / Reopen poll, Duplicate, Export CSV and Delete poll (creator and org admins only), with their dialogs.
// Used by the Meeting polls list cards and the results page header. Client component.
"use client";

import { CalendarClock, Copy, Download, Lock, MoreVertical, Pencil, Trash2, UserPlus } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { toast } from "@/components/ui/toast";
import { duplicatePollAction } from "@/lib/polls/actions";
import type { PollStatus } from "@/lib/polls/types";
import { failureMessage, unwrap } from "./lib/action";
import { pt } from "./lib/t";
import { InviteDialog } from "./dialogs/invite-dialog";
import { CloseVotingDialog, DeleteDialog, ReopenDialog } from "./dialogs/manage-dialogs";

export type PollMenuPoll = {
  id: string;
  title: string;
  status: PollStatus;
  canDelete: boolean;
  respondents: number;
  deadline: string | null;
  /** The scheduled meeting (booked, or kept by a reopened poll). */
  meeting: { start: string; end: string | null; status: "active" | "canceled" } | null;
};

export type PollMenuProps = {
  poll: PollMenuPoll;
  zone: string;
  hour12: boolean;
  hostName: string;
  /** Items shown as separate buttons elsewhere (results header). */
  hide?: { edit?: boolean; invite?: boolean; lifecycle?: boolean };
  onChanged: () => void;
  onDeleted?: () => void;
};

type Open = "invite" | "close" | "reopen_voting" | "reopen_poll" | "delete" | null;

export function PollMenu({ poll, zone, hour12, hostName, hide = {}, onChanged, onDeleted }: PollMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [duplicating, setDuplicating] = useState(false);
  const active = poll.status === "open" || poll.status === "closed";
  const editable = active || poll.status === "booked" || poll.status === "expired";

  const duplicate = async () => {
    if (duplicating) return;
    setDuplicating(true);
    try {
      const out = await unwrap(duplicatePollAction({ pollId: poll.id }));
      toast.success(pt("list.duplicatedToast"));
      router.push(`/app/polls/${out.pollId}/edit` as Route);
    } catch (e) {
      toast.error(failureMessage(e));
    } finally {
      setDuplicating(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label={pt("list.actionsFor", { title: poll.title })} className="max-sm:size-10" loading={duplicating} data-testid="poll-menu">
            <MoreVertical aria-hidden="true" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[220px]">
          {!hide.edit && editable && (
            <DropdownMenuItem icon={<Pencil />} href={`/app/polls/${poll.id}/edit` as Route}>
              {pt("list.edit")}
            </DropdownMenuItem>
          )}
          {!hide.invite && active && (
            <DropdownMenuItem icon={<UserPlus />} onSelect={() => setOpen("invite")}>
              {pt("list.invite")}
            </DropdownMenuItem>
          )}
          {!hide.lifecycle && poll.status === "open" && (
            <DropdownMenuItem icon={<Lock />} onSelect={() => setOpen("close")}>
              {pt("list.closeVoting")}
            </DropdownMenuItem>
          )}
          {!hide.lifecycle && poll.status === "closed" && (
            <DropdownMenuItem icon={<CalendarClock />} onSelect={() => setOpen("reopen_voting")}>
              {pt("list.reopenVoting")}
            </DropdownMenuItem>
          )}
          {!hide.lifecycle && poll.status === "booked" && (
            <DropdownMenuItem icon={<CalendarClock />} onSelect={() => setOpen("reopen_poll")}>
              {pt("results.reopenPoll")}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem icon={<Copy />} onSelect={() => void duplicate()}>
            {pt("list.duplicate")}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/api/polls/${poll.id}/export.csv`} download>
              <span className="inline-flex text-ink-2">
                <Download aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">{pt("list.exportCsv")}</span>
            </a>
          </DropdownMenuItem>
          {poll.canDelete && poll.status !== "canceled" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Trash2 />} destructive onSelect={() => setOpen("delete")}>
                {pt("list.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <PollDialogs poll={poll} open={open} setOpen={setOpen} zone={zone} hour12={hour12} hostName={hostName} onChanged={onChanged} onDeleted={onDeleted} />
    </>
  );
}

/** The dialogs of PollMenu, also opened by the results page buttons. */
export function PollDialogs({
  poll,
  open,
  setOpen,
  zone,
  hour12,
  hostName,
  onChanged,
  onDeleted,
}: {
  poll: PollMenuPoll;
  open: Open;
  setOpen: (o: Open) => void;
  zone: string;
  hour12: boolean;
  hostName: string;
  onChanged: () => void;
  onDeleted?: () => void;
}) {
  const close = (v: boolean) => !v && setOpen(null);
  const meeting = poll.meeting ? { start: poll.meeting.start, end: poll.meeting.end, active: poll.meeting.status === "active" } : null;
  return (
    <>
      {open === "invite" && <InviteDialog open onOpenChange={close} pollId={poll.id} pollTitle={poll.title} hostName={hostName} onSent={onChanged} />}
      {open === "close" && <CloseVotingDialog open onOpenChange={close} pollId={poll.id} onDone={onChanged} />}
      {(open === "reopen_voting" || open === "reopen_poll") && (
        <ReopenDialog
          open
          onOpenChange={close}
          mode={open === "reopen_poll" ? "poll" : "voting"}
          pollId={poll.id}
          deadline={poll.deadline}
          zone={zone}
          hour12={hour12}
          meeting={poll.meeting ? { start: poll.meeting.start, end: poll.meeting.end } : null}
          respondents={poll.respondents}
          onDone={onChanged}
        />
      )}
      {open === "delete" && (
        <DeleteDialog
          open
          onOpenChange={close}
          pollId={poll.id}
          respondents={poll.respondents}
          meeting={meeting}
          booked={poll.status === "booked"}
          zone={zone}
          hour12={hour12}
          onDone={onDeleted ?? onChanged}
        />
      )}
    </>
  );
}

export type PollDialogName = Open;
