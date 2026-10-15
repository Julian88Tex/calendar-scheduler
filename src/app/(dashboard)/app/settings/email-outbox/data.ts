// OWNER: golden-path-qa.
//
// The email outbox page (docs/SCOPE.md item 15, SPEC GEN-15, ADM-04): every email the instance generated, newest first
// and paginated, with its status, provider, template, recipients, subject and time; one email's rendered HTML and text
// for the preview; "Resend" of an email that failed for good.
//
// Access: the instance owner and instance admins (users.is_instance_admin or a verified ADMIN_EMAILS address) see every
// email; an organization owner who is not an instance admin sees the emails of their organization and the ones about
// them. Everyone else gets the 404 page (canSeeEmailOutbox, also used by the settings navigation).
//
// Resend (resendFailedEmail): only a failed row that is not waiting for Gmail, not retrying by itself and not purged.
// The row is first marked as resent ("permanent: Resent as a new email. {reason}") with a compare-and-set on its
// updated_at (the version the page showed), so a double click or a stale page never sends two copies and no retry of
// the original can follow; then resendOutboxEmail (src/lib/email) sends a fresh copy as a new outbox row, keyed by the
// original row and that version. When the copy fails with an error, the original is put back as it was (same reason and
// version), so the page does not claim a resend that never happened and the same "Resend" can be tried again (it lands
// on the same copy if one was made).
import "server-only";
import { and, count, desc, eq, ilike, inArray, isNull, like, notLike, or, sql, type SQL } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { paginate as offsetPage, toPage } from "@/db/helpers";
import { emailOutbox } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { ActorCtx } from "@/lib/authz";
import { describeEmailTransport, GMAIL_HOLD_PREFIX, resendOutboxEmail, resolveEmailTransport } from "@/lib/email";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/ids";
import { log } from "@/lib/logger";
import { now } from "@/lib/time/now";
import { canSeeEmailOutbox } from "./access";
import { cleanReason, outboxRowStatus, PERMANENT_PREFIX, type OutboxRowStatus, type OutboxStatusFilter } from "./status";

export const OUTBOX_PAGE_SIZE = 25;
/**
 * The highest page number queried (2.5 million rows in): a tampered or stale ?page= must never reach Postgres as an
 * OFFSET beyond bigint (that fails the whole page). The page itself sends a page past the end to the last one.
 */
export const OUTBOX_MAX_PAGE = 100_000;
const MAX_QUERY_LENGTH = 200;

/** The last page number of `total` rows (1 when there are none). */
export function lastOutboxPage(total: number): number {
  return Math.min(OUTBOX_MAX_PAGE, Math.max(1, Math.ceil(total / OUTBOX_PAGE_SIZE)));
}

/** Rows the actor may see: everything for instance admins, else their organization's emails and the ones about them. */
function scopeOf(actor: ActorCtx): SQL | undefined {
  if (actor.isInstanceAdmin) return undefined;
  return or(eq(emailOutbox.organizationId, actor.orgId), eq(emailOutbox.relatedUserId, actor.user.id));
}

function statusWhere(filter: OutboxStatusFilter): SQL | undefined {
  switch (filter) {
    case "all":
      return undefined;
    case "sent":
      return eq(emailOutbox.status, "sent");
    case "stored":
      return eq(emailOutbox.status, "stored");
    case "queued":
      return inArray(emailOutbox.status, ["queued", "sending"]);
    case "waiting_gmail":
      return and(eq(emailOutbox.status, "failed"), like(emailOutbox.lastError, `${GMAIL_HOLD_PREFIX}%`));
    case "failed":
      return and(
        eq(emailOutbox.status, "failed"),
        or(isNull(emailOutbox.lastError), notLike(emailOutbox.lastError, `${GMAIL_HOLD_PREFIX}%`)),
      );
  }
}

/** LIKE pattern with the user's text matched literally. */
function containsPattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function searchWhere(q: string): SQL | undefined {
  const text = q.trim().slice(0, MAX_QUERY_LENGTH);
  if (!text) return undefined;
  const pattern = containsPattern(text);
  return or(
    ilike(emailOutbox.subject, pattern),
    ilike(emailOutbox.template, pattern),
    sql`array_to_string(${emailOutbox.toAddresses}, ' ') ilike ${pattern}`,
    sql`array_to_string(${emailOutbox.ccAddresses}, ' ') ilike ${pattern}`,
  );
}

