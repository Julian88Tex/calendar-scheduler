// OWNER: foundation-ui.
//
// Select (ARCHITECTURE 20.2, walkthrough 1.5, Radix Select): looks like an input with a chevron; the menu is a white
// popover (8px radius, 1px border, pop shadow) with 40px rows, #F4F8FF highlight and a blue check on the selected
// option. Options or option groups; an option whose value is "" is supported (mapped to an internal sentinel because
// Radix reserves the empty string for "no selection").
"use client";

import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { FIELD_BASE } from "./input";

export type SelectOption = { value: string; label: React.ReactNode; disabled?: boolean; description?: React.ReactNode; textValue?: string };
export type SelectOptionGroup = { label: string; options: SelectOption[] };

export type SelectProps = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: (SelectOption | SelectOptionGroup)[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  invalid?: boolean;
  size?: "md" | "lg";
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  /** Classes for the menu (for example a minimum width). */
  contentClassName?: string;
};

const EMPTY = "__kairos_empty__";
const toRadix = (v: string | undefined) => (v === undefined ? undefined : v === "" ? EMPTY : v);
const fromRadix = (v: string) => (v === EMPTY ? "" : v);
const isGroup = (o: SelectOption | SelectOptionGroup): o is SelectOptionGroup => "options" in o;
const textOf = (o: SelectOption) => o.textValue ?? (typeof o.label === "string" ? o.label : o.value);

function Item({ option }: { option: SelectOption }) {
  return (
    <RadixSelect.Item
      value={toRadix(option.value) ?? EMPTY}
      disabled={option.disabled}
      textValue={textOf(option)}
      className={cn(
        "relative flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-[6px] py-2 pr-9 pl-3 text-[14px] text-ink outline-none",
        "data-[highlighted]:bg-primary-soft data-[state=checked]:font-semibold data-[disabled]:cursor-not-allowed data-[disabled]:text-ink-3",
      )}
    >
      <span className="flex min-w-0 flex-col">
        <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
        {option.description && <span className="text-body-sm font-normal text-ink-2">{option.description}</span>}
      </span>
      <RadixSelect.ItemIndicator className="absolute right-3 inline-flex items-center text-primary">
        <Check aria-hidden="true" className="size-4" />
      </RadixSelect.ItemIndicator>
    </RadixSelect.Item>
  );
}

export function Select({
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder,
  disabled,
  required,
  name,
  id,
  invalid,
  size = "md",
  className,
  contentClassName,
  ...aria
}: SelectProps) {
  return (
    <RadixSelect.Root
      value={value === undefined ? undefined : value === "" && !hasEmptyOption(options) ? "" : toRadix(value)}
      defaultValue={defaultValue === "" && !hasEmptyOption(options) ? undefined : toRadix(defaultValue)}
      onValueChange={(v) => onValueChange?.(fromRadix(v))}
      disabled={disabled}
      required={required}
      name={name}
    >
      <RadixSelect.Trigger
        id={id}
        aria-invalid={invalid || undefined}
        {...aria}
        className={cn(
          FIELD_BASE,
          "inline-flex items-center justify-between gap-2 text-left data-[placeholder]:text-ink-2 data-[state=open]:border-primary",
          size === "lg" ? "h-[46px] px-4 text-[16px]" : "h-10 px-3 text-[14px]",
          className,
        )}
      >
        <span className="min-w-0 truncate">
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon className="shrink-0 text-ink-2">
          <ChevronDown aria-hidden="true" className="size-4" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className={cn(
            "z-50 max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] overflow-hidden",
            "rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-pop)] data-[state=open]:animate-pop-in",
            contentClassName,
          )}
        >
          <RadixSelect.ScrollUpButton className="flex h-6 items-center justify-center text-ink-2">
            <ChevronUp aria-hidden="true" className="size-4" />
          </RadixSelect.ScrollUpButton>
          <RadixSelect.Viewport className="p-1">
            {options.map((o, i) =>
              isGroup(o) ? (
                <RadixSelect.Group key={`${o.label}-${i}`}>
                  {i > 0 && <RadixSelect.Separator className="mx-2 my-1 h-px bg-line" />}
                  <RadixSelect.Label className="px-3 pt-2 pb-1 text-eyebrow text-ink-2">{o.label}</RadixSelect.Label>
                  {o.options.map((opt) => (
                    <Item key={opt.value} option={opt} />
                  ))}
                </RadixSelect.Group>
              ) : (
                <Item key={o.value} option={o} />
              ),
            )}
          </RadixSelect.Viewport>
          <RadixSelect.ScrollDownButton className="flex h-6 items-center justify-center text-ink-2">
            <ChevronDown aria-hidden="true" className="size-4" />
          </RadixSelect.ScrollDownButton>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}

function hasEmptyOption(options: (SelectOption | SelectOptionGroup)[]): boolean {
  return options.some((o) => (isGroup(o) ? o.options.some((x) => x.value === "") : o.value === ""));
}
