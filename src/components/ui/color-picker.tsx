// OWNER: foundation-ui.
//
// ColorPicker (ARCHITECTURE 20.2, SPEC ET-15): the 10 Calendly swatches as a radio group (arrow keys move and select,
// a check marks the selection) plus a "Custom" hex input validated on Enter or blur ("Enter a valid color like
// #8247F5"). The palette lives in ./event-colors.ts (server safe).
"use client";

import { Check } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { EVENT_COLORS, parseHexColor, type ColorSwatch } from "./event-colors";

export type ColorPickerProps = {
  value: string;
  onChange: (color: string) => void;
  swatches?: readonly ColorSwatch[];
  /** Show the "Custom" hex input (default true). */
  allowCustom?: boolean;
  disabled?: boolean;
  className?: string;
  /** Default "Event color". */
  "aria-label"?: string;
};

/** Relative luminance check: dark check marks on light swatches (lemon, yellow, sky). */
function isLight(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
}

export function ColorPicker({ value, onChange, swatches = EVENT_COLORS, allowCustom = true, disabled, className, ...aria }: ColorPickerProps) {
  const current = (value ?? "").toLowerCase();
  const isPreset = swatches.some((s) => s.value === current);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const selectedIndex = swatches.findIndex((s) => s.value === current);
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;
  const shownDraft = draft ?? (isPreset ? "" : value);

  const commit = () => {
    if (draft === null) return;
    if (draft.trim() === "") {
      setDraft(null);
      setError(null);
      return;
    }
    const parsed = parseHexColor(draft);
    if (parsed.ok) {
      setError(null);
      setDraft(null);
      onChange(parsed.value);
    } else {
      setError(parsed.error);
    }
  };

  const focusAndSelect = (i: number) => {
    const n = swatches.length;
    const idx = ((i % n) + n) % n;
    refs.current[idx]?.focus();
    onChange(swatches[idx]!.value);
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div role="radiogroup" aria-label={aria["aria-label"] ?? "Event color"} className="flex flex-wrap items-center gap-2.5">
        {swatches.map((s, i) => {
          const selected = current === s.value;
          return (
            <button
              key={s.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={s.name}
              title={s.name}
              tabIndex={i === tabStop ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(s.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  focusAndSelect(i + 1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  focusAndSelect(i - 1);
                }
              }}
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-full transition-transform duration-100 hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50",
                selected && "ring-2 ring-ink ring-offset-2 ring-offset-white",
              )}
              style={{ backgroundColor: s.value }}
            >
              {selected && <Check aria-hidden="true" strokeWidth={3} className={cn("size-4", isLight(s.value) ? "text-[#0a2540]" : "text-white")} />}
            </button>
          );
        })}
      </div>
      {allowCustom && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${base}-custom`} className="text-label text-ink">
            Custom
          </label>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="size-8 shrink-0 rounded-full border border-line"
              style={{ backgroundColor: parseHexColor(shownDraft || current).ok ? (parseHexColor(shownDraft || current) as { value: string }).value : "transparent" }}
            />
            <input
              id={`${base}-custom`}
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              value={shownDraft}
              placeholder="#8247F5"
              disabled={disabled}
              maxLength={7}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${base}-error` : undefined}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
              }}
              className={cn(
                "h-10 w-32 rounded-[var(--radius-input)] border border-line bg-white px-3 font-mono text-[14px] text-ink uppercase hover:border-ink-2 focus:border-primary",
                error && "border-danger hover:border-danger",
              )}
            />
          </div>
          {error && (
            <p id={`${base}-error`} role="alert" className="text-body-sm font-semibold text-danger-text">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
