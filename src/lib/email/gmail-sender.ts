// OWNER: gmail (email sending from the owner's Gmail).
//
// Which transport delivers email (owner decision, docs/SCOPE.md priority 5: booking emails are sent from the owner's
// own Gmail, so no Resend or SMTP account is needed). resolveEmailTransport() applies, in order:
//   1. EMAIL_PROVIDER=gmail|resend|smtp|outbox forces a transport. "resend" and "smtp" need their variables
//      (RESEND_API_KEY, SMTP_HOST); without them the setting is ignored (logged once) and the order below applies.
//      "gmail" sends from the owner's Gmail even when RESEND_API_KEY or SMTP_HOST is set.
//   2. RESEND_API_KEY -> Resend.
//   3. SMTP_HOST -> SMTP.
//   4. The owner's Gmail, unless the owner turned it off on Integrations > Google Calendar (instance setting
//      email_provider = "outbox"): the instance owner is the first instance admin (the account created first), and the
//      sending account is one of their Google connections that granted gmail.send (the one they picked, else an active
//      one, else the one with their login address, else the oldest).
//   5. Else the database outbox: emails are stored, not sent.
// When Gmail is the transport but cannot send right now (the owner's Google connection needs a reconnect, or
// EMAIL_PROVIDER=gmail before Google is connected), `hold` explains why: emails then wait in the outbox as failed with
// that reason and go out once Gmail can send again (src/lib/email/send.ts).
import "server-only";
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { getDb, type DbOrTx } from "@/db";
import { calendarConnections, instanceSettings, users } from "@/db/schema";
import { hasGmailSendScope } from "@/lib/integrations/google/scopes";
import { getEnv, type EmailProvider } from "../env";
import { log } from "../logger";
import { now } from "../time/now";
import { sanitizeHeaderValue } from "./address";
import type { EmailTransportName } from "./types";

/** instance_settings key: "outbox" turns Gmail sending off, "auto" (or no row) leaves it on. */
export const EMAIL_PROVIDER_SETTING_KEY = "email_provider";
/** instance_settings key: the Google connection the owner picked to send from (when several granted gmail.send). */
export const GMAIL_SENDER_SETTING_KEY = "gmail_sender_connection";

export type EmailProviderChoice = EmailProvider;
export type GmailSendingSetting = "auto" | "outbox";

const warned = new Set<string>();

function warnOnce(event: string, message: string): void {
  if (warned.has(`${event}:${message}`)) return;
  warned.add(`${event}:${message}`);
  log.warn(event, { message });
}

/**
 * EMAIL_PROVIDER (src/lib/env.ts, case-insensitive), or null when unset or invalid. An invalid value reads as unset
 * there; it also logs one warning here, since it is ignored.
 */
export function emailProviderFromEnv(): EmailProviderChoice | null {
  const forced = getEnv().EMAIL_PROVIDER;
  if (forced) return forced;
  if (process.env.EMAIL_PROVIDER?.trim()) {
    warnOnce("email.invalid_email_provider", "EMAIL_PROVIDER must be gmail, resend, smtp or outbox; ignoring it.");
  }
  return null;
}

/** The transport the environment alone selects (Resend or SMTP when configured, or a usable EMAIL_PROVIDER). */
export function configuredTransport(): { name: "resend" | "smtp"; forced: boolean } | { name: "gmail" | "outbox"; forced: true } | null {
  const forced = emailProviderFromEnv();
  const e = getEnv();
  if (forced === "outbox" || forced === "gmail") return { name: forced, forced: true };
  if (forced === "resend") {
    if (e.RESEND_API_KEY) return { name: "resend", forced: true };
    warnOnce("email.email_provider_unusable", "EMAIL_PROVIDER=resend but RESEND_API_KEY is not set; using the default order.");
  }
  if (forced === "smtp") {
    if (e.SMTP_HOST) return { name: "smtp", forced: true };
    warnOnce("email.email_provider_unusable", "EMAIL_PROVIDER=smtp but SMTP_HOST is not set; using the default order.");
  }
  if (e.RESEND_API_KEY) return { name: "resend", forced: false };
  if (e.SMTP_HOST) return { name: "smtp", forced: false };
  return null;
}

export type InstanceOwner = { id: string; name: string; email: string };