export type OutboxQuery = { status: OutboxStatusFilter; q: string; page: number };

export type OutboxListRow = {
  id: string;
  /** updated_at as ISO: the version a resend is checked against. */
  version: string;
  to: string[];
  cc: string[];
  subject: string;
  template: string;
  category: string;
  provider: string | null;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
  purged: boolean;
  status: OutboxRowStatus;
};

export type OutboxPageData = {
  rows: OutboxListRow[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
  /** "Sending from owner@gmail.com (Gmail)", "Stored in the outbox (no email provider configured)", ... */
  transport: string;
  /** Emails waiting for Gmail on this page's scope (the reconnect banner). */
  waitingForGmail: number;
};

const LIST_COLUMNS = {
  id: emailOutbox.id,
  updatedAt: emailOutbox.updatedAt,
  toAddresses: emailOutbox.toAddresses,
  ccAddresses: emailOutbox.ccAddresses,
  subject: emailOutbox.subject,
  template: emailOutbox.template,
  category: emailOutbox.category,
  status: emailOutbox.status,
  provider: emailOutbox.provider,
  attempts: emailOutbox.attempts,
  lastError: emailOutbox.lastError,
  createdAt: emailOutbox.createdAt,
  sentAt: emailOutbox.sentAt,
  bodyPurgedAt: emailOutbox.bodyPurgedAt,
};

export async function loadOutboxPage(actor: ActorCtx, query: OutboxQuery, db?: DbOrTx): Promise<OutboxPageData> {
  if (!canSeeEmailOutbox(actor)) throw new AppError("not_found");
  const d = db ?? (await getDb());
  const requested = Number.isFinite(query.page) ? Math.min(Math.max(Math.trunc(query.page), 1), OUTBOX_MAX_PAGE) : 1;
  const { page, pageSize, limit, offset } = offsetPage({ page: requested, pageSize: OUTBOX_PAGE_SIZE });
  const scope = scopeOf(actor);
  const where = and(scope, statusWhere(query.status), searchWhere(query.q));
  const [rows, [totalRow], [waitingRow], resolution] = await Promise.all([
    d
      .select(LIST_COLUMNS)
      .from(emailOutbox)
      .where(where)
      .orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.id))
      .limit(limit)
      .offset(offset),
    d.select({ n: count() }).from(emailOutbox).where(where),
    d
      .select({ n: count() })
      .from(emailOutbox)
      .where(and(scope, statusWhere("waiting_gmail"), isNull(emailOutbox.bodyPurgedAt))),
    resolveEmailTransport(d),
  ]);
  const { items, hasMore } = toPage(rows, pageSize);
  return {
    rows: items.map((r) => ({
      id: r.id,
      version: r.updatedAt.toISOString(),
      to: r.toAddresses,
      cc: r.ccAddresses,
      subject: r.subject,
      template: r.template,
      category: r.category,
      provider: r.provider,
      attempts: r.attempts,
      createdAt: r.createdAt.toISOString(),
      sentAt: r.sentAt?.toISOString() ?? null,
      purged: Boolean(r.bodyPurgedAt),
      status: outboxRowStatus(r),
    })),
    page,
    pageSize,
    total: Number(totalRow?.n ?? 0),
    hasMore,
    transport: describeEmailTransport(resolution),
    waitingForGmail: Number(waitingRow?.n ?? 0),
  };
}

export type OutboxEmailDetail = OutboxListRow & {
  from: string;
  replyTo: string | null;
  bcc: string[];
  html: string;
  text: string;
  icsMethod: string | null;
  attachments: string[];
};

