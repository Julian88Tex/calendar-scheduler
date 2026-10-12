// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Combobox (ARCHITECTURE 20.2): a searchable listbox. Options are filtered by label (or onQueryChange for server
// search). Foundation stub: a search input above a native listbox select.
"use client";

import { useId, useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";

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
};

export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder = "Search...",
  emptyText = "No results",
  onQueryChange,
  loading,
  disabled,
  invalid,
  id,
  className,
  ...aria
}: ComboboxProps) {
  const [query, setQuery] = useState("");
  const listId = useId();
  const q = query.trim().toLowerCase();
  const visible = onQueryChange || !q
    ? options
    : options.filter((o) => [o.label, o.value, ...(o.keywords ?? [])].some((s) => s.toLowerCase().includes(q)));
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <input
        type="search"
        value={query}
        disabled={disabled}
        placeholder={searchPlaceholder}
        aria-controls={listId}
        aria-label={aria["aria-label"] ? `${aria["aria-label"]} search` : "Search"}
        onChange={(e) => {
          setQuery(e.target.value);
          onQueryChange?.(e.target.value);
        }}
        className="h-10 rounded-[var(--radius-input)] border border-line px-3 text-body-md"
      />
      <select
        id={id ?? listId}
        size={Math.min(Math.max(visible.length, 2), 8)}
        value={value ?? ""}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-busy={loading || undefined}
        onChange={(e) => onChange(e.target.value || null)}
        className="rounded-[var(--radius-input)] border border-line text-body-md"
        {...aria}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {visible.length === 0 && <option disabled>{emptyText}</option>}
        {visible.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
