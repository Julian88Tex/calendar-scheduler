// OWNER: foundation-ui.
//
// RichTextEditor (ARCHITECTURE 20.2): a contentEditable editor with a toolbar (bold, italic, underline, bulleted and
// numbered lists, link) and "+ Variables" chips (NT-07) inserted as non-editable pills. Emits sanitized HTML (variable
// chips as <span data-variable="key" class="variable">{{key}}</span>) and plain text ("{{key}}" for chips); servers
// sanitize again with sanitizeRichText. Paste is sanitized; Ctrl/Cmd+B, I, U and K work; an optional plain-text
// maxLength shows a counter and blocks further typing.
"use client";

import { Bold, Braces, Italic, Link2, List, ListOrdered, Underline } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";
import * as RadixPopover from "@radix-ui/react-popover";
import { chipifyVariables, editorHtmlToText, escapeText, normalizeChipText, normalizeLink, sanitizeEditorHtml } from "./rich-text-utils";

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

const ALL_TOOLS: RichTextTool[] = ["bold", "italic", "underline", "bulletList", "orderedList", "link"];

const TOOL_META: Record<RichTextTool, { label: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; command?: string; shortcut?: string }> = {
  bold: { label: "Bold", icon: Bold, command: "bold", shortcut: "B" },
  italic: { label: "Italic", icon: Italic, command: "italic", shortcut: "I" },
  underline: { label: "Underline", icon: Underline, command: "underline", shortcut: "U" },
  bulletList: { label: "Bulleted list", icon: List, command: "insertUnorderedList" },
  orderedList: { label: "Numbered list", icon: ListOrdered, command: "insertOrderedList" },
  link: { label: "Link", icon: Link2, shortcut: "K" },
};

const CHIP_CLASS =
  "variable mx-0.5 inline-flex items-center rounded-full bg-primary-soft-2 px-2 py-px align-baseline text-[13px] font-semibold text-primary-text select-all";

function toDisplayHtml(html: string, variables: { key: string; label: string }[]): string {
  const labels = new Map(variables.map((v) => [v.key, v.label]));
  const clean = chipifyVariables(sanitizeEditorHtml(html), [...labels.keys()]);
  return clean.replace(/<span data-variable="([^"]+)" class="variable">[\s\S]*?<\/span>/g, (_m, key: string) => {
    const label = labels.get(key) ?? key.replace(/[_.]/g, " ");
    return `<span data-variable="${key}" class="${CHIP_CLASS}" contenteditable="false">${escapeText(label)}</span>`;
  });
}

