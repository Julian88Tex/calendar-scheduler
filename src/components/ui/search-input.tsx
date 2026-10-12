// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// SearchInput (ARCHITECTURE 20.2): search field with a debounced onSearch (default 300 ms).
"use client";

import { Search } from "lucide-react";
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
};

export function SearchInput({ value, defaultValue, onSearch, onValueChange, debounceMs = 300, placeholder = "Search", name, autoFocus, className, ...aria }: SearchInputProps) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <div className={cn("flex h-10 items-center gap-2 rounded-[var(--radius-input)] border border-line bg-white px-3", className)}>
      <Search aria-hidden="true" className="size-4 text-ink-2" />
      <input
        type="search"
        name={name}
        autoFocus={autoFocus}
        value={current}
        placeholder={placeholder}
        aria-label={aria["aria-label"] ?? "Search"}
        onChange={(e) => {
          const v = e.target.value;
          if (value === undefined) setInner(v);
          onValueChange?.(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => onSearch?.(v), debounceMs);
        }}
        className="h-full flex-1 bg-transparent text-body-md outline-none"
      />
    </div>
  );
}
