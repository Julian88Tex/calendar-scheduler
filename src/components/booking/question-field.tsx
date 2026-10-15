// One custom question of the details form (SPEC BK-12; live capture item 8): One line (input), Multiple lines (a 2-row,
// 57px textarea with the resize handle, like Calendly's), Radio buttons, Checkboxes (a single option works as consent),
// Dropdown ("Select..."), Phone number. "Other" adds a free text input when chosen. URLs in the question text render as
// links. Errors are linked with aria-describedby (GEN-05).
"use client";

import type * as React from "react";
import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PhoneInput } from "@/components/ui/phone-input";
import { RadioGroup } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { BOOKING_FIELD, BookingFieldError, FIELD_LABEL, RequiredMark } from "./form-parts";
import { MAX_ANSWER, type FormValues, type PublicQuestion } from "./lib/form";
import { bt } from "./lib/t";

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;

/** Question text with plain URLs as links (BK-12). */
export function Linkified({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    parts.push(
      <a key={i} href={m[0]} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-strong underline">
        {m[0]}
      </a>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

const OTHER = "__other__";

export type QuestionFieldProps = {
  question: PublicQuestion;
  values: FormValues;
  onChange: (update: (v: FormValues) => FormValues) => void;
  error?: string | null;
};

export function QuestionField({ question: q, values, onChange, error }: QuestionFieldProps) {
  const base = `q-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const errorId = error ? `${base}-error` : undefined;
  const raw = values.answers[q.id];
  const setAnswer = (value: string | string[]) => onChange((v) => ({ ...v, answers: { ...v.answers, [q.id]: value } }));
  const setOther = (text: string) => onChange((v) => ({ ...v, other: { ...v.other, [q.id]: text } }));
  const setOtherSelected = (on: boolean) => onChange((v) => ({ ...v, otherSelected: { ...v.otherSelected, [q.id]: on } }));
  const label = (
    <>
      <Linkified text={q.label} />
      {q.required && <RequiredMark />}
    </>
  );
  const otherInput = (
    <Input
      aria-label={`${q.label}: ${bt("details.other")}`}
      placeholder={bt("details.otherPlaceholder")}
      value={values.other[q.id] ?? ""}
      maxLength={MAX_ANSWER}
      onChange={(e) => setOther(e.target.value)}
      aria-invalid={error ? true : undefined}
      aria-describedby={errorId}
      className={cn(BOOKING_FIELD, "mt-2")}
    />
  );

  if (q.type === "single_select" || q.type === "multi_select") {
    const legendId = `${base}-legend`;
    return (
      <div
        role={q.type === "multi_select" ? "group" : undefined}
        aria-labelledby={q.type === "multi_select" ? legendId : undefined}
        aria-describedby={q.type === "multi_select" ? errorId : undefined}
        className="flex min-w-0 flex-col gap-2"
        data-field={`answers.${q.id}`}
      >
        <span id={legendId} className={FIELD_LABEL}>
          {label}
        </span>
        {q.type === "single_select" ? (
          <RadioGroup
            aria-labelledby={legendId}
            aria-describedby={errorId}
            required={q.required}
            value={values.otherSelected[q.id] ? OTHER : typeof raw === "string" ? raw : ""}
            onValueChange={(v) => {
              if (v === OTHER) {
                setOtherSelected(true);
                setAnswer("");
              } else {
                setOtherSelected(false);
                setAnswer(v);
              }
            }}
            options={[
              ...q.answerChoices.map((c) => ({ value: c, label: c })),
              ...(q.includeOther ? [{ value: OTHER, label: bt("details.other") }] : []),
            ]}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {q.answerChoices.map((c, i) => {
              const picked = Array.isArray(raw) ? raw : [];
              return (
                <Checkbox
                  key={`${i}-${c}`}
                  label={q.answerChoices.length === 1 ? <Linkified text={c} /> : c}
                  checked={picked.includes(c)}
                  aria-invalid={error ? true : undefined}
                  onCheckedChange={(on) => setAnswer(on ? [...picked.filter((x) => x !== c), c] : picked.filter((x) => x !== c))}
                />
              );
            })}
            {q.includeOther && (
              <Checkbox label={bt("details.other")} checked={values.otherSelected[q.id] === true} onCheckedChange={(on) => setOtherSelected(on)} />
            )}
          </div>
        )}
        {values.otherSelected[q.id] && otherInput}
        <BookingFieldError id={errorId} error={error} />
      </div>
    );
  }

  const id = `${base}-input`;
  let control: React.ReactNode;
  const common = { id, "aria-invalid": error ? true : undefined, "aria-describedby": errorId, required: q.required } as const;
  switch (q.type) {
    case "text":
      control = (
        <Textarea
          {...common}
          rows={2}
          maxLength={MAX_ANSWER}
          value={typeof raw === "string" ? raw : ""}
          onChange={(e) => setAnswer(e.target.value)}
          className={cn(BOOKING_FIELD, "h-[57px] min-h-[57px] py-[7px] leading-5")}
        />
      );
      break;
    case "dropdown":
      control = (
        <NativeSelect
          {...common}
          placeholder={bt("details.select")}
          value={typeof raw === "string" ? raw : ""}
          onChange={(e) => setAnswer(e.target.value)}
          options={q.answerChoices.map((c) => ({ value: c, label: c }))}
        />
      );
      break;
    case "phone_number":
      control = (
        <div
          onChange={(e) => {
            const el = e.target as HTMLInputElement;
            if (el.type === "tel") onChange((v) => ({ ...v, phoneRaw: { ...v.phoneRaw, [q.id]: el.value } }));
          }}
        >
          <PhoneInput
            id={id}
            value={typeof raw === "string" && raw ? raw : null}
            onChange={(e164) => setAnswer(e164 ?? "")}
            invalid={Boolean(error)}
            required={q.required}
            aria-describedby={errorId}
            validationMessage={false}
          />
        </div>
      );
      break;
    default:
      control = <Input {...common} maxLength={MAX_ANSWER} value={typeof raw === "string" ? raw : ""} onChange={(e) => setAnswer(e.target.value)} className={BOOKING_FIELD} />;
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-field={`answers.${q.id}`}>
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      {control}
      <BookingFieldError id={errorId} error={error} />
    </div>
  );
}
