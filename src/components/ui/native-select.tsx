// OWNER: foundation-ui.
//
// NativeSelect (ARCHITECTURE 20.2): a styled native <select> with the field chrome and a chevron (best on phones, for
// long static lists and inside plain HTML forms). Server and client safe.
import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { FIELD_BASE } from "./input";

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
    <span className={cn("relative inline-flex w-full min-w-0", className)}>
      <select
        aria-invalid={invalid || rest["aria-invalid"] || undefined}
        className={cn(
          FIELD_BASE,
          "appearance-none truncate pr-9",
          size === "lg" ? "h-[46px] pl-4 text-[16px]" : "h-10 pl-3 text-[14px]",
        )}
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
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-2" />
    </span>
  );
}
