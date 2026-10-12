// OWNER: foundation-ui.
//
// Switch (ARCHITECTURE 20.2, walkthrough 1.5, Radix Switch): 36x20 track (#A6BBD1 off, #006BFF on) with a white knob,
// optional "On" / "Off" state label and a visible label (its accessible name). With `name` it submits "on" or "off".
"use client";

import * as RadixSwitch from "@radix-ui/react-switch";
import { useId, useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";

export type SwitchProps = {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  name?: string;
  /** Visible label next to the switch (also the accessible name). */
  label?: React.ReactNode;
  /** Shows "On" / "Off" next to the switch. */
  showStateLabel?: boolean;
  size?: "sm" | "md";
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  /** Put the label before the switch (settings rows). */
  labelPosition?: "start" | "end";
};

export function Switch({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  id,
  name,
  label,
  showStateLabel,
  size = "md",
  className,
  labelPosition = "end",
  ...aria
}: SwitchProps) {
  const generated = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const switchId = id ?? `sw-${generated}`;
  const [inner, setInner] = useState(defaultChecked ?? false);
  const on = checked ?? inner;
  const labelEl = label ? (
    <label htmlFor={switchId} className={cn("cursor-pointer text-[14px] leading-5 text-ink", disabled && "cursor-not-allowed text-ink-2")}>
      {label}
    </label>
  ) : null;
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {labelPosition === "start" && labelEl}
      <RadixSwitch.Root
        id={switchId}
        checked={on}
        disabled={disabled}
        onCheckedChange={(v) => {
          if (checked === undefined) setInner(v);
          onCheckedChange?.(v);
        }}
        {...aria}
        className={cn(
          "relative inline-flex shrink-0 items-center rounded-full transition-colors duration-150",
          "bg-ink-3 data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50",
          size === "sm" ? "h-4 w-7" : "h-5 w-9",
        )}
      >
        <RadixSwitch.Thumb
          className={cn(
            "pointer-events-none block rounded-full bg-white shadow-[0_1px_2px_rgba(10,37,64,0.3)] transition-transform duration-150",
            size === "sm" ? "size-3 translate-x-0.5 data-[state=checked]:translate-x-[14px]" : "size-4 translate-x-0.5 data-[state=checked]:translate-x-[18px]",
          )}
        />
      </RadixSwitch.Root>
      {name && <input type="hidden" name={name} value={on ? "on" : "off"} />}
      {showStateLabel && (
        <span aria-hidden="true" className="min-w-6 text-body-sm font-semibold text-ink-2">
          {on ? "On" : "Off"}
        </span>
      )}
      {labelPosition === "end" && labelEl}
    </span>
  );
}
