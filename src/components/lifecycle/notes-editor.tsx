// Meeting notes (SPEC CR-14; walkthrough 10.1 "Add meeting notes"): host-only rich text notes of a meeting, up to 10,000
// characters, with "Save". Never shown on invitee pages or emails (lifecycle-core strips them from every invitee
// view). Without notes the block is an "Add meeting notes" link; saved notes show with "Edit notes". Client component.
"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/form-field";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { toast } from "@/components/ui/toast";
import { saveMeetingNotesAction } from "./actions";
import { lt } from "./lib/t";

export const NOTES_MAX = 10_000;

export type NotesEditorProps = {
  scheduledEventId: string;
  /** Stored notes (sanitized HTML from the server), or null. */
  initialHtml: string | null;
  onSaved?: (html: string | null) => void;
  /** Open the editor right away (default: show the notes or the "Add meeting notes" link). */
  defaultEditing?: boolean;
};

/** True when HTML has no text (an emptied editor leaves "<p><br></p>"). */
function isBlank(html: string | null | undefined): boolean {
  return !html || !html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

export function NotesEditor({ scheduledEventId, initialHtml, onSaved, defaultEditing = false }: NotesEditorProps) {
  const base = `notes-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [saved, setSaved] = useState<string | null>(isBlank(initialHtml) ? null : initialHtml);
  const [editing, setEditing] = useState(defaultEditing);
  const [draft, setDraft] = useState(saved ?? "");
  const [length, setLength] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    if (length > NOTES_MAX) {
      setError(lt("host.notes.tooLong"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const html = isBlank(draft) ? "" : draft;
      const r = await saveMeetingNotesAction({ scheduledEventId, html });
      setBusy(false);
      if (!r.ok) {
        setError(r.error.fieldErrors?.html?.[0] ?? r.error.message);
        return;
      }
      // The stored notes (sanitized by the server), not the local draft.
      const next = isBlank(r.data.html) ? null : r.data.html;
      setSaved(next);
      setEditing(false);
      toast.success(lt("host.notes.saved"));
      onSaved?.(next);
    } catch {
      setBusy(false);
      setError(lt("errors.network"));
    }
  };

  if (!editing) {
    return (
      <section aria-labelledby={`${base}-label`} className="flex flex-col gap-2" data-testid="meeting-notes">
        <h3 id={`${base}-label`} className="text-[12px] font-bold tracking-[0.06em] text-ink-2 uppercase">
          {lt("host.notes.label")}
        </h3>
        {saved ? (
          <>
            <div
              className="text-body-md break-words text-ink [&_a]:text-primary-text [&_a]:underline [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_ul]:list-disc"
              data-testid="meeting-notes-html"
              dangerouslySetInnerHTML={{ __html: saved }}
            />
            <Button
              variant="tertiary"
              size="sm"
              className="self-start"
              onClick={() => {
                setDraft(saved);
                setEditing(true);
              }}
            >
              {lt("host.notes.edit")}
            </Button>
          </>
        ) : (
          <Button
            variant="tertiary"
            size="sm"
            className="self-start"
            onClick={() => {
              setDraft("");
              setEditing(true);
            }}
          >
            {lt("host.notes.add")}
          </Button>
        )}
      </section>
    );
  }

  const errorId = error ? `${base}-error` : undefined;
  return (
    <section aria-labelledby={`${base}-label`} className="flex flex-col gap-2" data-testid="meeting-notes">
      <h3 id={`${base}-label`} className="text-[12px] font-bold tracking-[0.06em] text-ink-2 uppercase">
        {lt("host.notes.label")}
      </h3>
      <RichTextEditor
        id={`${base}-editor`}
        aria-labelledby={`${base}-label`}
        aria-describedby={[`${base}-hint`, errorId].filter(Boolean).join(" ")}
        value={draft}
        onChange={(v) => {
          setDraft(v.html);
          setLength(v.text.length);
          if (error) setError(null);
        }}
        placeholder={lt("host.notes.placeholder")}
        maxLength={NOTES_MAX}
        toolbar={["bold", "italic", "underline", "bulletList", "orderedList", "link"]}
        minHeight={120}
        invalid={Boolean(error)}
      />
      <p id={`${base}-hint`} className="text-body-sm text-ink-2">
        {lt("host.notes.hint")}
      </p>
      <FieldError id={errorId} error={error} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={busy} onClick={() => void save()} data-testid="notes-save">
          {lt("host.notes.save")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => {
            setDraft(saved ?? "");
            setEditing(false);
            setError(null);
          }}
        >
          {lt("host.notes.cancel")}
        </Button>
      </div>
    </section>
  );
}
