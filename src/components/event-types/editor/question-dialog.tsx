// QuestionDialog (SPEC ET-24): add or edit a custom question: "Question" (1 to 500 characters), "Required",
// "Answer type" (One line, Multiple lines, Radio buttons, Checkboxes, Dropdown, Phone number), "Answer choices" for
// choice types (1 to 50 unique choices of up to 200 characters) with "Include 'other' option", and "Status" On/Off.
// "Apply" validates with the shared question schema and hands the question back. Client component.
"use client";

import { Plus, X } from "lucide-react";
import { useId, useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog } from "@/components/ui/dialog";
import { FieldError, FormField } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ANSWER_CHOICE_MAX, MAX_ANSWER_CHOICES, QUESTION_LABEL_MAX } from "@/lib/event-types/constants";
import { hasChoices, zQuestion } from "@/lib/event-types/schemas";
import type { QuestionDraft, QuestionType } from "@/lib/event-types/types";

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  string: "One line",
  text: "Multiple lines",
  single_select: "Radio buttons",
  multi_select: "Checkboxes",
  dropdown: "Dropdown",
  phone_number: "Phone number",
};

const TYPE_ORDER: QuestionType[] = ["string", "text", "single_select", "multi_select", "dropdown", "phone_number"];

export function QuestionDialog({
  question,
  isNew,
  onCancel,
  onApply,
}: {
  question: QuestionDraft;
  isNew: boolean;
  onCancel: () => void;
  onApply: (q: QuestionDraft) => void;
}) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [q, setQ] = useState<QuestionDraft>(() => ({
    ...question,
    answerChoices: hasChoices(question.type) && question.answerChoices.length === 0 ? [""] : question.answerChoices,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const choices = hasChoices(q.type);

  const setType = (type: QuestionType) => {
    setQ((cur) => ({ ...cur, type, answerChoices: hasChoices(type) && cur.answerChoices.length === 0 ? [""] : cur.answerChoices }));
    setErrors({});
  };

  const apply = (e?: React.FormEvent) => {
    e?.preventDefault();
    const parsed = zQuestion.safeParse(q);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.map(String).join(".");
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    onApply(parsed.data);
  };

  return (
    <Dialog
      open
      size="md"
      onOpenChange={(open) => !open && onCancel()}
      title={isNew ? "Add new question" : "Edit question"}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" form={`${base}-form`}>
            Apply
          </Button>
        </>
      }
    >
      <form id={`${base}-form`} onSubmit={apply} noValidate className="flex flex-col gap-5">
        <FormField label="Question" required error={errors.label}>
          {(c) => (
            <Textarea
              {...c}
              rows={2}
              autoResize
              showCount
              maxLength={QUESTION_LABEL_MAX}
              value={q.label}
              invalid={Boolean(errors.label)}
              placeholder="What would you like to discuss?"
              onChange={(e) => setQ({ ...q, label: e.target.value })}
            />
          )}
        </FormField>
        <Checkbox label="Required" checked={q.required} onCheckedChange={(required) => setQ({ ...q, required })} />
        <FormField label="Answer type">
          {(c) => (
            <Select
              id={c.id}
              aria-describedby={c["aria-describedby"]}
              value={q.type}
              onValueChange={(v) => setType(v as QuestionType)}
              options={TYPE_ORDER.map((t) => ({ value: t, label: QUESTION_TYPE_LABELS[t] }))}
            />
          )}
        </FormField>
        {choices && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-label text-ink">Answer choices</legend>
            <ul className="flex flex-col gap-2">
              {q.answerChoices.map((choice, i) => (
                <li key={i} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={`Answer choice ${i + 1}`}
                      value={choice}
                      maxLength={ANSWER_CHOICE_MAX}
                      invalid={Boolean(errors[`answerChoices.${i}`])}
                      onChange={(e) => setQ({ ...q, answerChoices: q.answerChoices.map((c, j) => (j === i ? e.target.value : c)) })}
                      className="flex-1"
                    />
                    <IconButton
                      size="sm"
                      aria-label={`Remove answer choice ${i + 1}`}
                      disabled={q.answerChoices.length <= 1}
                      onClick={() => setQ({ ...q, answerChoices: q.answerChoices.filter((_, j) => j !== i) })}
                    >
                      <X aria-hidden="true" className="size-4" />
                    </IconButton>
                  </div>
                  {errors[`answerChoices.${i}`] && <FieldError error={errors[`answerChoices.${i}`]} />}
                </li>
              ))}
            </ul>
            {q.answerChoices.length < MAX_ANSWER_CHOICES && (
              <Button
                variant="tertiary"
                size="sm"
                leftIcon={<Plus aria-hidden="true" />}
                className="self-start"
                onClick={() => setQ({ ...q, answerChoices: [...q.answerChoices, ""] })}
              >
                Add another
              </Button>
            )}
            {errors.answerChoices && <FieldError error={errors.answerChoices} />}
            <Checkbox label="Include 'other' option" checked={q.includeOther} onCheckedChange={(includeOther) => setQ({ ...q, includeOther })} className="mt-1" />
          </fieldset>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <div className="flex flex-col">
            <span className="text-label text-ink">Status</span>
            <span className="text-body-sm text-ink-2">Questions that are off are not shown to invitees.</span>
          </div>
          <Switch checked={q.enabled} onCheckedChange={(enabled) => setQ({ ...q, enabled })} showStateLabel aria-label="Status" />
        </div>
      </form>
    </Dialog>
  );
}
