// OWNER: foundation-ui.
//
// Textarea (ARCHITECTURE 20.2): the field chrome of Input, optional auto-grow and a live "{length}/{maxLength}"
// counter (announced politely). The ref is forwarded to the <textarea>.
"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { FIELD_BASE } from "./input";

export type TextareaProps = React.ComponentProps<"textarea"> & {
  invalid?: boolean;
  /** Grow with the content (foundation-ui). */
  autoResize?: boolean;
  /** Shows "{length}/{maxLength}" below the field (requires maxLength). */
  showCount?: boolean;
};

function assignRef<T>(ref: React.Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref && typeof ref === "object") (ref as React.RefObject<T | null>).current = value;
}

export function Textarea({ invalid, autoResize, showCount, className, maxLength, value, defaultValue, onChange, ref, id, ...rest }: TextareaProps) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  const [uncontrolledLength, setUncontrolledLength] = useState(() => String(defaultValue ?? "").length);
  const length = value !== undefined ? String(value ?? "").length : uncontrolledLength;
  const counterId = showCount && maxLength && id ? `${id}-count` : undefined;

  const resize = useCallback(() => {
    const el = inner.current;
    if (!el || !autoResize) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [autoResize]);

  useLayoutEffect(() => {
    resize();
  }, [resize, value]);

  return (
    <div className="w-full">
      <textarea
        {...rest}
        id={id}
        ref={(el) => {
          inner.current = el;
          assignRef(ref, el);
        }}
        aria-invalid={invalid || rest["aria-invalid"] || undefined}
        aria-describedby={[rest["aria-describedby"], counterId].filter(Boolean).join(" ") || undefined}
        maxLength={maxLength}
        value={value}
        defaultValue={defaultValue}
        onChange={(e) => {
          if (value === undefined) setUncontrolledLength(e.target.value.length);
          resize();
          onChange?.(e);
        }}
        className={cn(FIELD_BASE, "block min-h-24 px-3 py-2.5 text-[14px] leading-[1.45]", autoResize ? "resize-none overflow-hidden" : "resize-y", className)}
      />
      {showCount && maxLength ? (
        <p id={counterId} className={cn("mt-1 text-right text-body-sm", length >= maxLength ? "text-danger-text" : "text-ink-2")} aria-live="polite">
          {length}/{maxLength}
        </p>
      ) : null}
    </div>
  );
}
