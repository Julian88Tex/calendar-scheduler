// OWNER: golden-path-qa.
//
// /app/settings/email-outbox (docs/SCOPE.md item 15, SPEC GEN-15, ADM-04; EMAIL_OUTBOX_PATH in src/lib/email): every
// email the app generated, newest first, 25 per page, with how email is delivered right now (Gmail, Resend, SMTP or
// stored in the outbox). Each row shows the status (Sent, Stored, Queued, Waiting for Gmail with a link to reconnect
// Google, Failed with the reason), the subject and template, the recipients, the provider and the time in the user's
// zone and time format. "View" opens the rendered email (?view={id}); "Resend" sends a new copy of an email that failed
// for good. Filters: status and a search over recipients, subject and template (?status=, ?q=, ?page=). Owner or
// instance admin only (data.ts canSeeEmailOutbox); everyone else gets the 404 page.
import { Mail, RefreshCw } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getActorCtx } from "@/lib/authz";
import { formatDateShort, formatTime, hour12For, isoDateInZone } from "@/lib/time/format";
import { now } from "@/lib/time/now";
import { zoneOrUtc } from "@/lib/time/zones";
import { canSeeEmailOutbox } from "./access";
import { loadOutboxEmail, loadOutboxPage, type OutboxListRow } from "./data";
import { EmailPreviewDialog, OutboxFilters, OutboxPagination, ResendButton, StatusBadge } from "./outbox-client";
import { OUTBOX_STATUS_FILTERS, parseStatusFilter, providerLabel, type OutboxStatusFilter } from "./status";

export const metadata: Metadata = { title: "Email outbox" };

const PATH = "/app/settings/email-outbox";
const GOOGLE_PATH = "/app/integrations/calendars/google" as Route;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const first = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));

function hrefWith(base: { status: OutboxStatusFilter; q: string; page: number }, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (base.status !== "all") p.set("status", base.status);
  if (base.q) p.set("q", base.q);
  if (base.page > 1) p.set("page", String(base.page));
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const qs = p.toString();
  return `${PATH}${qs ? `?${qs}` : ""}`;
}

export default async function EmailOutboxPage({ searchParams }: Props) {
  const [sp, actor] = await Promise.all([searchParams, getActorCtx()]);
  if (!canSeeEmailOutbox(actor)) notFound();
  const query = {
    status: parseStatusFilter(sp.status),
    q: first(sp.q).trim().slice(0, 200),
    page: Math.max(1, Math.trunc(Number(first(sp.page)) || 1)),
  };
  const viewId = first(sp.view);
  const [data, detail] = await Promise.all([loadOutboxPage(actor, query), viewId ? loadOutboxEmail(actor, viewId) : Promise.resolve(null)]);

  const zone = zoneOrUtc(actor.user.timezone);
  const hour12 = hour12For(actor.user.timeFormat, actor.user.locale);
  const thisYear = isoDateInZone(now(), zone).slice(0, 4);
  const when = (iso: string) => {
    const d = new Date(iso);
    const y = isoDateInZone(d, zone).slice(0, 4);
    const year = y === thisYear ? "" : `, ${y}`;
    return `${formatDateShort(d, zone)}${year}, ${formatTime(d, zone, "en", hour12)}`;
  };
  const filtered = query.status !== "all" || query.q !== "";

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Email outbox"
        description="Every email the app sent or tried to send for you and your invitees, newest first."
        className="mb-0"
      />
      <p className="flex min-w-0 items-center gap-2 text-body-md text-ink-2" data-testid="email-transport">
        <Mail aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0 break-words">{data.transport}</span>
      </p>
      {data.waitingForGmail > 0 && (
        <Banner
          variant="warning"
          role="status"
          title={data.waitingForGmail === 1 ? "1 email is waiting for Gmail" : `${data.waitingForGmail} emails are waiting for Gmail`}
          action={
            <Link href={GOOGLE_PATH} className="font-semibold whitespace-nowrap underline">
              Reconnect Google
            </Link>
          }
        >
          Your Google account needs to be reconnected before these emails can be sent. They go out automatically once you
          reconnect it.
        </Banner>
      )}
      <OutboxFilters status={query.status} q={query.q} options={OUTBOX_STATUS_FILTERS} />
      {data.rows.length === 0 ? (
        <EmptyState
          icon={<Mail aria-hidden="true" />}
          heading={filtered ? "No emails match these filters" : "No emails yet"}
          body={filtered ? "Try another status or search." : "Booking confirmations, reminders and other emails show up here as soon as they are created."}
          action={
            filtered ? (
              <Link href={PATH as Route} className="font-semibold text-primary-text hover:underline">
                Show all emails
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="min-w-0 rounded-[var(--radius-card)] border border-line bg-white">
            <Table>
              <TableCaption>Emails, newest first</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <OutboxRow key={row.id} row={row} when={when(row.createdAt)} viewHref={hrefWith(query, { view: row.id })} />
                ))}
              </TableBody>
            </Table>
          </div>
          <OutboxPagination page={data.page} pageSize={data.pageSize} total={data.total} baseHref={hrefWith({ ...query, page: 1 })} />
        </div>
      )}
      {detail && (
        <EmailPreviewDialog
          key={detail.id}
          closeHref={hrefWith(query)}
          email={{
            id: detail.id,
            subject: detail.subject,
            from: detail.from,
            to: detail.to,
            cc: detail.cc,
            bcc: detail.bcc,
            replyTo: detail.replyTo,
            template: detail.template,
            provider: providerLabel(detail.provider),
            when: when(detail.createdAt),
            status: { kind: detail.status.kind, label: detail.status.label, reason: detail.status.reason },
            html: detail.html,
            text: detail.text,
            icsMethod: detail.icsMethod,
            attachments: detail.attachments,
            purged: detail.purged,
          }}
        />
      )}
    </div>
  );
}

