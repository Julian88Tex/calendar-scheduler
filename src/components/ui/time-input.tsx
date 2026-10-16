// OWNER: foundation-ui.
//
// TimeInput (ARCHITECTURE 20.2): a typeable 15-minute combobox. Values are minutes from local midnight (0..1440). Type
// "9", "930", "9:30 pm" or "21:30" (parseTimeInput, ./time-input-utils.ts) or pick from the list (ArrowUp/ArrowDown,
// Enter, Escape). Unparseable or out-of-range input reverts to the last value on blur.
"use client";

import * as RadixPopover from "@radix-ui/react-popover";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { FIELD_BASE } from "./input";
import { formatMinutes, matchTimeOption, parseTimeInput, timeOptions } from "./time-input-utils";

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

export function TimeInput({
  value,
  onChange,
  stepMinutes = 15,
  min = 0,
  max = 1440,
  allowEndOfDay,
  hour12 = true,
  placeholder,
  invalid,
  disabled,
  id,
  className,
  ...aria
}: TimeInputProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const listId = `${base}-list`;
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const options = useMemo(() => timeOptions({ step: stepMinutes, min, max, allowEndOfDay }), [stepMinutes, min, max, allowEndOfDay]);
  const shown = text ?? (value === null ? "" : formatMinutes(value, hour12));
  const optionId = (m: number) => `${base}-opt-${m}`;

  useEffect(() => {
    if (!open || active === null) return;
    document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
    // optionId depends only on the stable base id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active]);

  const openList = () => {
    if (disabled) return;
    setOpen(true);
    setActive(value !== null && options.includes(value) ? value : (options.find((o) => o >= (value ?? 540)) ?? options[0] ?? null));
  };

  const commitText = () => {
    if (text === null) return;
    const trimmed = text.trim();
    setText(null);
    if (trimmed === "") {
      if (value !== null) onChange(null);
      return;
    }
    const parsed = parseTimeInput(trimmed);
    if (parsed !== null && parsed >= min && parsed <= max && (parsed !== 1440 || allowEndOfDay)) {
      if (parsed !== value) onChange(parsed);
    }
  };

  const choose = (m: number) => {
    setText(null);
    setOpen(false);
    if (m !== value) onChange(m);
    inputRef.current?.focus();
  };

  const move = (dir: 1 | -1) => {
    if (!open) {
      openList();
      return;
    }
    const idx = active === null ? -1 : options.indexOf(active);
    const next = options[Math.max(0, Math.min(options.length - 1, idx + dir))];
    if (next !== undefined) setActive(next);
  };

  return (
    <RadixPopover.Root open={open} onOpenChange={(v) => (v ? openList() : setOpen(false))}>
      <RadixPopover.Anchor asChild>
        <input
          ref={inputRef}
          id={id}
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active !== null ? optionId(active) : undefined}
          value={shown}
          placeholder={placeholder ?? (hour12 ? "9:00am" : "09:00")}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          onFocus={(e) => e.currentTarget.select()}
          onClick={() => !open && openList()}
          onChange={(e) => {
            setText(e.target.value);
            if (!open) setOpen(true);
            const match = matchTimeOption(e.target.value, options, hour12);
            if (match !== null) setActive(match);
          }}
          onBlur={() => {
            commitText();
            setOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            } else if (e.key === "Enter") {
              if (open && active !== null && (text === null || matchTimeOption(text, options, hour12) === active)) {
                e.preventDefault();
                choose(active);
              } else if (text !== null) {
                e.preventDefault();
                commitText();
                setOpen(false);
              }
            } else if (e.key === "Escape") {
              if (open || text !== null) {
                e.preventDefault();
                e.stopPropagation();
                setText(null);
                setOpen(false);
              }
            }
          }}
          className={cn(FIELD_BASE, "h-10 w-28 px-3 text-[14px] tabular-nums", className)}
          {...aria}
        />
      </RadixPopover.Anchor>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align="start"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (e.target === inputRef.current) e.preventDefault();
          }}
          className="z-50 w-[var(--radix-popover-trigger-width)] min-w-32 overflow-hidden rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-pop)]"
        >
          <ul id={listId} role="listbox" aria-label={aria["aria-label"] ?? "Times"} className="scrollbar-thin max-h-60 overflow-y-auto p-1">
            {options.map((m) => (
              <li
                key={m}
                id={optionId(m)}
                role="option"
                aria-selected={m === value}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => active !== m && setActive(m)}
                onClick={() => choose(m)}
                className={cn(
                  "flex h-9 cursor-pointer items-center rounded-[6px] px-3 text-[14px] text-ink tabular-nums",
                  m === active && "bg-primary-soft",
                  m === value && "font-semibold text-primary-text",
                )}
              >
                {formatMinutes(m, hour12)}
              </li>
            ))}
          </ul>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
