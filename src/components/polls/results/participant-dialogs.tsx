// Host-side participant dialogs of the results grid (SPEC MP-17): "Add participant (vote on behalf)" (name required,
// email optional, required flag, answers), "Edit votes" on behalf of a participant (they are emailed unless unchecked)
// and "Remove" (their answers are deleted; they are emailed unless unchecked). Client components.
"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { toast } from "@/components/ui/toast";
import { addParticipantAction, removeParticipantAction, setParticipantVotesAction } from "@/lib/polls/actions";
import { MAX_EMAIL_LENGTH, MAX_NAME_LENGTH } from "@/lib/polls/constants";
import { groupOptionsByLocalDate, optionTimeLabel } from "@/lib/polls/display";
import type { HostParticipantView, RankedOptionView, VoteChoice } from "@/lib/polls/types";
import { looksLikeEmail } from "@/lib/polls/validation";
import { failureMessage, fieldErrorsOf, unwrap } from "../lib/action";
import { futureVotes } from "../lib/answers";
import { pt } from "../lib/t";

export function VotesEditor({
  options,
  zone,
  pollZone,
  hour12,
  allowIfNeedBe,
  value,
  onChange,
}: {
  options: RankedOptionView[];
  zone: string;
  pollZone: string;
  hour12: boolean;
  allowIfNeedBe: boolean;
  value: Record<string, VoteChoice>;
  onChange: (v: Record<string, VoteChoice>) => void;
}) {
  const future = options.filter((o) => !o.isPast);
  const groups = groupOptionsByLocalDate(future, zone, pollZone);
  const choices = (allowIfNeedBe ? ["yes", "if_need_be", "no"] : ["yes", "no"]) as VoteChoice[];
  return (
    <div className="flex max-h-[44vh] flex-col gap-3 overflow-y-auto pr-1 scrollbar-thin">
      {groups.map((g) => (
        <div key={g.date}>
          <p className="mb-1 text-label-sm text-ink-2">{g.label}</p>
          <ul className="flex flex-col gap-1.5">
            {g.options.map((o) => {
              const time = optionTimeLabel(o, zone, { hour12 });
              return (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-body-md text-ink">{time}</span>
                  <SegmentedControl
                    size="sm"
                    aria-label={`${g.label}, ${time}`}
                    value={value[o.id] ?? "no"}
                    onValueChange={(c) => onChange({ ...value, [o.id]: c })}
                    options={choices.map((c) => ({ value: c, label: c === "yes" ? pt("common.yes") : c === "if_need_be" ? pt("common.ifNeedBe") : pt("common.no") }))}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

type Common = { pollId: string; options: RankedOptionView[]; zone: string; pollZone: string; hour12: boolean; allowIfNeedBe: boolean; onDone: () => void };

export function AddParticipantDialog(p: Common & { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [required, setRequired] = useState(false);
  const [notify, setNotify] = useState(true);
  const [votes, setVotes] = useState<Record<string, VoteChoice>>({});
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = pt("common.nameRequired");
    if (email.trim() && !looksLikeEmail(email.trim())) next.email = pt("common.emailInvalid");
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await unwrap(
        addParticipantAction({
          pollId: p.pollId,
          name: name.trim(),
          email: email.trim() || null,
          isRequired: required,
          notify: Boolean(email.trim()) && notify,
          votes: futureVotes(p.options, votes),
        }),
      );
      toast.success(pt("results.participantAdded"));
      p.onOpenChange(false);
      p.onDone();
    } catch (e) {
      const fe = fieldErrorsOf(e);
      setErrors({ name: fe.name?.[0], email: fe.email?.[0], form: fe.name || fe.email ? undefined : failureMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={p.open}
      onOpenChange={(v) => !busy && p.onOpenChange(v)}
      title={pt("results.addParticipantTitle")}
      description={pt("results.addParticipantBody")}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => p.onOpenChange(false)} disabled={busy}>
            {pt("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {pt("results.addParticipant")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={pt("results.participantName")} required error={errors.name}>
            {(c) => <Input {...c} value={name} maxLength={MAX_NAME_LENGTH} onChange={(e) => setName(e.target.value)} invalid={Boolean(errors.name)} />}
          </FormField>
          <FormField label={pt("results.participantEmail")} error={errors.email}>
            {(c) => <Input {...c} type="email" value={email} maxLength={MAX_EMAIL_LENGTH} onChange={(e) => setEmail(e.target.value)} invalid={Boolean(errors.email)} />}
          </FormField>
        </div>
        <Checkbox label={pt("results.participantRequired")} checked={required} onCheckedChange={setRequired} />
        <div>
          <p className="mb-2 text-label text-ink">{pt("results.participantVotes")}</p>
          <VotesEditor options={p.options} zone={p.zone} pollZone={p.pollZone} hour12={p.hour12} allowIfNeedBe={p.allowIfNeedBe} value={votes} onChange={setVotes} />
        </div>
        {email.trim() && <Checkbox label={pt("results.participantNotify")} checked={notify} onCheckedChange={setNotify} />}
        <FieldError error={errors.form} />
      </div>
    </Dialog>
  );
}

export function EditVotesDialog(p: Common & { participant: HostParticipantView; onOpenChange: (v: boolean) => void }) {
  const [votes, setVotes] = useState<Record<string, VoteChoice>>(() => ({ ...p.participant.votes }));
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await unwrap(
        setParticipantVotesAction({
          pollId: p.pollId,
          participantId: p.participant.id,
          notify: Boolean(p.participant.email) && notify,
          votes: futureVotes(p.options, votes),
        }),
      );
      toast.success(pt("results.votesSaved"));
      p.onOpenChange(false);
      p.onDone();
    } catch (e) {
      setError(failureMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => !busy && p.onOpenChange(v)}
      title={pt("results.editVotesTitle", { name: p.participant.name })}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => p.onOpenChange(false)} disabled={busy}>
            {pt("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {pt("common.saveChanges")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <VotesEditor options={p.options} zone={p.zone} pollZone={p.pollZone} hour12={p.hour12} allowIfNeedBe={p.allowIfNeedBe} value={votes} onChange={setVotes} />
        {p.participant.email && <Checkbox label={pt("results.participantNotify")} checked={notify} onCheckedChange={setNotify} />}
        <FieldError error={error} />
      </div>
    </Dialog>
  );
}

export function RemoveParticipantDialog({ pollId, participant, onOpenChange, onDone }: { pollId: string; participant: HostParticipantView; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const [notify, setNotify] = useState(true);
  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={pt("results.removeTitle", { name: participant.name })}
      description={pt("results.removeBody")}
      confirmLabel={pt("results.removeConfirm")}
      variant="destructive"
      onConfirm={async () => {
        await unwrap(removeParticipantAction({ pollId, participantId: participant.id, notify: Boolean(participant.email) && notify }));
        toast.success(pt("results.removed"));
        onDone();
      }}
    >
      {participant.email && <Checkbox label={pt("results.removeNotify", { name: participant.name })} checked={notify} onCheckedChange={setNotify} />}
    </ConfirmDialog>
  );
}
