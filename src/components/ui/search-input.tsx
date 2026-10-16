// OWNER: foundation-ui.
//
// SearchInput (ARCHITECTURE 20.2): a search field with a magnifier, a "Clear search" button, Escape to clear and a
// debounced onSearch (default 300 ms); Enter searches immediately.
"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export type SearchInputProps = {
  value?: string;
  defaultValue?: string;
  /** Called after the user stops typing (debounced). */
  onSearch?: (value: string) => void;
  /** Called on every keystroke. */
  onValueChange?: (value: string) => void;
  debounceMs?: number;
  placeholder?: string;
  /** Default "Search". */
  "aria-label"?: string;
  name?: string;
  autoFocus?: boolean;
  className?: string;
  id?: string;
};

export function SearchInput({ value, defaultValue, onSearch, onValueChange, debounceMs = 300, placeholder = "Search", name, autoFocus, className, id, ...aria }: SearchInputProps) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const update = (v: string, immediate = false) => {
    if (value === undefined) setInner(v);
    onValueChange?.(v);
    if (timer.current) clearTimeout(timer.current);
    if (immediate) onSearch?.(v);
    else timer.current = setTimeout(() => onSearch?.(v), debounceMs);
  };
  return (
    <div
      className={cn(
        "flex h-10 w-full min-w-0 items-center gap-2 rounded-[var(--radius-input)] border border-line bg-white px-3 transition-colors",
        "hover:border-ink-2 focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus",
        className,
      )}
    >
      <Search aria-hidden="true" className="size-4 shrink-0 text-ink-2" />
      <input
        ref={inputRef}
        id={id}
        type="search"
        name={name}
        autoFocus={autoFocus}
        value={current}
        placeholder={placeholder}
        aria-label={aria["aria-label"] ?? "Search"}
        autoComplete="off"
        onChange={(e) => update(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && current) {
            e.preventDefault();
            update("", true);
          } else if (e.key === "Enter") {
            e.preventDefault();
            update(current, true);
          }
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none"
      />
      {current && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            update("", true);
            inputRef.current?.focus();
          }}
          className="-mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-primary-soft hover:text-primary-text"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      )}
    </div>
  );
}
