// OWNER: workflows.
//
// ReminderDialog (SPEC NT-09, NT-11, ET-25): the simplified workflow editor of one reminder row of the event type
// "Notifications and workflows" section, Calendly style: an On switch, up to 3 timings ("[24] [hours] before event",
// "+ Add another reminder"), the email subject and message with "Variables" chips (the default message keeps
// Calendly's event details blocks), "Include cancel and reschedule links" for invitee reminders, and "Cancel" /
// "Save and close" in the footer. Field errors come back from the server on the same paths the schema uses
// ("timings.0.amount", "subject", "bodyHtml").
"use client";

import { Plus, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyButton } from "@/components/ui/copy-button";
import { Dialog, DialogClose } from "@/components/ui/dialog";
import { FieldError } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { editorHtmlToText, escapeText } from "@/components/ui/rich-text-utils";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/toast";
import { saveEventTypeRemindersAction } from "@/lib/workflows/actions";
import { BODY_TEXT_MAX, REMINDER_MESSAGES, SUBJECT_MAX } from "@/lib/workflows/schemas";
import {
  MAX_REMINDER_TIMINGS,
  OFFSET_UNITS,
  SHORT_TIMING_MINUTES,
  splitOffset,
  toOffsetMinutes,
  validateTimings,
  type OffsetUnit,
} from "@/lib/workflows/timing";
import type { EventTypeRemindersView, ReminderKind } from "@/lib/workflows/types";

export const REMINDER_COPY: Record<ReminderKind, { title: string; description: string; switchLabel: string; offDescription: string }> = {
  invitee: {
    title: "Email reminders",
    description: "Your invitees will receive an email reminder before the event, at the times you choose.",
    switchLabel: "Send email reminders",
    offDescription: "Remind invitees by email before the event",
  },
  host: {
    title: "Email reminders to host",
    description: "You will receive an email reminder before each meeting, with the invitee's details.",
    switchLabel: "Send me email reminders",
    offDescription: "Get an email before each meeting",
  },
};

const UNIT_LABELS: Record<OffsetUnit, string> = { minutes: "minutes", hours: "hours", days: "days" };
/** Timings offered by "Add another reminder", in order, skipping ones already used. */
const NEXT_TIMINGS = [60, 15, 1440, 2880, 30];

type TimingDraft = { key: number; amount: string; unit: OffsetUnit };

let draftCounter = 0;
/** A timing row draft with a stable React key. */
function makeDraft(minutes: number): TimingDraft {
  const { amount, unit } = splitOffset(minutes);
  draftCounter += 1;
  return { key: draftCounter, amount: String(amount), unit };
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** A one-line subject from the editor's text ("{{key}}" for variable chips). */
const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, " ");

export type ReminderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ReminderKind;
  view: EventTypeRemindersView;
  onSaved: (view: EventTypeRemindersView) => void;
};

