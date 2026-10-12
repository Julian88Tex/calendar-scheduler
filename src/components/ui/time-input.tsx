// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// TimeInput (ARCHITECTURE 20.2): a typeable 15-minute combobox. Values are minutes from local midnight (0..1440).
// parseTimeInput (./time-input-utils.ts, server safe) accepts "9", "930", "9:30 pm", "21:30". Foundation stub: a text
// input with a datalist.
"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/cn";
import { formatMinutes, parseTimeInput } from "./time-input-utils";

export type TimeInputProps = {
  /** Minutes from midnight, or null. */
  value: number | null;
  onChange: (minutes: number | null) => void;
  /** Option step (default 15). */
  stepMinutes?: number;
  min?: number;
  max?: number;
  /** Offer 24:00 ("12:00am" next day) as an end time. */
  allowEndOfDay?: boolean;
  hour12?: boolean;
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

export function TimeInput({ value, onChange, stepMinutes = 15, min = 0, max = 1440, allowEndOfDay, hour12 = true, placeholder, invalid, disabled, id, className, ...aria }: TimeInputProps) {
  const listId = useId();
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value === null ? "" : formatMinutes(value, hour12));
  const options: number[] = [];
  for (let m = min; m <= Math.min(max, allowEndOfDay ? 1440 : 1439); m += stepMinutes) options.push(m);
  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="text"
        list={listId}
        value={shown}
        placeholder={placeholder ?? (hour12 ? "9:00am" : "09:00")}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text === null) return;
          const parsed = text.trim() === "" ? null : parseTimeInput(text);
          setText(null);
          if (parsed === null || (parsed >= min && parsed <= max)) onChange(parsed);
        }}
        className={cn("h-10 w-28 rounded-[var(--radius-input)] border border-line px-3 text-body-md", invalid && "border-danger", className)}
        {...aria}
      />
      <datalist id={listId}>
        {options.map((m) => (
          <option key={m} value={formatMinutes(m, hour12)} />
        ))}
      </datalist>
    </>
  );
}
