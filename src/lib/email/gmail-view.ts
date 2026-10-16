// OWNER: foundation-platform. Gmail sending (email sending from the owner's Gmail, added at go-live).
//
// The "Send emails from your Gmail" card on Integrations > Google Calendar:
// - getGmailSendingView(actor): what the card shows (null for anyone but the instance owner, whose Google account is
//   the one that sends): the state (gmail-types.ts), the sending address, the accounts that allowed Gmail sending, the
//   switch, emails waiting for a reconnect, the last delivery failure, and the Google consent link that asks for
//   "Send email on your behalf" (incremental authorization: the calendar grant stays, gmail.send is added).
// - setGmailSending(actor, input): the switch (instance setting email_provider: "auto" sends from Gmail, "outbox" keeps
//   emails in the outbox) and the account to send from. Owner only, refused while EMAIL_PROVIDER is set, audited.
//   Turning it on releases emails that were waiting.
// - releaseHeldEmailsSoon(): after the page renders (inside after()), sends the emails that waited for a reconnect
//   once Gmail can send again.
import "server-only";
import { and, desc, eq, gt, isNotNull, notLike } from "drizzle-orm";
import { getDb } from "@/db";
import { advisoryXactLock } from "@/db/helpers";
import { emailOutbox } from "@/db/schema";
import { audit } from "@/lib/audit";
import { oauthStartPath } from "@/lib/auth/oauth/links";
import type { ActorCtx } from "@/lib/authz";
import { getFeatures, isE2eMode } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { runJobsNowInBackground } from "@/lib/jobs";
import { log } from "@/lib/logger";
import { nowMs } from "@/lib/time/now";
import {
  configuredTransport,
  EMAIL_PROVIDER_SETTING_KEY,
  emailProviderFromEnv,
  getGmailSendingSetting,
  getInstanceOwner,
  getPreferredGmailConnectionId,
  GMAIL_SENDER_SETTING_KEY,
  ownerGoogleConnections,
  pickGmailConnection,
  writeInstanceSetting,
  type OwnerGoogleConnection,
} from "./gmail-sender";
import type { GmailSendingInput } from "./gmail-schemas";
import type { GmailSendingState, GmailSendingView } from "./gmail-types";
import { countHeldEmails, GMAIL_HOLD_PREFIX, releaseHeldEmails } from "./send";

/** Where the card lives; the Google consent round trip returns here with ?gmail=requested. */
export const GMAIL_CARD_PATH = "/app/integrations/calendars/google";
const FAILURE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PERMANENT_PREFIX = "permanent: ";

/** The Google consent link that adds gmail.send (to `connection` when given, else a new connection). */
export function gmailConsentHref(connection: Pick<OwnerGoogleConnection, "id"> | null): string {
  return oauthStartPath("google", {
    intent: "connect_calendar",
    next: `${GMAIL_CARD_PATH}?gmail=requested`,
    ...(connection ? { data: { reconnect: connection.id } } : {}),
  });
}

/** The connection to ask for gmail.send: the one with the owner's login address, else the oldest active one. */
function consentTarget(connections: readonly OwnerGoogleConnection[], ownerEmail: string): OwnerGoogleConnection | null {
  const email = ownerEmail.trim().toLowerCase();
  return (
    connections.find((c) => c.status !== "needs_reauth" && c.address.toLowerCase() === email) ??
    connections.find((c) => c.status !== "needs_reauth") ??
    connections[0] ??
    null
  );
}

async function lastGmailFailure(): Promise<{ message: string; at: string } | null> {
  const db = await getDb();
  const since = new Date(nowMs() - FAILURE_WINDOW_MS);
  const [failed] = await db
    .select({ lastError: emailOutbox.lastError, at: emailOutbox.updatedAt })
    .from(emailOutbox)
    .where(
      and(
        eq(emailOutbox.provider, "gmail"),
        eq(emailOutbox.status, "failed"),
        gt(emailOutbox.updatedAt, since),
        isNotNull(emailOutbox.lastError),
        notLike(emailOutbox.lastError, `${GMAIL_HOLD_PREFIX}%`),
      ),
    )
    .orderBy(desc(emailOutbox.updatedAt))
    .limit(1);
  if (!failed?.lastError) return null;
  const [sent] = await db
    .select({ at: emailOutbox.sentAt })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.provider, "gmail"), eq(emailOutbox.status, "sent"), gt(emailOutbox.updatedAt, failed.at)))
    .limit(1);
  if (sent) return null; // a later email went out: the problem is gone
  const message = failed.lastError.startsWith(PERMANENT_PREFIX) ? failed.lastError.slice(PERMANENT_PREFIX.length) : failed.lastError;
  return { message: message.slice(0, 400), at: failed.at.toISOString() };
}

/**
 * The card for the signed-in user, or null when they are not the instance owner (only the owner's Gmail sends).
 * `requested`: the page was reached from the Google consent round trip (?gmail=requested).
 */
