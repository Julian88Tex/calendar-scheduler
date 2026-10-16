// "Invite people" (SPEC MP-06; research B4.2): paste emails separated by commas, semicolons or new lines ("Name
// <email>" works too), mark people as required, edit the subject (default "{Host name} wants to find a time: {Poll
// title}") and an optional message, then "Send". Each person gets a personal link that pre-fills their name and email.
// People who already responded or unsubscribed are reported back. Client component.
"use client";

import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { invitePeopleAction } from "@/lib/polls/actions";
import { MAX_INVITE_MESSAGE_LENGTH, MAX_INVITE_SUBJECT_LENGTH, MAX_INVITES_PER_SEND } from "@/lib/polls/constants";
import { parseRecipientList } from "@/lib/polls/validation";
import { failureMessage, fieldErrorsOf, unwrap } from "../lib/action";
import { pt, ptCount } from "../lib/t";

export type InviteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pollId: string;
  pollTitle: string;
  hostName: string;
  onSent?: () => void;
};

export function InviteDialog(p: InviteDialogProps) {
  const [text, setText] = useState("");
  const [required, setRequired] = useState<Set<string>>(new Set());
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState(() => pt("invite.defaultSubject", { host: p.hostName, title: p.pollTitle }));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parseRecipientList(text), [text]);
  const recipients = parsed.recipients.filter((r) => !removed.has(r.email.toLowerCase()));

  const reset = () => {
    setText("");
    setRequired(new Set());
    setRemoved(new Set());
    setMessage("");
    setError(null);
  };

  const send = async () => {
    setError(null);
    if (!recipients.length) {
      setError(pt("invite.none"));
      return;
    }
    if (recipients.length > MAX_INVITES_PER_SEND) {
      setError(pt("invite.tooMany"));
      return;
    }
    setBusy(true);
    try {
      const out = await unwrap(
        invitePeopleAction({
          pollId: p.pollId,
          recipients: recipients.map((r) => ({ email: r.email, name: r.name, required: required.has(r.email.toLowerCase()) })),
          subject: subject.trim() || null,
          message: message.trim() || null,
        }),
      );
      const total = out.invited + out.resent;
      if (total > 0) toast.success(total === 1 ? pt("invite.sentOne") : pt("invite.sent"));
      for (const reason of ["responded", "unsubscribed"] as const) {
        const list = out.skipped.filter((s) => s.reason === reason).map((s) => s.email);
        if (list.length) toast.info(pt("invite.skipped", { list: list.join(", "), reason: pt(reason === "responded" ? "invite.skippedResponded" : "invite.skippedUnsubscribed") }));
      }
      reset();
      p.onOpenChange(false);
      p.onSent?.();
    } catch (e) {
      const fe = fieldErrorsOf(e);
      setError(fe.recipients?.[0] ?? Object.values(fe)[0]?.[0] ?? failureMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={p.open}
      onOpenChange={(v) => {
        if (busy) return;
        p.onOpenChange(v);
      }}
      title={pt("invite.title")}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={() => p.onOpenChange(false)} disabled={busy}>
            {pt("common.cancel")}
          </Button>
          <Button onClick={() => void send()} loading={busy} disabled={!recipients.length} data-testid="invite-send">
            {pt("invite.send")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormField label={pt("invite.recipients")} hint={pt("invite.recipientsHint")} error={error ?? (parsed.invalid.length ? pt("invite.invalid", { list: parsed.invalid.slice(0, 5).join(", ") }) : null)} required>
          {(control) => (
            <Textarea {...control} rows={3} value={text} placeholder={pt("invite.recipientsPlaceholder")} onChange={(e) => setText(e.target.value)} invalid={Boolean(error)} data-testid="invite-recipients" />
          )}
        </FormField>
        {recipients.length > 0 && (
          <div className="rounded-[var(--radius-card)] border border-line">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <p className="text-label-sm text-ink-2">{ptCount(recipients.length, "invite.countOne", "invite.count")}</p>
              <p className="text-body-sm text-ink-2">{pt("invite.requiredHint")}</p>
            </div>
            <ul className="max-h-[220px] overflow-y-auto scrollbar-thin">
              {recipients.map((r) => {
                const key = r.email.toLowerCase();
                return (
                  <li key={key} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      {r.name && <p className="truncate text-label text-ink">{r.name}</p>}
                      <p className="truncate text-body-md text-ink-2">{r.email}</p>
                    </div>
                    <Checkbox
                      label={pt("invite.required")}
                      checked={required.has(key)}
                      onCheckedChange={(on) =>
                        setRequired((s) => {
                          const n = new Set(s);
                          if (on) n.add(key);
                          else n.delete(key);
                          return n;
                        })
                      }
                    />
                    <IconButton aria-label={pt("invite.removeRecipient", { email: r.email })} size="sm" onClick={() => setRemoved((s) => new Set(s).add(key))}>
                      <X aria-hidden="true" />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <FormField label={pt("invite.subject")}>
          {(control) => <Input {...control} value={subject} maxLength={MAX_INVITE_SUBJECT_LENGTH} onChange={(e) => setSubject(e.target.value)} />}
        </FormField>
        <FormField label={pt("invite.message")}>
          {(control) => (
            <Textarea {...control} rows={3} value={message} maxLength={MAX_INVITE_MESSAGE_LENGTH} placeholder={pt("invite.messagePlaceholder")} onChange={(e) => setMessage(e.target.value)} />
          )}
        </FormField>
      </div>
    </Dialog>
  );
}
