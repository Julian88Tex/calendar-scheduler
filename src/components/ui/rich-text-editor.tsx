// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// RichTextEditor (ARCHITECTURE 20.2): contentEditable based (bold, italic, underline, lists, link, variable chips);
// emits sanitized HTML and plain text (servers sanitize again with sanitizeRichText). Foundation stub: a textarea that
// emits escaped paragraphs as HTML.
"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

export type RichTextValue = { html: string; text: string };
export type RichTextTool = "bold" | "italic" | "underline" | "bulletList" | "orderedList" | "link";

export type RichTextEditorProps = {
  /** Current HTML. */
  value: string;
  onChange: (value: RichTextValue) => void;
  placeholder?: string;
  /** "+ Variables" chips inserted as {{key}} (NT-07). */
  variables?: { key: string; label: string }[];
  /** Plain text length limit. */
  maxLength?: number;
  toolbar?: RichTextTool[];
  minHeight?: number;
  invalid?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
};

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function plainToParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function RichTextEditor({ value, onChange, placeholder, variables, maxLength, minHeight = 120, invalid, disabled, id, className, ...aria }: RichTextEditorProps) {
  const [text, setText] = useState(() => htmlToPlain(value));
  const update = (next: string) => {
    setText(next);
    onChange({ html: next.trim() ? plainToParagraphs(next) : "", text: next });
  };
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {variables && variables.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="Variables">
          {variables.map((v) => (
            <button key={v.key} type="button" disabled={disabled} onClick={() => update(`${text}{{${v.key}}}`)} className="rounded-full bg-pebble px-2 text-body-sm">
              {v.label}
            </button>
          ))}
        </div>
      )}
      <textarea
        id={id}
        value={text}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        style={{ minHeight }}
        onChange={(e) => update(e.target.value)}
        className="w-full rounded-[var(--radius-input)] border border-line p-3 text-body-md"
        {...aria}
      />
    </div>
  );
}
