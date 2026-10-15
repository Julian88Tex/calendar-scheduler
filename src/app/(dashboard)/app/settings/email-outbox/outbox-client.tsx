// OWNER: golden-path-qa.
//
// Client parts of the email outbox page: the status filter and search (URL query, page reset to 1), the "Resend" button
// (resendEmailAction, toast, refresh) and the preview dialog of one email (?view={id}): the rendered HTML in a sandboxed
// iframe (no scripts, no same-origin access; links open in a new tab) or the plain text version, with the headers.
"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Pagination } from "@/components/ui/pagination";
import { SearchInput } from "@/components/ui/search-input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { toast } from "@/components/ui/toast";
import { resendEmailAction } from "./actions";
import type { OutboxStatusKind } from "./status";

export const STATUS_BADGE: Record<OutboxStatusKind, BadgeVariant> = {
  sent: "success",
  stored: "neutral",
  queued: "info",
  waiting_gmail: "warning",
  failed: "danger",
};

export function StatusBadge({ kind, label }: { kind: OutboxStatusKind; label: string }) {
  return <Badge variant={STATUS_BADGE[kind]}>{label}</Badge>;
}

function useQueryNavigation() {
  const router = useRouter();
  const pathname = usePathname() ?? "/app/settings/email-outbox";
  const params = useSearchParams();
  return (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page");
    next.delete("view");
    const qs = next.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}` as Route, { scroll: false });
  };
}

export function OutboxFilters({ status, q, options }: { status: string; q: string; options: readonly { value: string; label: string }[] }) {
  const navigate = useQueryNavigation();
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
      <NativeSelect
        aria-label="Status"
        className="sm:w-60"
        value={status}
        onChange={(e) => navigate({ status: e.target.value === "all" ? null : e.target.value })}
        options={options.map((o) => ({ value: o.value, label: o.label }))}
      />
      <SearchInput
        className="min-w-0 sm:max-w-sm sm:flex-1"
        defaultValue={q}
        aria-label="Search emails"
        placeholder="Search by recipient, subject or template"
        onSearch={(value) => navigate({ q: value.trim() || null })}
      />
    </div>
  );
}

/** Page links of the list: `baseHref` is the list URL without ?page (page 1 has none). */
export function OutboxPagination({ page, pageSize, total, baseHref }: { page: number; pageSize: number; total: number; baseHref: string }) {
  const hrefForPage = (n: number) => {
    if (n <= 1) return baseHref as Route;
    return `${baseHref}${baseHref.includes("?") ? "&" : "?"}page=${n}` as Route;
  };
  return <Pagination aria-label="Email outbox pages" page={page} pageSize={pageSize} total={total} hrefForPage={hrefForPage} />;
}

export function ResendButton({ id, version, subject }: { id: string; version: string; subject: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      aria-label={`Resend ${subject}`}
      onClick={() =>
        start(async () => {
          const res = await resendEmailAction({ id, version });
          if (!res.ok) {
            toast.error(res.error.message);
            router.refresh();
            return;
          }
          const s = res.data.status;
          if (s === "sent") toast.success("Email resent");
          else if (s === "stored") toast.success("A new copy was stored in the outbox");
          else toast.error("The new copy could not be sent either. Its reason is at the top of the list.");
          router.refresh();
        })
      }
    >
      Resend
    </Button>
  );
}

export type PreviewEmail = {
  id: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string | null;
  template: string;
  provider: string;
  when: string;
  status: { kind: OutboxStatusKind; label: string; reason: string | null };
  html: string;
  text: string;
  icsMethod: string | null;
  attachments: string[];
  purged: boolean;
};

/** The email HTML with a <base> so links leave the sandboxed frame in a new tab (the frame cannot navigate itself). */
function framedHtml(html: string): string {
  const base = '<base target="_blank">';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${base}`);
  return `<!doctype html><html><head><meta charset="utf-8">${base}</head><body>${html}</body></html>`;
}

function HeaderLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="w-20 shrink-0 font-semibold text-ink-2">{label}</dt>
      <dd className="min-w-0 break-words text-ink">{value}</dd>
    </div>
  );
}

export function EmailPreviewDialog({ email, closeHref }: { email: PreviewEmail; closeHref: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [mode, setMode] = useState<"html" | "text">(email.html.trim() ? "html" : "text");
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) router.push(closeHref as Route, { scroll: false });
  };
  return (
    <Dialog open={open} onOpenChange={close} title={email.subject} size="xl" bodyClassName="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind={email.status.kind} label={email.status.label} />
        <span className="text-body-sm text-ink-2">{email.when}</span>
      </div>
      {email.status.reason && <p className="text-body-sm break-words text-ink-2">{email.status.reason}</p>}
      <dl className="flex flex-col gap-1 text-body-sm">
        <HeaderLine label="From" value={email.from} />
        <HeaderLine label="To" value={email.to.join(", ") || "(none)"} />
        {email.cc.length > 0 && <HeaderLine label="Cc" value={email.cc.join(", ")} />}
        {email.bcc.length > 0 && <HeaderLine label="Bcc" value={email.bcc.join(", ")} />}
        {email.replyTo && <HeaderLine label="Reply-To" value={email.replyTo} />}
        <HeaderLine label="Template" value={email.template} />
        <HeaderLine label="Provider" value={email.provider} />
        {email.icsMethod && <HeaderLine label="Invite" value={email.icsMethod === "CANCEL" ? "Calendar cancellation (invite.ics)" : "Calendar invitation (invite.ics)"} />}
        {email.attachments.length > 0 && <HeaderLine label="Files" value={email.attachments.join(", ")} />}
      </dl>
      {email.purged ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-mist px-4 py-6 text-center text-body-md text-ink-2">Content removed after 30 days</p>
      ) : (
        <>
          <SegmentedControl
            aria-label="Email format"
            size="sm"
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "html", label: "HTML", disabled: !email.html.trim() },
              { value: "text", label: "Plain text" },
            ]}
            className="self-start"
          />
          {mode === "html" ? (
            <iframe
              title={`Email preview: ${email.subject}`}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              srcDoc={framedHtml(email.html)}
              className="h-[60vh] min-h-80 w-full rounded-[var(--radius-card)] border border-line bg-white"
            />
          ) : (
            <pre
              tabIndex={0}
              aria-label="Plain text version"
              className="max-h-[60vh] overflow-auto rounded-[var(--radius-card)] border border-line bg-mist p-4 text-[13px] leading-5 break-words whitespace-pre-wrap text-ink">
              {email.text || "(no plain text version)"}
            </pre>
          )}
        </>
      )}
    </Dialog>
  );
}
