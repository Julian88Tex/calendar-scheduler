// OWNER: foundation-platform. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Email core (ARCHITECTURE section 13.1, SPEC GEN-15, NT-05, NT-20). sendEmail upserts the email_outbox row by
// idempotency key (returns early when it already exists) and then delivers through Resend, SMTP or the outbox.
//
// Foundation stub behavior: every message is stored in email_outbox with status 'stored' and provider 'outbox' (the
// outbox viewer and /api/test/outbox read it); the layout is plain; htmlToText is a small tag stripper.
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { emailOutbox } from "@/db/schema";
import { appName } from "../brand";
import { getEnv } from "../env";
import { log } from "../logger";
import { now } from "../time/now";
import { appHost } from "../url";

export { buildIcs, type BuildIcsInput } from "./ics";

export type EmailCategory = "transactional" | "workflow" | "poll" | "system" | "auth";

export type EmailMessage = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  /** Host email for invitee-facing meeting emails (NT-20); null omits the header. */
  replyTo?: string | null;
  fromName?: string | null;
  subject: string;
  html: string;
  text: string;
  ics?: { method: "REQUEST" | "CANCEL" | "PUBLISH"; content: string; filename?: string } | null;
  attachments?: { filename: string; contentType: string; content: Buffer | string }[];
  /** Template id for the outbox viewer, e.g. "lifecycle.invitee_confirmation". */
  template: string;
  category: EmailCategory;
  idempotencyKey: string;
  /** Adds List-Unsubscribe and List-Unsubscribe-Post: List-Unsubscribe=One-Click (GEN-08). */
  listUnsubscribe?: { url: string; mailto?: string } | null;
  related?: {
    organizationId?: string;
    userId?: string;
    scheduledEventId?: string;
    inviteeId?: string;
    pollId?: string;
    workflowExecutionId?: string;
  };
};

export type SendEmailResult = { id: string; status: "sent" | "stored" | "queued" | "failed"; deduplicated: boolean };

/** Which transport delivers email (GEN-15). */
export function emailTransportName(): "resend" | "smtp" | "outbox" {
  const e = getEnv();
  if (e.RESEND_API_KEY) return "resend";
  if (e.SMTP_HOST) return "smtp";
  return "outbox";
}

/** Default sender: EMAIL_FROM, else "{AppName}" <notifications@{APP_URL host}>. */
export function defaultFromAddress(): string {
  const configured = getEnv().EMAIL_FROM;
  if (configured) return configured;
  const host = appHost().replace(/:\d+$/, "") || "localhost";
  return `"${appName()}" <notifications@${host}>`;
}

/** Sends (stub: stores) one email. Idempotent by msg.idempotencyKey. */
export async function sendEmail(msg: EmailMessage): Promise<SendEmailResult> {
  const db = await getDb();
  const attachments = (msg.attachments ?? []).map((a) => ({
    filename: a.filename,
    contentType: a.contentType,
    contentBase64: Buffer.isBuffer(a.content) ? a.content.toString("base64") : Buffer.from(a.content).toString("base64"),
  }));
  const inserted = await db
    .insert(emailOutbox)
    .values({
      organizationId: msg.related?.organizationId ?? null,
      toAddresses: msg.to,
      ccAddresses: msg.cc ?? [],
      bccAddresses: msg.bcc ?? [],
      fromAddress: defaultFromAddress(),
      fromName: msg.fromName ?? null,
      replyTo: msg.replyTo ?? null,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      attachments,
      icsMethod: msg.ics?.method ?? null,
      ics: msg.ics?.content ?? null,
      template: msg.template,
      category: msg.category,
      status: "stored",
      provider: "outbox",
      idempotencyKey: msg.idempotencyKey,
      relatedUserId: msg.related?.userId ?? null,
      scheduledEventId: msg.related?.scheduledEventId ?? null,
      inviteeId: msg.related?.inviteeId ?? null,
      pollId: msg.related?.pollId ?? null,
      workflowExecutionId: msg.related?.workflowExecutionId ?? null,
      sentAt: now(),
    })
    .onConflictDoNothing({ target: emailOutbox.idempotencyKey })
    .returning({ id: emailOutbox.id });
  if (inserted[0]) {
    log.info("email.stored", { id: inserted[0].id, template: msg.template, outbox: "/app/admin/outbox" });
    return { id: inserted[0].id, status: "stored", deduplicated: false };
  }
  const [existing] = await db
    .select({ id: emailOutbox.id, status: emailOutbox.status })
    .from(emailOutbox)
    .where(eq(emailOutbox.idempotencyKey, msg.idempotencyKey))
    .limit(1);
  if (!existing) throw new Error("sendEmail: outbox row vanished");
  const status = existing.status === "sending" ? "queued" : existing.status;
  return { id: existing.id, status, deduplicated: true };
}

/** HTML escaping for text inserted into email markup. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Plain text version of an email body: links become "text (url)", blocks become lines. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const label = text.replace(/<[^>]+>/g, "").trim();
      return label && label !== href ? `${label} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|table|ul|ol)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_m, e: string) => ENTITIES[e] ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type EmailBrand = {
  logoUrl?: string | null;
  avatarUrl?: string | null;
  showPoweredBy: boolean;
  primaryColor?: string;
};

/** Wraps a body in the email layout (NT-05). Stub: a plain, readable single column. */
export function renderEmailLayout(p: {
  preheader?: string;
  heading?: string;
  bodyHtml: string;
  footerHtml?: string;
  brand: EmailBrand;
  locale?: string;
}): { html: string } {
  const logo = p.brand.logoUrl
    ? `<p><img src="${escapeHtml(p.brand.logoUrl)}" alt="" height="40"></p>`
    : p.brand.avatarUrl
      ? `<p><img src="${escapeHtml(p.brand.avatarUrl)}" alt="" width="48" height="48"></p>`
      : "";
  const powered = p.brand.showPoweredBy ? `<p style="color:#476788;font-size:12px">Powered by ${escapeHtml(appName())}</p>` : "";
  const html = `<!doctype html><html lang="${escapeHtml(p.locale ?? "en")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="font-family:Arial,sans-serif;color:#0a2540">${
    p.preheader ? `<div style="display:none">${escapeHtml(p.preheader)}</div>` : ""
  }<div style="max-width:600px;margin:0 auto;padding:24px">${logo}${p.heading ? `<h1 style="font-size:20px">${escapeHtml(p.heading)}</h1>` : ""}${
    p.bodyHtml
  }${p.footerHtml ? `<div style="margin-top:24px;font-size:12px;color:#476788">${p.footerHtml}</div>` : ""}${powered}</div></body></html>`;
  return { html };
}