function chipNode(key: string, label: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.setAttribute("data-variable", key);
  span.setAttribute("contenteditable", "false");
  span.className = CHIP_CLASS;
  span.textContent = label;
  return span;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  variables,
  maxLength,
  toolbar = ALL_TOOLS,
  minHeight = 120,
  invalid,
  disabled,
  id,
  className,
  ...aria
}: RichTextEditorProps) {
  const base = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const editorId = id ?? `${base}-editor`;
  const vars = variables ?? [];
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef<string>(value);
  const savedRange = useRef<Range | null>(null);
  const [initialHtml] = useState(() => toDisplayHtml(value, vars));
  const [empty, setEmpty] = useState(() => sanitizeEditorHtml(value) === "");
  const [length, setLength] = useState(() => editorHtmlToText(value).length);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = normalizeChipText(sanitizeEditorHtml(el.innerHTML));
    const text = editorHtmlToText(html);
    setEmpty(html === "");
    setLength(text.length);
    lastEmitted.current = html;
    onChange({ html, text });
  }, [onChange]);

  // External value changes (form reset, template applied) replace the content.
  useEffect(() => {
    const el = editorRef.current;
    if (!el || value === lastEmitted.current) return;
    el.innerHTML = toDisplayHtml(value, vars);
    lastEmitted.current = value;
    setEmpty(sanitizeEditorHtml(value) === "");
    setLength(editorHtmlToText(value).length);
    // vars only matter together with a new value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      // older engines: <div> paragraphs are normalized by the sanitizer
    }
    const onSelection = () => {
      const el = editorRef.current;
      const sel = window.getSelection();
      if (!el || !sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return;
      savedRange.current = sel.getRangeAt(0).cloneRange();
      const state: Record<string, boolean> = {};
      for (const tool of ALL_TOOLS) {
        const cmd = TOOL_META[tool].command;
        if (cmd) {
          try {
            state[tool] = document.queryCommandState(cmd);
          } catch {
            state[tool] = false;
          }
        }
      }
      let node: Node | null = sel.anchorNode;
      state.link = false;
      while (node && node !== el) {
        if (node.nodeName === "A") state.link = true;
        node = node.parentNode;
      }
      setActive(state);
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, []);

  const restoreSelection = () => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel && savedRange.current && el.contains(savedRange.current.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    } else if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const run = (tool: RichTextTool) => {
    if (disabled) return;
    if (tool === "link") {
      openLink();
      return;
    }
    restoreSelection();
    document.execCommand(TOOL_META[tool].command!, false);
    emit();
  };

  const openLink = () => {
    const sel = window.getSelection();
    let href = "";
    let node: Node | null = sel?.anchorNode ?? null;
    while (node && node !== editorRef.current) {
      if (node instanceof HTMLAnchorElement) href = node.getAttribute("href") ?? "";
      node = node.parentNode;
    }
    setLinkText(href);
    setLinkError(null);
    setLinkOpen(true);
  };

  const applyLink = () => {
    const url = normalizeLink(linkText);
    if (!url) {
      setLinkError("Enter a valid link, like https://example.com.");
      return;
    }
    restoreSelection();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && sel.getRangeAt(0).collapsed) {
      const a = document.createElement("a");
      a.href = url;
      a.textContent = url.replace(/^mailto:/, "");
      const range = sel.getRangeAt(0);
      range.insertNode(a);
      range.setStartAfter(a);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      document.execCommand("createLink", false, url);
    }
    setLinkOpen(false);
    emit();
  };

  const removeLink = () => {
    restoreSelection();
    document.execCommand("unlink", false);
    setLinkOpen(false);
    emit();
  };

  const insertVariable = (v: { key: string; label: string }) => {
    if (disabled) return;
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const chip = chipNode(v.key, v.label);
    const space = document.createTextNode(" ");
    range.insertNode(space);
    range.insertNode(chip);
    range.setStartAfter(space);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    emit();
  };

  const toolButtons = toolbar.map((tool) => ({ tool, ...TOOL_META[tool] }));
  const over = maxLength !== undefined && length > maxLength;
  const counterId = maxLength ? `${base}-count` : undefined;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-[var(--radius-input)] border border-line bg-white transition-colors",
        "hover:border-ink-2 focus-within:border-primary focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus",
        (invalid || over) && "border-danger hover:border-danger",
        disabled && "bg-pebble",
        className,
      )}
    >
      <div
        role="toolbar"
        aria-label="Formatting"
        aria-controls={editorId}
        className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1"
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
          const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (i === -1) return;
          e.preventDefault();
          buttons[(i + (e.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]?.focus();
        }}
      >
        {toolButtons.map(({ tool, label, icon: Icon, shortcut }) => {
          const button = (
            <button
              key={tool}
              type="button"
              aria-label={shortcut ? `${label} (Ctrl+${shortcut})` : label}
              aria-pressed={tool === "link" ? undefined : Boolean(active[tool])}
              title={label}
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(tool)}
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-[6px] text-ink-2 transition-colors hover:bg-primary-soft hover:text-primary-text disabled:cursor-not-allowed disabled:opacity-50",
                active[tool] && "bg-primary-soft text-primary-text",
              )}
            >
              <Icon aria-hidden className="size-4" />
            </button>
          );
          if (tool !== "link") return button;
          return (
            <RadixPopover.Root key={tool} open={linkOpen} onOpenChange={setLinkOpen}>
              <RadixPopover.Anchor asChild>{button}</RadixPopover.Anchor>
              <RadixPopover.Portal>
                <RadixPopover.Content
                  align="start"
                  sideOffset={6}
                  collisionPadding={8}
                  className="z-50 w-[min(320px,calc(100vw-16px))] rounded-[var(--radius-card)] border border-line bg-white p-3 shadow-[var(--shadow-pop)]"
                >
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      applyLink();
                    }}
                    className="flex flex-col gap-2"
                  >
                    <label htmlFor={`${base}-link`} className="text-label text-ink">
                      Link URL
                    </label>
                    <input
                      id={`${base}-link`}
                      autoFocus
                      type="text"
                      inputMode="url"
                      value={linkText}
                      placeholder="https://example.com"
                      aria-invalid={linkError ? true : undefined}
                      aria-describedby={linkError ? `${base}-link-error` : undefined}
                      onChange={(e) => {
                        setLinkText(e.target.value);
                        setLinkError(null);
                      }}
                      className="h-10 rounded-[var(--radius-input)] border border-line px-3 text-[14px] text-ink hover:border-ink-2 focus:border-primary aria-[invalid=true]:border-danger"
                    />
                    {linkError && (
                      <p id={`${base}-link-error`} role="alert" className="text-body-sm font-semibold text-danger-text">
                        {linkError}
                      </p>
                    )}
                    <div className="flex justify-end gap-2">
                      {active.link && (
                        <Button variant="tertiary" size="sm" onClick={removeLink}>
                          Remove link
                        </Button>
                      )}
                      <Button type="submit" size="sm">
                        Apply
                      </Button>
                    </div>
                  </form>
                </RadixPopover.Content>
              </RadixPopover.Portal>
            </RadixPopover.Root>
          );
        })}
        {vars.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-primary-text hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Braces aria-hidden="true" className="size-4" />
              Variables
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={(e) => e.preventDefault()} className="max-h-72">
              {vars.map((v) => (
                <DropdownMenuItem key={v.key} onSelect={() => insertVariable(v)}>
                  {v.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="relative min-w-0">
        {empty && placeholder && (
          <span aria-hidden="true" className="pointer-events-none absolute top-2.5 left-3 text-[14px] text-ink-2 select-none">
            {placeholder}
          </span>
        )}
        <div
          ref={editorRef}
          id={editorId}
          role="textbox"
          aria-multiline="true"
          aria-placeholder={placeholder}
          aria-invalid={invalid || over || undefined}
          aria-disabled={disabled || undefined}
          aria-label={aria["aria-label"]}
          aria-labelledby={aria["aria-labelledby"]}
          aria-describedby={[aria["aria-describedby"], counterId].filter(Boolean).join(" ") || undefined}
          contentEditable={!disabled}
          suppressContentEditableWarning
          spellCheck
          style={{ minHeight }}
          dangerouslySetInnerHTML={{ __html: initialHtml }}
          onInput={emit}
          onBlur={emit}
          onBeforeInput={(e) => {
            const native = e.nativeEvent as InputEvent;
            if (maxLength !== undefined && length >= maxLength && native.inputType?.startsWith("insert") && native.inputType !== "insertParagraph") {
              e.preventDefault();
            }
          }}
          onKeyDown={(e) => {
            if (!(e.metaKey || e.ctrlKey)) return;
            const key = e.key.toLowerCase();
            if (key === "k" && toolbar.includes("link")) {
              e.preventDefault();
              openLink();
            } else if ((key === "b" && !toolbar.includes("bold")) || (key === "i" && !toolbar.includes("italic")) || (key === "u" && !toolbar.includes("underline"))) {
              e.preventDefault();
            } else if (key === "b" || key === "i" || key === "u") {
              window.setTimeout(emit, 0);
            }
          }}
          onPaste={(e) => {
            e.preventDefault();
            const html = e.clipboardData.getData("text/html");
            const text = e.clipboardData.getData("text/plain");
            const clean = html
              ? sanitizeEditorHtml(html)
              : escapeText(text)
                  .split(/\r?\n\r?\n/)
                  .map((p) => p.replace(/\r?\n/g, "<br>"))
                  .join("</p><p>");
            const display = toDisplayHtml(html ? clean : `<p>${clean}</p>`, vars);
            document.execCommand("insertHTML", false, display);
            emit();
          }}
          className={cn(
            "min-w-0 px-3 py-2.5 text-[14px] leading-[1.5] text-ink outline-none",
            "[&_a]:text-primary-text [&_a]:underline [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:min-h-[1.5em] [&_ul]:list-disc [&_ul]:pl-6 [&>*+*]:mt-2",
            disabled && "cursor-not-allowed text-ink-2",
          )}
        />
      </div>
      {maxLength !== undefined && (
        <p id={counterId} className={cn("border-t border-line px-3 py-1 text-right text-body-sm", over ? "font-semibold text-danger-text" : "text-ink-2")}>
          {length}/{maxLength}
        </p>
      )}
    </div>
  );
}