/** The instance owner: the first instance admin (the first account of the instance), or null before signup. */
export async function getInstanceOwner(db?: DbOrTx): Promise<InstanceOwner | null> {
  const d = db ?? (await getDb());
  const [row] = await d
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.isInstanceAdmin, true), isNull(users.deletedAt)))
    .orderBy(asc(users.createdAt), asc(users.id))
    .limit(1);
  return row ?? null;
}

export type GoogleConnectionStatus = "active" | "needs_reauth" | "error";

export type OwnerGoogleConnection = {
  id: string;
  address: string;
  status: GoogleConnectionStatus;
  hasGmailSend: boolean;
  createdAt: Date;
};

/** The owner's live Google connections (oldest first), with whether each granted gmail.send. */
export async function ownerGoogleConnections(ownerId: string, db?: DbOrTx): Promise<OwnerGoogleConnection[]> {
  const d = db ?? (await getDb());
  const rows = await d
    .select({
      id: calendarConnections.id,
      accountEmail: calendarConnections.accountEmail,
      status: calendarConnections.status,
      scopes: calendarConnections.scopes,
      createdAt: calendarConnections.createdAt,
    })
    .from(calendarConnections)
    .where(
      and(eq(calendarConnections.userId, ownerId), eq(calendarConnections.provider, "google"), ne(calendarConnections.status, "disconnected")),
    )
    .orderBy(asc(calendarConnections.createdAt), asc(calendarConnections.id));
  return rows
    .filter((r): r is typeof r & { accountEmail: string } => Boolean(r.accountEmail))
    .map((r) => ({
      id: r.id,
      address: r.accountEmail.trim(),
      status: r.status === "needs_reauth" || r.status === "error" ? r.status : "active",
      hasGmailSend: hasGmailSendScope(r.scopes),
      createdAt: r.createdAt,
    }));
}

/**
 * The connection Gmail sends from: the owner's pick when it still granted gmail.send, else an active one, else the one
 * whose address is the owner's login email, else the oldest. Null when no connection granted gmail.send.
 */
export function pickGmailConnection(
  connections: readonly OwnerGoogleConnection[],
  opts: { preferredId?: string | null; ownerEmail?: string | null } = {},
): OwnerGoogleConnection | null {
  const usable = connections.filter((c) => c.hasGmailSend);
  if (!usable.length) return null;
  const preferred = opts.preferredId ? usable.find((c) => c.id === opts.preferredId) : undefined;
  if (preferred) return preferred;
  const owner = opts.ownerEmail?.trim().toLowerCase();
  const rank = (c: OwnerGoogleConnection) => (c.status === "needs_reauth" ? 2 : 0) + (owner && c.address.toLowerCase() === owner ? 0 : 1);
  return [...usable].sort((a, b) => rank(a) - rank(b) || a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
}

async function readSetting(db: DbOrTx, key: string): Promise<unknown> {
  const [row] = await db.select({ value: instanceSettings.value }).from(instanceSettings).where(eq(instanceSettings.key, key)).limit(1);
  return row?.value;
}

/** The owner's Gmail switch on Integrations > Google Calendar ("outbox": off). */
export async function getGmailSendingSetting(db?: DbOrTx): Promise<GmailSendingSetting> {
  const v = await readSetting(db ?? (await getDb()), EMAIL_PROVIDER_SETTING_KEY);
  return v === "outbox" ? "outbox" : "auto";
}

/** The Google connection the owner picked to send from, or null. */
export async function getPreferredGmailConnectionId(db?: DbOrTx): Promise<string | null> {
  const v = await readSetting(db ?? (await getDb()), GMAIL_SENDER_SETTING_KEY);
  return typeof v === "string" && v ? v : null;
}

/** Upserts one instance setting. */
export async function writeInstanceSetting(db: DbOrTx, key: string, value: unknown, userId: string | null): Promise<void> {
  const at = now();
  await db
    .insert(instanceSettings)
    .values({ key, value, updatedAt: at, updatedByUserId: userId })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value, updatedAt: at, updatedByUserId: userId } });
}

export type GmailSender = {
  ownerUserId: string;
  /** The From display name: the owner's name. */
  ownerName: string;
  connectionId: string;
  /** The Google account address messages are sent from. */
  address: string;
  connectionStatus: GoogleConnectionStatus;
};

/**
 * The From display name of Gmail deliveries: the owner's name without control characters, or null (the bare address)
 * when it is empty. The outbox row records the same name the message carries.
 */
export function gmailFromName(sender: Pick<GmailSender, "ownerName">): string | null {
  return sanitizeHeaderValue(sender.ownerName ?? "", 200) || null;
}

