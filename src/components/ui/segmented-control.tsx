// OWNER: foundation-ui.
//
// SegmentedControl (ARCHITECTURE 20.2): List/Calendar, am/pm | 24h. A radiogroup of pill segments with roving focus
// (ArrowLeft/ArrowRight/Home/End move and select, like native radios).
"use client";

import { useRef } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type SegmentedOption<T extends string> = { value: T; label: React.ReactNode; icon?: React.ReactNode; "aria-label"?: string; disabled?: boolean };

export type SegmentedControlProps<T extends string> = {
  value: T;
  onValueChange: (value: T) => void;
  options: SegmentedOption<T>[];
  "aria-label": string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
};

export function SegmentedControl<T extends string>({ value, onValueChange, options, size = "md", disabled, className, ...aria }: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.map((o, i) => (!disabled && !o.disabled ? i : -1)).filter((i) => i >= 0);
  const tabStop = options.some((o) => o.value === value) ? options.findIndex((o) => o.value === value) : (enabled[0] ?? 0);
  const move = (from: number, dir: 1 | -1 | "first" | "last") => {
    if (enabled.length === 0) return;
    let target: number;
    if (dir === "first") target = enabled[0]!;
    else if (dir === "last") target = enabled[enabled.length - 1]!;
    else {
      const pos = enabled.indexOf(from);
      target = enabled[(pos + (dir === 1 ? 1 : enabled.length - 1)) % enabled.length]!;
    }
    refs.current[target]?.focus();
    onValueChange(options[target]!.value);
  };
  return (
    <div role="radiogroup" className={cn("inline-flex items-center rounded-full border border-line bg-white p-0.5", className)} {...aria}>
      {options.map((o, i) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o["aria-label"]}
            tabIndex={i === tabStop ? 0 : -1}
            disabled={disabled || o.disabled}
            onClick={() => onValueChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, -1);
              } else if (e.key === "Home") {
                e.preventDefault();
                move(i, "first");
              } else if (e.key === "End") {
                e.preventDefault();
                move(i, "last");
              }
            }}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-full font-semibold whitespace-nowrap transition-colors duration-100 [&_svg]:size-4",
              size === "sm" ? "h-7 px-3 text-[12px]" : "h-8 px-4 text-[14px]",
              selected ? "bg-primary text-white" : "text-ink-2 hover:bg-primary-soft hover:text-primary-text",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