/** The form is mounted fresh on every open, so drafts start from the saved row. */
export function ReminderDialog(props: ReminderDialogProps) {
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const formId = `reminder-form-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const copy = REMINDER_COPY[props.kind];
  return (
    <Dialog
      open={props.open}
      onOpenChange={(v) => {
        if (!v) setDirty(false);
        props.onOpenChange(v);
      }}
      title={copy.title}
      description={copy.description}
      size="lg"
      preventOutsideClose={dirty}
      footer={
        <>
          <DialogClose asChild>
            <Button type="button" variant="secondary" disabled={saving}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" form={formId} loading={saving}>
            Save and close
          </Button>
        </>
      }
    >
      {props.open && <ReminderForm {...props} formId={formId} onDirty={() => setDirty(true)} onSavingChange={setSaving} />}
    </Dialog>
  );
}

type ReminderFormProps = ReminderDialogProps & { formId: string; onDirty: () => void; onSavingChange: (saving: boolean) => void };

function ReminderForm({ kind, view, onSaved, onOpenChange, onDirty, formId, onSavingChange }: ReminderFormProps) {
  const row = view[kind];
  const defaults = view.defaults[kind];
  const copy = REMINDER_COPY[kind];
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [enabled, setEnabled] = useState(row.configured ? row.enabled : true);
  const [timings, setTimings] = useState<TimingDraft[]>(() => (row.offsets.length ? row.offsets : [1440]).map(makeDraft));
  // The subject editor holds HTML (chips); `subject` is its one-line text with {{variables}}.
  const [subjectHtml, setSubjectHtml] = useState(() => escapeText(row.subject ?? defaults.subject));
  const [subject, setSubject] = useState(row.subject ?? defaults.subject);
  const [body, setBody] = useState(row.bodyHtml ?? defaults.bodyHtml);
  const [bodyText, setBodyText] = useState(() => editorHtmlToText(row.bodyHtml ?? defaults.bodyHtml));
  const [links, setLinks] = useState(row.configured ? row.includeCancelRescheduleLinks : view.defaultIncludeLinks);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const defaultBodyText = useMemo(() => squash(editorHtmlToText(defaults.bodyHtml)), [defaults.bodyHtml]);
  const bodyIsDefault = squash(bodyText) === defaultBodyText;
  const subjectIsDefault = squash(subject) === squash(defaults.subject);
  const parsed = timings.map((t) => ({ amount: Number(t.amount), unit: t.unit }));
  const minutes = parsed.map((t) => toOffsetMinutes(t.amount, t.unit));
  const showShortHint =
    minutes.some((m) => Number.isFinite(m) && m < SHORT_TIMING_MINUTES) && view.delivery.dispatcher === "cron" && view.delivery.cronStale;

  const touch = () => {
    onDirty();
    setFormError(null);
  };

  const clearError = (key: string) =>
    setErrors((e) => {
      if (!(key in e) && !("timings" in e)) return e;
      const next = { ...e };
      delete next[key];
      delete next.timings;
      return next;
    });

  const updateTiming = (index: number, patch: Partial<TimingDraft>) => {
    touch();
    setTimings((list) => list.map((t, i) => (i === index ? { ...t, ...patch } : t)));
    clearError(`timings.${index}.amount`);
  };

  const save = async () => {
    if (savingRef.current) return;
    const local: Record<string, string> = {};
    for (const [k, msg] of Object.entries(validateTimings(parsed))) local[k === "list" ? "timings" : `timings.${k}.amount`] = msg;
    if (!subject.trim()) local.subject = REMINDER_MESSAGES.subjectRequired;
    else if (subject.length > SUBJECT_MAX) local.subject = REMINDER_MESSAGES.subjectTooLong;
    if (!bodyText.trim()) local.bodyHtml = REMINDER_MESSAGES.bodyRequired;
    else if (bodyText.length > BODY_TEXT_MAX) local.bodyHtml = REMINDER_MESSAGES.bodyTooLong;
    setErrors(local);
    if (Object.keys(local).length) return;
    savingRef.current = true;
    onSavingChange(true);
    setFormError(null);
    try {
      const res = await saveEventTypeRemindersAction({
        eventTypeId: view.eventTypeId,
        kind,
        enabled,
        timings: parsed,
        subject: subjectIsDefault ? null : subject.trim(),
        bodyHtml: bodyIsDefault ? null : body,
        includeCancelRescheduleLinks: kind === "invitee" ? links : false,
      });
      if (!res.ok) {
        const mapped: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.error.fieldErrors ?? {})) if (v[0]) mapped[k] = v[0];
        setErrors(mapped);
        if (!Object.keys(mapped).length) setFormError(res.error.message);
        return;
      }
      onSaved(res.data);
      toast.success("Changes saved");
      onOpenChange(false);
    } catch {
      setFormError("Something went wrong. Try again.");
    } finally {
      savingRef.current = false;
      onSavingChange(false);
    }
  };

  return (
    <form
      id={formId}
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      noValidate
    >
      {formError && (
        <Banner variant="error" role="alert">
          {formError}
        </Banner>
      )}

      <div className="rounded-[var(--radius-card)] border border-line px-4 py-3">
        <Switch
          checked={enabled}
          onCheckedChange={(v) => {
            touch();
            setEnabled(v);
          }}
          label={copy.switchLabel}
          labelPosition="start"
          className="flex w-full justify-between"
        />
      </div>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-1 text-label text-ink">Timing</legend>
        <ul className="flex flex-col gap-3">
          {timings.map((t, i) => {
            const err = errors[`timings.${i}.amount`];
            const errId = `${base}-timing-${t.key}-error`;
            return (
              <li key={t.key} className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={t.amount}
                    onChange={(e) => updateTiming(i, { amount: e.target.value })}
                    aria-label={`Reminder ${i + 1} amount`}
                    aria-describedby={err ? errId : undefined}
                    invalid={Boolean(err)}
                    className="w-16 sm:w-20"
                  />
                  <NativeSelect
                    value={t.unit}
                    onChange={(e) => updateTiming(i, { unit: e.target.value as OffsetUnit })}
                    aria-label={`Reminder ${i + 1} unit`}
                    options={OFFSET_UNITS.map((u) => ({ value: u, label: UNIT_LABELS[u] }))}
                    className="w-28 sm:w-32"
                  />
                  <span className="text-body-md text-ink">before event</span>
                  {timings.length > 1 && (
                    <IconButton
                      size="sm"
                      aria-label={`Remove reminder ${i + 1}`}
                      onClick={() => {
                        touch();
                        setTimings((list) => list.filter((x) => x.key !== t.key));
                        setErrors({});
                      }}
                    >
                      <X aria-hidden="true" />
                    </IconButton>
                  )}
                </div>
                {err && <FieldError id={errId} error={err} />}
              </li>
            );
          })}
        </ul>
        {errors.timings && <FieldError error={errors.timings} />}
        {timings.length < MAX_REMINDER_TIMINGS ? (
          <div>
            <Button
              type="button"
              variant="tertiary"
              size="sm"
              leftIcon={<Plus aria-hidden="true" />}
              onClick={() => {
                touch();
                const used = new Set(minutes);
                setTimings((list) => [...list, makeDraft(NEXT_TIMINGS.find((m) => !used.has(m)) ?? 60)]);
              }}
            >
              Add another reminder
            </Button>
          </div>
        ) : (
          <p className="text-body-sm text-ink-2">You can add up to {MAX_REMINDER_TIMINGS} reminders.</p>
        )}
        {showShortHint && (
          <Banner variant="warning" role="status">
            <span className="flex flex-col gap-2">
              <span>Short timings need a pinger that runs every 5 minutes. Messages may be sent late.</span>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <code className="min-w-0 rounded-[6px] border border-line bg-surface px-2 py-1 text-[13px] break-all text-ink">{view.delivery.cronUrl}</code>
                <CopyButton value={view.delivery.cronUrl} size="sm" label="Copy URL" toastMessage="URL copied" />
              </span>
            </span>
          </Banner>
        )}
      </fieldset>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span id={`${base}-subject-label`} className="text-label text-ink">
          Email subject
        </span>
        {/* One line: Enter never adds a paragraph. */}
        <div
          onKeyDownCapture={(e) => {
            if (e.key === "Enter" && (e.target as HTMLElement).getAttribute("role") === "textbox") e.preventDefault();
          }}
        >
          <RichTextEditor
            value={subjectHtml}
            onChange={(v) => {
              touch();
              setSubjectHtml(v.html);
              setSubject(oneLine(v.text));
              clearError("subject");
            }}
            variables={view.variables}
            toolbar={[]}
            minHeight={40}
            invalid={Boolean(errors.subject)}
            aria-labelledby={`${base}-subject-label`}
            aria-describedby={errors.subject ? `${base}-subject-error` : undefined}
          />
        </div>
        {errors.subject && <FieldError id={`${base}-subject-error`} error={errors.subject} />}
        {!subjectIsDefault && (
          <button
            type="button"
            className="self-start text-body-sm font-semibold text-primary-text hover:underline"
            onClick={() => {
              touch();
              setSubjectHtml(escapeText(defaults.subject));
              setSubject(defaults.subject);
              clearError("subject");
            }}
          >
            Reset to default
          </button>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <span id={`${base}-body-label`} className="text-label text-ink">
          Email message
        </span>
        <RichTextEditor
          value={body}
          onChange={(v) => {
            touch();
            setBody(v.html);
            setBodyText(v.text);
            clearError("bodyHtml");
          }}
          variables={view.variables}
          maxLength={BODY_TEXT_MAX}
          minHeight={140}
          invalid={Boolean(errors.bodyHtml)}
          aria-labelledby={`${base}-body-label`}
          aria-describedby={`${base}-body-hint`}
        />
        {errors.bodyHtml && <FieldError error={errors.bodyHtml} />}
        <p id={`${base}-body-hint`} className="text-body-sm text-ink-2">
          {bodyIsDefault
            ? "The default message also includes the event details: date, time, location and join link."
            : "Your message replaces the default email. Use Variables to add details such as the location or join link."}
        </p>
        {!bodyIsDefault && (
          <button
            type="button"
            className="self-start text-body-sm font-semibold text-primary-text hover:underline"
            onClick={() => {
              touch();
              setBody(defaults.bodyHtml);
              setBodyText(editorHtmlToText(defaults.bodyHtml));
              clearError("bodyHtml");
            }}
          >
            Reset to default
          </button>
        )}
      </div>

      {kind === "invitee" && (
        <Checkbox
          checked={view.defaultIncludeLinks && links}
          disabled={!view.defaultIncludeLinks}
          onCheckedChange={(v) => {
            touch();
            setLinks(v);
          }}
          label="Include cancel and reschedule links"
          description={
            view.defaultIncludeLinks
              ? 'Adds "Need to make changes to this event?" with Cancel and Reschedule links.'
              : "Cancel and reschedule links are turned off in this event type's email confirmation settings."
          }
        />
      )}
    </form>
  );
}