/** The owner's Gmail sender, or null when the owner has no Google connection that granted gmail.send. */
export async function getGmailSender(db?: DbOrTx): Promise<GmailSender | null> {
  const d = db ?? (await getDb());
  const owner = await getInstanceOwner(d);
  if (!owner) return null;
  const [connections, preferredId] = await Promise.all([ownerGoogleConnections(owner.id, d), getPreferredGmailConnectionId(d)]);
  const picked = pickGmailConnection(connections, { preferredId, ownerEmail: owner.email });
  if (!picked) return null;
  return { ownerUserId: owner.id, ownerName: owner.name, connectionId: picked.id, address: picked.address, connectionStatus: picked.status };
}

export type EmailTransportSource = "forced" | "configured" | "gmail" | "setting" | "none";

export type EmailTransportResolution = {
  name: EmailTransportName;
  /**
   * forced: EMAIL_PROVIDER; configured: RESEND_API_KEY or SMTP_HOST; gmail: the owner's Gmail; setting: the owner
   * turned Gmail sending off; none: nothing can send (stored in the outbox).
   */
  source: EmailTransportSource;
  /** The Gmail sender when name is "gmail" (null for EMAIL_PROVIDER=gmail before Google is connected). */
  gmail: GmailSender | null;
  /** Why Gmail cannot send right now (emails wait in the outbox until it can), or null. */
  hold: string | null;
};

const INTEGRATION_PATH = "Integrations > Google Calendar";

/** The reason a held email shows when the owner's Google connection needs a reconnect. */
export function reconnectHoldReason(address: string): string {
  return `Your Google account ${address} needs to be reconnected before emails can be sent from it (its access was revoked or has expired). Reconnect it on ${INTEGRATION_PATH}; this email is sent automatically once you do.`;
}

/** The reason a held email shows when EMAIL_PROVIDER=gmail but no Google connection allows sending. */
export const NOT_CONNECTED_HOLD_REASON = `Gmail sending is not set up yet. Connect your Google account on ${INTEGRATION_PATH} and allow "Send email on your behalf"; this email is sent automatically once you do.`;

function gmailResolution(sender: GmailSender | null, source: EmailTransportSource): EmailTransportResolution {
  if (!sender) return { name: "gmail", source, gmail: null, hold: NOT_CONNECTED_HOLD_REASON };
  return { name: "gmail", source, gmail: sender, hold: sender.connectionStatus === "needs_reauth" ? reconnectHoldReason(sender.address) : null };
}

/** The transport for the next delivery (see the file header). */
export async function resolveEmailTransport(db?: DbOrTx): Promise<EmailTransportResolution> {
  const configured = configuredTransport();
  if (configured?.name === "outbox") return { name: "outbox", source: "forced", gmail: null, hold: null };
  if (configured?.name === "resend" || configured?.name === "smtp") {
    return { name: configured.name, source: configured.forced ? "forced" : "configured", gmail: null, hold: null };
  }
  const d = db ?? (await getDb());
  if (configured?.name === "gmail") return gmailResolution(await getGmailSender(d), "forced");
  if ((await getGmailSendingSetting(d)) === "outbox") return { name: "outbox", source: "setting", gmail: null, hold: null };
  const sender = await getGmailSender(d);
  if (!sender) return { name: "outbox", source: "none", gmail: null, hold: null };
  return gmailResolution(sender, "gmail");
}

/**
 * One line for status tiles (the Integrations hub's "Email delivery" tile, the setup checklist): "Sending from
 * owner@gmail.com (Gmail)", "Waiting for Gmail: reconnect owner@gmail.com", "Sending with Resend", "Sending with SMTP",
 * "Stored in the outbox (Gmail sending is turned off)" or "Stored in the outbox (no email provider configured)".
 */
export function describeEmailTransport(r: EmailTransportResolution): string {
  if (r.name === "resend") return "Sending with Resend";
  if (r.name === "smtp") return "Sending with SMTP";
  if (r.name === "gmail") {
    if (!r.gmail) return "Waiting for Gmail: connect Google and allow Gmail sending";
    return r.hold ? `Waiting for Gmail: reconnect ${r.gmail.address}` : `Sending from ${r.gmail.address} (Gmail)`;
  }
  if (r.source === "setting") return "Stored in the outbox (Gmail sending is turned off)";
  if (r.source === "forced") return "Stored in the outbox (EMAIL_PROVIDER=outbox)";
  return "Stored in the outbox (no email provider configured)";
}
