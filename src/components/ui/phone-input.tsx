// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// PhoneInput (ARCHITECTURE 20.2): country select with flags and E.164 output with validation. Foundation stub: a tel
// input that emits the typed value when it looks like E.164.
"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export type PhoneInputProps = {
  /** E.164 ("+14155551234") or null. */
  value: string | null;
  onChange: (e164: string | null) => void;
  /** ISO 3166-1 alpha-2 default country (default "US"). */
  defaultCountry?: string;
  /** Restrict the country list (SMS supported countries). */
  countries?: string[];
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

export function PhoneInput({ value, onChange, defaultCountry: _defaultCountry, countries: _countries, placeholder = "+1 415 555 1234", invalid, disabled, required, name, id, className, ...aria }: PhoneInputProps) {
  const [text, setText] = useState(value ?? "");
  return (
    <input
      id={id}
      type="tel"
      name={name}
      autoComplete="tel"
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      aria-invalid={invalid || undefined}
      onChange={(e) => {
        setText(e.target.value);
        const normalized = e.target.value.replace(/[\s().-]/g, "");
        onChange(E164_PATTERN.test(normalized) ? normalized : null);
      }}
      className={cn("h-10 w-full rounded-[var(--radius-input)] border border-line px-3 text-body-md", invalid && "border-danger", className)}
      {...aria}
    />
  );
}
