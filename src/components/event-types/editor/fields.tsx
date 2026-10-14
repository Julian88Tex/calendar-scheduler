// Small building blocks of the event type editor sections: a minutes select with presets and "Custom" (buffers ET-21,
// increments ET-23), the inline sentence dropdown button (ET-19), group headings and field error helpers. Client only.
"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import type * as React from "react";
import { FIELD_BASE } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { wholeNumberIn } from "@/lib/event-types/draft";
import type { EventTypeDraft } from "@/lib/event-types/types";
import { formatDuration } from "@/lib/time/format";

export type SectionErrors = Record<string, string[]>;

/** Errors under a dotted prefix with the prefix removed ("locations.0.location" -> "0.location"; the prefix itself -> ""). */
export function errorsUnder(errors: SectionErrors, prefix: string): SectionErrors {
  const out: SectionErrors = {};
  for (const [k, v] of Object.entries(errors)) {
    if (k === prefix) out[""] = v;
    else if (k.startsWith(`${prefix}.`)) out[k.slice(prefix.length + 1)] = v;
  }
  return out;
}

/** The first message of a key (or of any key under it). */
export function errorOf(errors: SectionErrors, key: string, deep = false): string | null {
  if (errors[key]?.[0]) return errors[key][0];
  if (!deep) return null;
  const hit = Object.entries(errors).find(([k]) => k.startsWith(`${key}.`));
  return hit?.[1][0] ?? null;
}

export type SectionProps = {
  draft: EventTypeDraft;
  update: (patch: Partial<EventTypeDraft>) => void;
  errors: SectionErrors;
  disabled: boolean;
};

/**
 * "0 min", "15 min", "1 hr", "1.5 hr", "2 hr", "1 hr 15 min" (Calendly's buffer and increment labels; "hr" is never
 * plural, as in formatDuration).
 */
export function minutesLabel(m: number): string {
  if (m < 60) return `${m} min`;
  const h = m / 60;
  if (Number.isInteger(h * 2)) return `${h} hr`;
  return formatDuration(m);
}

export type MinutesSelectProps = {
  value: number;
  onChange: (minutes: number) => void;
  presets: readonly number[];
  min: number;
  max: number;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  invalid?: boolean;
  className?: string;
};

/**
 * A preset dropdown with "Custom" revealing a minutes input. Out of range custom input shows the error and emits NaN, so
 * the draft fails validation on "Save changes" instead of silently keeping the last valid value.
 */
export function MinutesSelect({ value, onChange, presets, min, max, disabled, id, invalid, className, ...aria }: MinutesSelectProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const isPreset = presets.includes(value);
  const [custom, setCustom] = useState(!isPreset);
  const [text, setText] = useState<string | null>(null);
  const showCustom = custom || !isPreset;
  const shown = text ?? (Number.isFinite(value) ? String(value) : "");
  const bad = text !== null && wholeNumberIn(text, min, max) === null;
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-2", className)}>
      <Select
        id={id}
        value={showCustom ? "custom" : String(value)}
        disabled={disabled}
        invalid={invalid}
        aria-label={aria["aria-label"]}
        aria-describedby={aria["aria-describedby"]}
        className="min-w-[8.5rem] flex-1"
        onValueChange={(v) => {
          if (v === "custom") {
            setCustom(true);
            setText(null);
            return;
          }
          setCustom(false);
          setText(null);
          onChange(Number(v));
        }}
        options={[...presets.map((p) => ({ value: String(p), label: minutesLabel(p) })), { value: "custom", label: "Custom" }]}
      />
      {showCustom && (
        <span className="inline-flex items-center gap-2">
          <input
            id={`${base}-custom`}
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            value={shown}
            disabled={disabled}
            aria-label={`${aria["aria-label"] ?? "Minutes"} in minutes`}
            aria-invalid={bad || invalid ? true : undefined}
            onChange={(e) => {
              setText(e.target.value);
              onChange(wholeNumberIn(e.target.value, min, max) ?? Number.NaN);
            }}
            onBlur={() => {
              if (!bad) setText(null);
            }}
            className={cn(FIELD_BASE, "h-10 w-24 px-3 text-[14px]", (bad || invalid) && "border-danger")}
          />
          <span className="text-body-md text-ink-2">min</span>
        </span>
      )}
      {bad && (
        <p role="alert" className="w-full text-body-sm font-semibold text-danger-text">
          Enter a number from {min} to {max}.
        </p>
      )}
    </div>
  );
}

/** The bold, underlined dropdown inside a sentence ("Invitees can schedule [60 days] into the future ..."). */
export function InlineDropdownButton({ children, className, ...rest }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-sm font-bold text-primary-text underline decoration-dotted underline-offset-4 hover:decoration-solid disabled:cursor-not-allowed disabled:text-ink disabled:no-underline",
        className,
      )}
    >
      {children}
      <ChevronDown aria-hidden="true" className="size-3.5" />
    </button>
  );
}

/** A labeled group inside a section. */
export function FieldGroup({ title, hint, children, className, id }: { title: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  const generated = `fg-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const headingId = id ?? generated;
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)} role="group" aria-labelledby={headingId}>
      <div className="flex flex-col gap-0.5">
        <h3 id={headingId} className="text-label text-ink">
          {title}
        </h3>
        {hint && <p className="text-body-sm text-ink-2">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
