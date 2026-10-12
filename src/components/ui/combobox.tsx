// OWNER: foundation-ui.
//
// Combobox (ARCHITECTURE 20.2): a select-like trigger that opens a searchable listbox (WAI-ARIA combobox with a popup
// listbox: the search input owns aria-activedescendant; ArrowUp/ArrowDown, Home/End, Enter and Escape work). Options
// are filtered locally by label, value, description, group and keywords, or by the caller via onQueryChange (server
// search). Grouped options render under group headings.
"use client";

import * as RadixPopover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { filterOptions, groupOptions } from "./combobox-utils";
import { FIELD_BASE } from "./input";
import { Spinner } from "./spinner";

export type ComboboxOption = { value: string; label: string; description?: string; group?: string; disabled?: boolean; keywords?: string[] };

export type ComboboxProps = {
  value: string | null;
  onChange: (value: string | null) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  /** Shown when nothing matches (default "No results"). */
  emptyText?: string;
  /** Server search: called with the query instead of filtering locally. */
  onQueryChange?: (query: string) => void;
  loading?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  renderOption?: (option: ComboboxOption) => React.ReactNode;
  /** Trigger content for the selected value (default: the option label). */
  renderValue?: (option: ComboboxOption | null) => React.ReactNode;
  size?: "md" | "lg";
  "aria-describedby"?: string;
  /** Classes for the popup (width, max height). */
  contentClassName?: string;
  /** Content above the list inside the popup (for example the am/pm and 24h toggle). */
  header?: React.ReactNode;
  /** A custom trigger element (rendered with asChild) instead of the field-style button. */
  trigger?: React.ReactElement;
  align?: "start" | "center" | "end";
};

export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results",
  onQueryChange,
  loading,
  disabled,
  invalid,
  id,
  className,
  renderOption,
  renderValue,
  size = "md",
  contentClassName,
  header,
  trigger,
  align = "start",
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const listId = `${baseId}-listbox`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const selected = options.find((o) => o.value === value) ?? null;
  const lastSelected = useRef<ComboboxOption | null>(selected);
  if (selected) lastSelected.current = selected;
  const shownSelected = selected ?? (value !== null && lastSelected.current?.value === value ? lastSelected.current : null);

  const visible = useMemo(() => (onQueryChange ? options : filterOptions(options, query)), [options, query, onQueryChange]);
  const groups = useMemo(() => groupOptions(visible), [visible]);
  const flat = useMemo(() => groups.flatMap((g) => g.options), [groups]);

  const firstEnabled = (from = 0, dir: 1 | -1 = 1) => {
    for (let i = from; i >= 0 && i < flat.length; i += dir) if (!flat[i]?.disabled) return i;
    return -1;
  };

  useEffect(() => {
    if (!open) return;
    const el = active >= 0 ? document.getElementById(optionId(active)) : null;
    el?.scrollIntoView({ block: "nearest" });
    // optionId is derived from baseId, stable for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open]);

  const openWith = (next: boolean) => {
    setOpen(next);
    if (next) {
      const idx = flat.findIndex((o) => o.value === value);
      setActive(idx >= 0 ? idx : firstEnabled());
    } else {
      setQuery("");
      if (onQueryChange && query) onQueryChange("");
    }
  };

  const choose = (o: ComboboxOption) => {
    if (o.disabled) return;
    lastSelected.current = o;
    onChange(o.value);
    openWith(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = firstEnabled(active + 1, 1);
      if (next >= 0) setActive(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = firstEnabled(Math.max(active - 1, 0), -1);
      if (prev >= 0) setActive(prev);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(firstEnabled(0, 1));
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(firstEnabled(flat.length - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = flat[active];
      if (o) choose(o);
    }
  };

  const triggerContent = renderValue ? renderValue(shownSelected) : shownSelected ? shownSelected.label : <span className="text-ink-2">{placeholder}</span>;

  let index = -1;
  return (
    <RadixPopover.Root open={open} onOpenChange={openWith}>
      <RadixPopover.Trigger asChild disabled={disabled}>
        {trigger ?? (
          <button
            type="button"
            id={id}
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-invalid={invalid || undefined}
            {...aria}
            className={cn(
              FIELD_BASE,
              "inline-flex items-center justify-between gap-2 text-left",
              size === "lg" ? "h-[46px] px-4 text-[16px]" : "h-10 px-3 text-[14px]",
              open && "border-primary",
              className,
            )}
          >
            <span className="min-w-0 flex-1 truncate">{triggerContent}</span>
            <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-ink-2 transition-transform", open && "rotate-180")} />
          </button>
        )}
      </RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          align={align}
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>("input[role=combobox]")?.focus();
          }}
          className={cn(
            "z-50 flex w-[var(--radix-popover-trigger-width)] min-w-64 max-w-[calc(100vw-16px)] flex-col overflow-hidden",
            "rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-pop)] data-[state=open]:animate-pop-in",
            contentClassName,
          )}
        >
          <div className="border-b border-line p-2">
            <div className="flex h-10 items-center gap-2 rounded-[var(--radius-input)] border border-line px-3 focus-within:border-primary">
              <Search aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
              <input
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={active >= 0 ? optionId(active) : undefined}
                aria-label={searchPlaceholder.replace(/\.\.\.$/, "") || "Search"}
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={query}
                placeholder={searchPlaceholder}
                onChange={(e) => {
                  setQuery(e.target.value);
                  onQueryChange?.(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none"
              />
              {loading && <Spinner size="sm" label="Searching" />}
            </div>
          </div>
          {header}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={aria["aria-label"] ?? "Options"}
            className="scrollbar-thin max-h-72 overflow-y-auto overscroll-contain p-1"
          >
            {flat.length === 0 && (
              <li role="presentation" className="px-3 py-6 text-center text-body-md text-ink-2">
                {loading ? "Searching..." : emptyText}
              </li>
            )}
            {groups.map((g) => (
              <li key={g.group ?? "__none"} role="presentation">
                {g.group && <div className="px-3 pt-3 pb-1 text-eyebrow text-ink-2" aria-hidden="true">{g.group}</div>}
                <ul role="group" aria-label={g.group ?? undefined}>
                  {g.options.map((o) => {
                    index += 1;
                    const i = index;
                    const isSelected = o.value === value;
                    return (
                      <li
                        key={o.value}
                        id={optionId(i)}
                        role="option"
                        aria-selected={isSelected}
                        aria-disabled={o.disabled || undefined}
                        onMouseMove={() => !o.disabled && active !== i && setActive(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(o)}
                        className={cn(
                          "relative flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-[6px] py-2 pr-9 pl-3 text-[14px] text-ink",
                          i === active && "bg-primary-soft",
                          isSelected && "font-semibold",
                          o.disabled && "cursor-not-allowed text-ink-3",
                        )}
                      >
                        {renderOption ? (
                          renderOption(o)
                        ) : (
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate">{o.label}</span>
                            {o.description && <span className="text-body-sm font-normal text-ink-2">{o.description}</span>}
                          </span>
                        )}
                        {isSelected && <Check aria-hidden="true" className="absolute right-3 size-4 text-primary" />}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
