// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// NativeSelect (ARCHITECTURE 20.2): a styled native <select> (best on phones and for long static lists).
import type * as React from "react";
import { cn } from "@/lib/cn";

export type NativeSelectOption = { value: string; label: string; disabled?: boolean };

export type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  options?: NativeSelectOption[];
  /** First, empty option. */
  placeholder?: string;
  size?: "md" | "lg";
  invalid?: boolean;
};

export function NativeSelect({ options, placeholder, size = "md", invalid, className, children, ...rest }: NativeSelectProps) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cn("w-full rounded-[var(--radius-input)] border border-line bg-white px-3 text-body-md", size === "lg" ? "h-[46px]" : "h-10", className)}
      {...rest}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options?.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </option>
      ))}
      {children}
    </select>
  );
}
