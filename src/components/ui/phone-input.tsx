// OWNER: foundation-ui.
//
// PhoneInput (ARCHITECTURE 20.2, SPEC BK-13): a searchable country picker with flags and calling codes next to a tel
// input; emits E.164 ("+14155551234") or null while the number is incomplete or invalid. Typing "+44..." switches the
// country; a national trunk "0" is dropped. After blur, an invalid number is flagged (aria-invalid plus an optional
// message).
"use client";

import { ChevronDown } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Combobox } from "./combobox";
import { detectPhoneCountry, flagEmoji, PHONE_COUNTRIES, phoneCountry, splitE164, toE164 } from "./phone-countries";

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
  size?: "md" | "lg";
  /** Message shown after blur when the number is invalid; false hides it (the parent shows its own error). */
  validationMessage?: string | false;
};

export function PhoneInput({
  value,
  onChange,
  defaultCountry = "US",
  countries,
  placeholder,
  invalid,
  disabled,
  required,
  name,
  id,
  className,
  size = "md",
  validationMessage = "Enter a valid phone number.",
  ...aria
}: PhoneInputProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const initial = useMemo(() => splitE164(value, defaultCountry), [value, defaultCountry]);
  const [country, setCountry] = useState(() => initial.country?.iso ?? phoneCountry(defaultCountry)?.iso ?? "US");
  const [text, setText] = useState(() => initial.national);
  const [touched, setTouched] = useState(false);
  const allowed = useMemo(() => {
    const set = countries?.length ? new Set(countries.map((c) => c.toUpperCase())) : null;
    return PHONE_COUNTRIES.filter((c) => !set || set.has(c.iso));
  }, [countries]);
  const current = phoneCountry(country) ?? allowed[0] ?? PHONE_COUNTRIES[0]!;
  const e164 = toE164(current.iso, text);
  const showInvalid = invalid || (touched && text.trim() !== "" && e164 === null);
  const errorId = `${base}-error`;
  const showMessage = showInvalid && !invalid && Boolean(validationMessage);

  const emit = (iso: string, typed: string) => {
    const next = toE164(iso, typed);
    if (next !== value) onChange(next);
  };

  const height = size === "lg" ? "h-[46px]" : "h-10";
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div
        className={cn(
          "flex w-full min-w-0 items-stretch rounded-[var(--radius-input)] border border-line bg-white transition-colors",
          "hover:border-ink-2 focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus",
          showInvalid && "border-danger hover:border-danger",
          disabled && "bg-pebble",
          height,
        )}
      >
        <Combobox
          value={current.iso}
          onChange={(iso) => {
            if (!iso) return;
            setCountry(iso);
            emit(iso, text);
          }}
          options={allowed.map((c) => ({ value: c.iso, label: c.name, description: `+${c.dial}`, keywords: [c.dial, `+${c.dial}`, c.iso] }))}
          disabled={disabled}
          searchPlaceholder="Search countries"
          emptyText="No countries found"
          contentClassName="w-[min(320px,calc(100vw-16px))]"
          renderOption={(o) => (
            <span className="flex w-full min-w-0 items-center gap-2">
              <span aria-hidden="true" className="text-[18px] leading-none">
                {flagEmoji(o.value)}
              </span>
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              <span className="shrink-0 text-ink-2 tabular-nums">{o.description}</span>
            </span>
          )}
          trigger={
            <button
              type="button"
              disabled={disabled}
              aria-haspopup="listbox"
              aria-label={`Country: ${current.name} (+${current.dial})`}
              className="inline-flex shrink-0 items-center gap-1 rounded-l-[var(--radius-input)] border-r border-line pr-2 pl-3 text-[14px] text-ink hover:bg-primary-soft disabled:cursor-not-allowed"
            >
              <span aria-hidden="true" className="text-[18px] leading-none">
                {flagEmoji(current.iso)}
              </span>
              <span className="tabular-nums" aria-hidden="true">
                +{current.dial}
              </span>
              <ChevronDown aria-hidden="true" className="size-4 text-ink-2" />
            </button>
          }
        />
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          name={name ? `${name}_display` : undefined}
          value={text}
          placeholder={placeholder ?? (current.dial === "1" ? "(201) 555-0123" : "Phone number")}
          disabled={disabled}
          required={required}
          aria-label={aria["aria-label"]}
          aria-invalid={showInvalid || undefined}
          aria-describedby={[aria["aria-describedby"], showMessage ? errorId : null].filter(Boolean).join(" ") || undefined}
          onChange={(e) => {
            const typed = e.target.value;
            let iso = current.iso;
            if (typed.trim().startsWith("+")) {
              const detected = detectPhoneCountry(typed, current.iso);
              if (detected && allowed.some((c) => c.iso === detected.iso)) {
                iso = detected.iso;
                setCountry(iso);
              }
            }
            setText(typed);
            emit(iso, typed);
          }}
          onBlur={() => setTouched(true)}
          className={cn("min-w-0 flex-1 rounded-r-[var(--radius-input)] bg-transparent px-3 text-ink outline-none disabled:cursor-not-allowed", size === "lg" ? "text-[16px]" : "text-[14px]")}
        />
        {name && <input type="hidden" name={name} value={e164 ?? ""} />}
      </div>
      {showMessage && (
        <p id={errorId} role="alert" className="text-body-sm font-semibold text-danger-text">
          {validationMessage}
        </p>
      )}
    </div>
  );
}
