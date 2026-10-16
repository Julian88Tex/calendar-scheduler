// Invitee form section (SPEC ET-24, BK-12): the name field format, the fixed Email field, "Allow invitees to add
// guests", and the custom questions list (drag to reorder, type badge, required asterisk, On/Off switch, edit, delete)
// with "+ Add new question" (max 10, disabled with the tooltip "You can add up to 10 questions"). Questions open the
// QuestionDialog. Client component.
"use client";

import { Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { RadioGroup } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { MAX_QUESTIONS, MESSAGES } from "@/lib/event-types/constants";
import type { QuestionDraft } from "@/lib/event-types/types";
import { newId } from "@/lib/ids";
import { DragHandle, moveItem, SortableAssist, useSortable } from "../sortable";
import { errorOf, FieldGroup, type SectionProps } from "./fields";
import { QUESTION_TYPE_LABELS, QuestionDialog } from "./question-dialog";

export function InviteeFormSection({ draft, update, errors, disabled, kind }: SectionProps & { kind: "solo" | "group" }) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [editing, setEditing] = useState<{ index: number | null; question: QuestionDraft } | null>(null);
  const questions = draft.questions;
  const full = questions.length >= MAX_QUESTIONS;
  const sortable = useSortable(questions.length, (from, to) => update({ questions: moveItem(questions, from, to) }), { disabled, idPrefix: `${base}-q` });
  const listError = errorOf(errors, "questions");

  const setQuestion = (index: number, patch: Partial<QuestionDraft>) =>
    update({ questions: questions.map((q, i) => (i === index ? { ...q, ...patch } : q)) });

  const addButton = (
    <Button
      variant="tertiary"
      size="sm"
      leftIcon={<Plus aria-hidden="true" />}
      disabled={disabled || full}
      aria-disabled={full || undefined}
      onClick={() =>
        setEditing({
          index: null,
          question: { id: newId(), label: "", type: "string", required: false, enabled: true, answerChoices: [], includeOther: false },
        })
      }
    >
      Add new question
    </Button>
  );

  return (
    <div className="flex flex-col gap-7">
      <FieldGroup title="Name">
        <RadioGroup
          aria-label="Name"
          value={draft.nameFormat}
          disabled={disabled}
          onValueChange={(v) => update({ nameFormat: v === "first_last" ? "first_last" : "full" })}
          options={[
            { value: "full", label: "Name" },
            { value: "first_last", label: "First Name, Last Name" },
          ]}
        />
      </FieldGroup>

      <FieldGroup title="Email">
        <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-line bg-pebble px-3 py-2.5 text-body-md text-ink">
          <Lock aria-hidden="true" className="size-4 text-ink-2" />
          <span>
            Email <span className="text-danger-text" aria-hidden="true">*</span>
          </span>
          <span className="ml-auto text-body-sm text-ink-2">Always required</span>
        </div>
        {kind !== "group" && (
          <Checkbox
            label="Allow invitees to add guests"
            description="Invitees can add up to 10 guest emails to the meeting."
            checked={draft.allowGuests}
            disabled={disabled}
            onCheckedChange={(allowGuests) => update({ allowGuests })}
          />
        )}
      </FieldGroup>

      <FieldGroup title="Questions" hint="Invitees answer these on the booking form.">
        {questions.length > 0 ? (
          <ul aria-label="Questions" className="flex flex-col gap-2">
            {questions.map((q, i) => {
              const title = q.label || "Untitled question";
              const rowError = errorOf(errors, `questions.${i}`, true);
              return (
                <li
                  key={q.id}
                  {...sortable.rowProps(i)}
                  className={cn(
                    "flex min-w-0 items-start gap-1.5 rounded-[var(--radius-card)] border border-line bg-white py-2 pr-2 pl-1",
                    !q.enabled && "bg-pebble",
                    rowError && "border-danger",
                    sortable.overIndex === i && "border-primary bg-primary-soft",
                  )}
                >
                  <DragHandle {...sortable.handleProps(i, title)} className="mt-0.5" />
                  <div className="min-w-0 flex-1 py-1">
                    <p className={cn("break-words text-body-md font-semibold text-ink", !q.enabled && "text-ink-2")}>
                      {title}
                      {q.required && (
                        <>
                          <span className="text-danger-text" aria-hidden="true">
                            {" "}
                            *
                          </span>
                          <span className="sr-only"> (required)</span>
                        </>
                      )}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="neutral" size="sm">
                        {QUESTION_TYPE_LABELS[q.type]}
                      </Badge>
                      {!q.enabled && (
                        <Badge variant="outline" size="sm">
                          Off
                        </Badge>
                      )}
                    </div>
                    {rowError && <FieldError error={rowError} className="mt-1" />}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Switch
                      size="sm"
                      checked={q.enabled}
                      disabled={disabled}
                      aria-label={`${title}: ${q.enabled ? "On" : "Off"}`}
                      onCheckedChange={(enabled) => setQuestion(i, { enabled })}
                      className="mr-1"
                    />
                    <IconButton size="sm" aria-label={`Edit ${title}`} disabled={disabled} onClick={() => setEditing({ index: i, question: { ...q, answerChoices: [...q.answerChoices] } })}>
                      <Pencil aria-hidden="true" className="size-4" />
                    </IconButton>
                    <IconButton size="sm" aria-label={`Delete ${title}`} disabled={disabled} onClick={() => update({ questions: questions.filter((_, j) => j !== i) })}>
                      <Trash2 aria-hidden="true" className="size-4" />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-body-md text-ink-2">No questions. Invitees only enter their name and email.</p>
        )}
        {questions.length > 1 && <SortableAssist idPrefix={`${base}-q`} announcement={sortable.announcement} />}
        <div className="self-start">{full ? <Tooltip content={MESSAGES.questionsTooMany}><span tabIndex={0}>{addButton}</span></Tooltip> : addButton}</div>
        {listError && <FieldError error={listError} />}
      </FieldGroup>

      {editing && (
        <QuestionDialog
          question={editing.question}
          isNew={editing.index === null}
          onCancel={() => setEditing(null)}
          onApply={(q) => {
            if (editing.index === null) update({ questions: [...questions, q] });
            else update({ questions: questions.map((x, i) => (i === editing.index ? q : x)) });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
