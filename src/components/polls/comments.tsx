// Comment thread of a meeting poll (SPEC MP-14; research B5.8), shared by the voter page and the results page: author,
// "Host" badge, relative time, the text with its line breaks and autolinked URLs (rel="nofollow ugc noopener"), a
// delete button where allowed, and the add box (name required when the commenter is not known yet, up to 2,000
// characters). Plain text only: the body is rendered as text nodes, never as HTML. Client component.
"use client";

import { Trash2 } from "lucide-react";
import { useId, useState } from "react";
import type * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { MAX_COMMENT_LENGTH, MAX_NAME_LENGTH, POLL_ERRORS } from "@/lib/polls/constants";
import type { PollCommentView } from "@/lib/polls/types";
import { relativeTime } from "./lib/format";
import { pt } from "./lib/t";

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/gi;

/** Text with URLs as links (rel nofollow ugc noopener) and line breaks kept. */
export function LinkifiedText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a key={`l${i++}`} href={m[0]} target="_blank" rel="nofollow ugc noopener noreferrer" className="break-all text-brand-strong underline">
        {m[0]}
      </a>,
    );
    last = start + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <span className="whitespace-pre-line break-words">{parts}</span>;
}

export type CommentsThreadProps = {
  comments: PollCommentView[];
  now: number;
  /** Shown above the list ("Only the host can see comments"). */
  note?: string | null;
  /** Add box; null hides it (comments closed). */
  composer: {
    /** The commenter's name is unknown: ask for it. */
    needName: boolean;
    placeholder?: string;
    submitLabel?: string;
    disabled?: boolean;
    onSubmit: (input: { body: string; name: string | null }) => Promise<{ ok: true } | { ok: false; message: string; fieldErrors?: Record<string, string[]> }>;
  } | null;
  onDelete?: (commentId: string) => Promise<void>;
  heading?: string;
  headingLevel?: 2 | 3;
  className?: string;
};

export function CommentsThread({ comments, now, note, composer, onDelete, heading = pt("voter.comments"), headingLevel = 2, className }: CommentsThreadProps) {
  const id = useId();
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ body?: string; name?: string; form?: string }>({});
  const Heading = headingLevel === 2 ? "h2" : "h3";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composer || busy) return;
    const next: typeof errors = {};
    if (!body.trim()) next.body = POLL_ERRORS.commentEmpty;
    if (composer.needName && !name.trim()) next.name = POLL_ERRORS.nameRequired;
    setErrors(next);
    if (next.body || next.name) return;
    setBusy(true);
    try {
      const res = await composer.onSubmit({ body: body.trim(), name: composer.needName ? name.trim() : null });
      if (res.ok) {
        setBody("");
        setErrors({});
      } else {
        setErrors({ body: res.fieldErrors?.body?.[0], name: res.fieldErrors?.name?.[0], form: res.fieldErrors?.body || res.fieldErrors?.name ? undefined : res.message });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby={`${id}-h`} className={cn("flex flex-col gap-3", className)}>
      <Heading id={`${id}-h`} className="text-title-sm text-public-text">
        {heading}
        {comments.length > 0 && <span className="ml-1 font-normal text-ink-2">({comments.length})</span>}
      </Heading>
      {note && <p className="text-body-md text-ink-2">{note}</p>}
      {comments.length === 0 ? (
        <p className="text-body-md text-ink-2">{pt("voter.noComments")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-[var(--radius-card)] border border-line bg-white px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-label break-words text-ink">{c.authorName}</span>
                  {c.isHost && (
                    <Badge variant="info" size="sm">
                      {pt("voter.hostBadge")}
                    </Badge>
                  )}
                  <time dateTime={c.createdAt} className="text-body-sm text-ink-2">
                    {relativeTime(c.createdAt, now)}
                  </time>
                </div>
                {c.canDelete && onDelete && (
                  <IconButton
                    aria-label={pt("voter.commentDelete")}
                    size="sm"
                    loading={deleting === c.id}
                    onClick={async () => {
                      setDeleting(c.id);
                      try {
                        await onDelete(c.id);
                      } finally {
                        setDeleting(null);
                      }
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </IconButton>
                )}
              </div>
              <p className="mt-1 text-body-md text-ink">
                <LinkifiedText text={c.body} />
              </p>
            </li>
          ))}
        </ul>
      )}
      {composer && (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          {composer.needName && (
            <FormField label={pt("voter.commentNameLabel")} required error={errors.name}>
              {(control) => <Input {...control} value={name} maxLength={MAX_NAME_LENGTH} autoComplete="name" onChange={(e) => setName(e.target.value)} invalid={Boolean(errors.name)} />}
            </FormField>
          )}
          <FormField label={pt("voter.addComment")} error={errors.body ?? errors.form}>
            {(control) => (
              <Textarea
                {...control}
                value={body}
                rows={3}
                maxLength={MAX_COMMENT_LENGTH}
                showCount
                placeholder={composer.placeholder}
                disabled={composer.disabled}
                onChange={(e) => setBody(e.target.value)}
                invalid={Boolean(errors.body)}
              />
            )}
          </FormField>
          <div>
            <Button type="submit" variant="secondary" size="sm" loading={busy} disabled={composer.disabled}>
              {composer.submitLabel ?? pt("voter.commentSubmit")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
