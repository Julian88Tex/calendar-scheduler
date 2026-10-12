// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Switch (ARCHITECTURE 20.2): 36x20 toggle with optional On/Off state label. Foundation stub: a role="switch" button.
"use client";

import { useState } from "react";
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
};

export function Switch({ checked, defaultChecked, onCheckedChange, disabled, id, name, label, showStateLabel, size = "md", className, ...aria }: SwitchProps) {
  const [inner, setInner] = useState(defaultChecked ?? false);
  const on = checked ?? inner;
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => {
          if (checked === undefined) setInner(!on);
          onCheckedChange?.(!on);
        }}
        className={cn("relative inline-flex shrink-0 rounded-full transition-colors disabled:opacity-50", size === "sm" ? "h-4 w-7" : "h-5 w-9", on ? "bg-primary" : "bg-ink-3")}
        {...aria}
      >
        <span className={cn("absolute top-0.5 rounded-full bg-white transition-transform", size === "sm" ? "size-3" : "size-4", on ? "translate-x-[18px]" : "translate-x-0.5")} />
      </button>
      {name && <input type="hidden" name={name} value={on ? "on" : "off"} />}
      {showStateLabel && <span className="text-body-sm text-ink-2">{on ? "On" : "Off"}</span>}
      {label && (
        <label htmlFor={id} className="text-body-md">
          {label}
        </label>
      )}
    </span>
  );
}
