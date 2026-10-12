// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// ChipsInput (ARCHITECTURE 20.2): values (emails) separated by comma, space or Enter, with per-value validation.
"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { Chip } from "./chip";

export type ChipsInputProps = {
  value: string[];
  onChange: (values: string[]) => void;
  /** Returns an error message for an invalid value (it is rejected), or null. */
  validate?: (value: string) => string | null;
  placeholder?: string;
  /** Maximum number of values (guests: 10). */
  max?: number;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

export function ChipsInput({ value, onChange, validate, placeholder, max, disabled, invalid, id, className, ...aria }: ChipsInputProps) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const commit = (raw: string) => {
    const parts = raw.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
    const next = [...value];
    for (const p of parts) {
      const problem = validate?.(p) ?? null;
      if (problem) {
        setError(problem);
        return;
      }
      if (!next.includes(p) && (max === undefined || next.length < max)) next.push(p);
    }
    setError(null);
    setDraft("");
    if (next.length !== value.length) onChange(next);
  };
  return (
    <div className={cn("flex flex-wrap items-center gap-1 rounded-[var(--radius-input)] border border-line p-2", (invalid || error) && "border-danger", className)}>
      {value.map((v) => (
        <Chip key={v} onRemove={disabled ? undefined : () => onChange(value.filter((x) => x !== v))} removeLabel={`Remove ${v}`}>
          {v}
        </Chip>
      ))}
      <input
        id={id}
        value={draft}
        disabled={disabled || (max !== undefined && value.length >= max)}
        placeholder={placeholder}
        aria-invalid={invalid || !!error || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "," || e.key === " ") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft && commit(draft)}
        className="min-w-32 flex-1 text-body-md outline-none"
        {...aria}
      />
      {error && (
        <p role="alert" className="w-full text-body-sm text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
