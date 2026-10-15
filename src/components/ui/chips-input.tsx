// OWNER: foundation-ui.
//
// ChipsInput (ARCHITECTURE 20.2, SPEC BK-10, TM-02): values (emails) separated by comma, space, semicolon or Enter,
// also on paste and blur, with per-value validation, case-insensitive de-duplication, a maximum count and Backspace to
// remove the last chip. Pure parsing lives in ./chips-input-utils.ts.
"use client";

import { useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Chip } from "./chip";
import { addChips } from "./chips-input-utils";

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
  size?: "md" | "lg";
  /** Lowercases values before validation (emails). Default false. */
  lowercase?: boolean;
  /** Classes for the bordered field box (the booking form's taller, top-aligned guests field). */
  boxClassName?: string;
};

export function ChipsInput({ value, onChange, validate, placeholder, max, disabled, invalid, id, className, size = "md", lowercase, boxClassName, ...aria }: ChipsInputProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const errorId = `${base}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const full = max !== undefined && value.length >= max;

  const commit = (raw: string) => {
    if (!raw.trim()) {
      setDraft("");
      return;
    }
    const result = addChips(value, raw, { validate, max, normalize: lowercase ? (v) => v.toLowerCase() : undefined });
    if (result.added.length) onChange(result.values);
    setError(result.error?.message ?? null);
    setDraft(result.rest);
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          "flex w-full min-w-0 cursor-text flex-wrap items-center gap-1.5 rounded-[var(--radius-input)] border border-line bg-white px-2 py-1.5 transition-colors",
          "hover:border-ink-2 focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus",
          size === "lg" ? "min-h-[46px]" : "min-h-10",
          boxClassName,
          (invalid || error) && "border-danger hover:border-danger",
          disabled && "cursor-not-allowed bg-pebble",
        )}
      >
        <ul className="contents" aria-label="Added values">
          {value.map((v) => (
            <li key={v} className="flex min-w-0">
              <Chip variant="primary" disabled={disabled} onRemove={disabled ? undefined : () => onChange(value.filter((x) => x !== v))} removeLabel={`Remove ${v}`}>
                {v}
              </Chip>
            </li>
          ))}
        </ul>
        <input
          ref={inputRef}
          id={id}
          value={draft}
          disabled={disabled || full}
          placeholder={value.length === 0 ? placeholder : undefined}
          aria-invalid={invalid || !!error || undefined}
          aria-label={aria["aria-label"]}
          aria-describedby={[aria["aria-describedby"], error ? errorId : null].filter(Boolean).join(" ") || undefined}
          autoComplete="off"
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;\s]$/.test(v) && v.trim()) commit(v);
            else {
              setDraft(v);
              if (error) setError(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Tab") {
              if (draft.trim()) {
                if (e.key === "Enter") e.preventDefault();
                commit(draft);
              }
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text/plain");
            if (/[,;\s]/.test(text.trim())) {
              e.preventDefault();
              commit(`${draft} ${text}`);
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
          className={cn("h-7 min-w-32 flex-1 bg-transparent px-1 text-ink outline-none disabled:cursor-not-allowed", size === "lg" ? "text-[16px]" : "text-[14px]")}
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-body-sm font-semibold text-danger-text">
          {error}
        </p>
      )}
      {max !== undefined && full && !error && <p className="text-body-sm text-ink-2">{`You can add up to ${max}.`}</p>}
    </div>
  );
}