export async function getGmailSendingView(actor: ActorCtx, opts: { requested?: boolean } = {}): Promise<GmailSendingView | null> {
  const db = await getDb();
  const owner = await getInstanceOwner(db);
  if (!owner || owner.id !== actor.user.id) return null;
  const [connections, setting, preferredId, heldCount, lastFailure] = await Promise.all([
    ownerGoogleConnections(owner.id, db),
    getGmailSendingSetting(db),
    getPreferredGmailConnectionId(db),
    countHeldEmails(db),
    lastGmailFailure(),
  ]);
  const envProvider = emailProviderFromEnv();
  const configured = configuredTransport();
  const googleConfigured = getFeatures().googleOAuth;
  const picked = pickGmailConnection(connections, { preferredId, ownerEmail: owner.email });
  const candidates = connections.filter((c) => c.hasGmailSend).map((c) => ({ id: c.id, address: c.address, status: c.status }));

  let state: GmailSendingState;
  if (configured?.name === "outbox") state = "forced_outbox";
  else if (configured?.name === "resend" || configured?.name === "smtp") state = "other_provider";
  else if (!googleConfigured && !picked) state = "unavailable";
  else if (!connections.length) state = "not_connected";
  else if (!picked) state = "permission_needed";
  else if (envProvider !== "gmail" && setting === "outbox") state = "off";
  else if (picked.status === "needs_reauth") state = "needs_reconnect";
  else state = "on";

  const target = picked ?? consentTarget(connections, owner.email);
  return {
    state,
    address: picked?.address ?? null,
    candidates,
    selectedConnectionId: picked?.id ?? null,
    enabled: setting !== "outbox",
    envProvider,
    otherProvider: configured?.name === "resend" || configured?.name === "smtp" ? configured.name : null,
    canEdit: envProvider === null && (state === "on" || state === "off" || state === "needs_reconnect"),
    heldCount,
    lastFailure: state === "on" || state === "needs_reconnect" ? lastFailure : null,
    allowHref: googleConfigured ? gmailConsentHref(target) : null,
    requested: opts.requested && connections.length ? (picked ? "granted" : "missing") : null,
  };
}

export type SetGmailSendingResult = { enabled: boolean; connectionId: string | null; releasedJobIds: string[] };

/** The switch and the sending account (see the file header). */
export async function setGmailSending(actor: ActorCtx, input: GmailSendingInput): Promise<SetGmailSendingResult> {
  const db = await getDb();
  const owner = await getInstanceOwner(db);
  if (!owner || owner.id !== actor.user.id) {
    throw new AppError("forbidden", "Only the account owner can change how emails are sent.");
  }
  const forced = emailProviderFromEnv();
  if (forced) {
    throw new AppError("conflict", `EMAIL_PROVIDER is set to ${forced} on this server, so email sending can't be changed here.`);
  }
  const result = await db.transaction(async (tx) => {
    await advisoryXactLock(tx, "instance_setting:email_provider");
    const connections = await ownerGoogleConnections(owner.id, tx);
    const candidates = connections.filter((c) => c.hasGmailSend);
    const connectionId = input.connectionId ?? null;
    if (connectionId && !candidates.some((c) => c.id === connectionId)) {
      const message = "Choose one of your Google accounts that allows Gmail sending.";
      throw new AppError("validation", message, { fieldErrors: { connectionId: [message] } });
    }
    if (input.enabled && !candidates.length) {
      throw new AppError("conflict", "Allow Gmail sending for your Google account first.");
    }
    const previous = await getGmailSendingSetting(tx);
    const value = input.enabled ? "auto" : "outbox";
    await writeInstanceSetting(tx, EMAIL_PROVIDER_SETTING_KEY, value, actor.user.id);
    if (connectionId) await writeInstanceSetting(tx, GMAIL_SENDER_SETTING_KEY, connectionId, actor.user.id);
    await audit(
      {
        action: "email.gmail_sending_changed",
        namespace: "integrations",
        targetType: "instance_setting",
        targetId: EMAIL_PROVIDER_SETTING_KEY,
        details: { from: previous, to: value, ...(connectionId ? { connectionId } : {}) },
        actor,
      },
      tx,
    );
    return { enabled: input.enabled, connectionId };
  });
  const releasedJobIds = result.enabled ? await releaseHeldEmails({ db }) : [];
  return { ...result, releasedJobIds };
}

/** After the card renders: send the emails that waited for Gmail once it can send again. Never throws. */
export async function releaseHeldEmailsSoon(): Promise<void> {
  if (isE2eMode()) return; // E2E runs jobs explicitly (/api/test/run-jobs)
  try {
    const ids = await releaseHeldEmails();
    if (ids.length) await runJobsNowInBackground({ ids, thenAnyDue: false, budgetMs: 6_000 });
  } catch (e) {
    log.warn("email.release_held_failed", { error: e });
  }
}