/** One email for the preview dialog, or null when it does not exist or is out of the actor's scope. */
export async function loadOutboxEmail(actor: ActorCtx, id: string, db?: DbOrTx): Promise<OutboxEmailDetail | null> {
  if (!canSeeEmailOutbox(actor) || !isUuid(id)) return null;
  const d = db ?? (await getDb());
  const [r] = await d
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.id, id), scopeOf(actor)))
    .limit(1);
  if (!r) return null;
  return {
    id: r.id,
    version: r.updatedAt.toISOString(),
    to: r.toAddresses,
    cc: r.ccAddresses,
    bcc: r.bccAddresses,
    subject: r.subject,
    template: r.template,
    category: r.category,
    provider: r.provider,
    attempts: r.attempts,
    createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
    purged: Boolean(r.bodyPurgedAt),
    status: outboxRowStatus(r),
    from: r.fromName ? `${r.fromName} <${r.fromAddress}>` : r.fromAddress,
    replyTo: r.replyTo,
    html: r.html,
    text: r.text,
    icsMethod: r.ics ? (r.icsMethod ?? "REQUEST") : null,
    attachments: (r.attachments ?? []).map((a) => a.filename),
  };
}

export type ResendResult = { id: string; status: "sent" | "stored" | "queued" | "failed" };

/** "Resend" of a failed email: a fresh copy as a new outbox row (see the file header). */
export async function resendFailedEmail(actor: ActorCtx, input: { id: string; version: string }): Promise<ResendResult> {
  if (!canSeeEmailOutbox(actor)) throw new AppError("not_found", "Email not found");
  const db = await getDb();
  const [row] = await db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.id, input.id), scopeOf(actor)))
    .limit(1);
  if (!row) throw new AppError("not_found", "Email not found");
  const status = outboxRowStatus(row);
  if (row.bodyPurgedAt) throw new AppError("conflict", "Content removed after 30 days");
  if (status.kind === "waiting_gmail") {
    throw new AppError("conflict", "This email is waiting for Gmail. Reconnect your Google account and it is sent automatically.");
  }
  if (status.kind !== "failed") throw new AppError("conflict", "Only failed emails can be resent.");
  if (status.retrying) throw new AppError("conflict", "This email is being retried automatically.");
  const version = new Date(input.version);
  if (Number.isNaN(version.getTime()) || version.getTime() !== row.updatedAt.getTime()) {
    throw new AppError("conflict", "This email changed since the page loaded. Refresh the page and try again.");
  }
  const reason = cleanReason(row.lastError);
  // Compare-and-set on the version (milliseconds: the precision the page saw): one resend per state of the row, and
  // the original can never be retried after it.
  const resentNote = `${PERMANENT_PREFIX}Resent as a new email.${reason && !reason.startsWith("Resent as a new email.") ? ` ${reason}` : ""}`.slice(0, 2000);
  const [marked] = await db
    .update(emailOutbox)
    .set({ lastError: resentNote, updatedAt: now() })
    .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.status, "failed"), sql`date_trunc('milliseconds', ${emailOutbox.updatedAt}) = ${row.updatedAt.toISOString()}::timestamptz`))
    .returning({ id: emailOutbox.id });
  if (!marked) throw new AppError("conflict", "This email changed since the page loaded. Refresh the page and try again.");
  let result: Awaited<ReturnType<typeof resendOutboxEmail>>;
  try {
    // Keyed by the version the page showed: a retry after a failure here lands on the same copy, never a second one.
    result = await resendOutboxEmail(row.id, { idempotencyKey: `outbox-resend:${row.id}:${row.updatedAt.getTime()}` });
  } catch (e) {
    // No copy was made (a database or provider error): put the original back as it was, so the page neither claims a
    // resend that never happened nor hides "Resend" behind a changed version.
    await db
      .update(emailOutbox)
      .set({ lastError: row.lastError, updatedAt: row.updatedAt })
      .where(and(eq(emailOutbox.id, row.id), eq(emailOutbox.lastError, resentNote)))
      .catch((revertError: unknown) => log.warn("email_outbox.resend_revert_failed", { id: row.id, error: revertError }));
    throw e;
  }
  await audit({
    action: "email.resent",
    namespace: "admin",
    targetType: "email_outbox",
    targetId: row.id,
    details: { newId: result.id, status: result.status, template: row.template },
    actor,
  }).catch((e: unknown) => log.warn("email_outbox.audit_failed", { error: e }));
  log.info("email_outbox.resent", { id: row.id, newId: result.id, status: result.status });
  return { id: result.id, status: result.status };
}