function OutboxRow({ row, when, viewHref }: { row: OutboxListRow; when: string; viewHref: string }) {
  const { status } = row;
  return (
    <TableRow data-testid={`outbox-row-${row.id}`} className="align-top">
      <TableCell className="w-56 min-w-48 align-top">
        <div className="flex flex-col items-start gap-1.5">
          <StatusBadge kind={status.kind} label={status.label} />
          {status.reason && <p className="line-clamp-3 text-[12px] leading-4 break-words text-ink-2">{status.reason}</p>}
          {status.retrying && (
            <p className="inline-flex items-center gap-1 text-[12px] leading-4 text-ink-2">
              <RefreshCw aria-hidden="true" className="size-3" />
              Retrying automatically
            </p>
          )}
          {status.kind === "waiting_gmail" && (
            <Link href={GOOGLE_PATH} className="text-[12px] leading-4 font-semibold text-primary-text hover:underline">
              Reconnect Google
            </Link>
          )}
        </div>
      </TableCell>
      <TableCell className="min-w-56 align-top">
        <p className="font-semibold break-words">{row.subject}</p>
        <p className="mt-0.5 font-mono text-[12px] leading-4 break-all text-ink-2">{row.template}</p>
      </TableCell>
      <TableCell className="min-w-44 align-top break-words">
        {row.to.join(", ")}
        {row.cc.length > 0 && <span className="block text-[12px] text-ink-2">Cc: {row.cc.join(", ")}</span>}
      </TableCell>
      <TableCell className="align-top whitespace-nowrap">{providerLabel(row.provider)}</TableCell>
      <TableCell className="align-top whitespace-nowrap">
        <time dateTime={row.createdAt}>{when}</time>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex items-center justify-end gap-2">
          <Link
            href={viewHref as Route}
            scroll={false}
            className="rounded-full px-2 py-1 text-[14px] font-semibold whitespace-nowrap text-primary-text hover:underline"
            aria-label={`View ${row.subject}`}
          >
            View
          </Link>
          {status.canResend && <ResendButton id={row.id} version={row.version} subject={row.subject} />}
        </div>
      </TableCell>
    </TableRow>
  );
}
