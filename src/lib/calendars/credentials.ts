// OWNER: calendar-integrations.
//
// Connection credentials (ARCHITECTURE section 10.1, SPEC CAL-02, CAL-15, GEN-08): tokens are stored with AES-256-GCM
// (encrypt()) and decrypted only here.
// - getConnectionContext: decrypted credentials, refreshed when the access token expires within 5 minutes.
// - refreshAccessToken: runs under a per-connection transaction advisory lock, re-reads the row (another request may
//   have refreshed while we waited), and keeps the stored refresh token when Google returns none (Google does not
//   rotate). invalid_grant (or no refresh token at all) marks the connection needs_reauth.
// - withConnection: runs a provider call; a 401 refreshes and retries once; credential failures update the connection
//   status (needs_reauth for revoked tokens and missing scopes, error for a disabled Calendar API).
// docs/SCOPE.md: Google only; other providers answer ProviderAuthError("unsupported").
import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { advisoryXactLock } from "@/db/helpers";
import { calendarConnections } from "@/db/schema";
import { isInvalidGrant, OAuthProviderError } from "@/lib/auth/oauth/tokens";
import { refreshGoogleAccessToken } from "@/lib/auth/oauth/google";
import { decryptOrNull, encrypt } from "@/lib/crypto";
import { isAppError } from "@/lib/errors";
import { nowMs } from "@/lib/time/now";
import { markConnectionBroken } from "./health";
import { ProviderAuthError, ProviderTransientError, isProviderAuthError, type ConnectionContext } from "./providers/types";

/** Refresh when the access token expires within this window. */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;

export type ConnectionRow = typeof calendarConnections.$inferSelect;

const lockKey = (connectionId: string) => `calendar_connection:${connectionId}`;

function expiringSoon(expiresAt: Date | null): boolean {
  return expiresAt !== null && expiresAt.getTime() <= nowMs() + REFRESH_SKEW_MS;
}

function contextOf(row: ConnectionRow, accessToken: string): ConnectionContext {
  return {
    connectionId: row.id,
    userId: row.userId,
    provider: row.provider,
    accessToken,
    unavailableStatuses: row.unavailableStatuses,
  };
}

type RefreshOutcome =
  | { kind: "ok"; row: ConnectionRow; accessToken: string }
  | { kind: "reauth"; error: string }
  | { kind: "transient"; error: string }
  | { kind: "gone" };

/**
 * Refreshes the access token under the connection lock. `staleToken` is the token that just failed (401): when the
 * stored token differs, another request already refreshed and that token is used as is.
 */
export async function refreshAccessToken(connectionId: string, opts: { staleToken?: string | null; force?: boolean } = {}): Promise<ConnectionContext> {
  const db = await getDb();
  const outcome: RefreshOutcome = await db.transaction(async (tx) => {
    await advisoryXactLock(tx, lockKey(connectionId));
    const [row] = await tx.select().from(calendarConnections).where(eq(calendarConnections.id, connectionId)).limit(1);
    if (!row || row.status === "disconnected") return { kind: "gone" };
    if (row.status === "needs_reauth") return { kind: "reauth", error: row.lastError ?? "needs_reauth" };
    const current = await decryptOrNull(row.accessTokenEnc);
    const replacedMeanwhile = Boolean(current && opts.staleToken && current !== opts.staleToken);
    if (current && !expiringSoon(row.tokenExpiresAt) && (replacedMeanwhile || !opts.force)) {
      return { kind: "ok", row, accessToken: current };
    }
    if (row.provider !== "google") return { kind: "reauth", error: "unsupported_provider" };
    const refreshToken = await decryptOrNull(row.refreshTokenEnc);
    if (!refreshToken) return { kind: "reauth", error: "no_refresh_token" };
    try {
      const t = await refreshGoogleAccessToken(refreshToken);
      const [updated] = await tx
        .update(calendarConnections)
        .set({
          accessTokenEnc: await encrypt(t.accessToken),
          tokenExpiresAt: t.expiresAt,
          // Google keeps the old refresh token (null here); store a new one only when it rotated.
          ...(t.refreshToken ? { refreshTokenEnc: await encrypt(t.refreshToken) } : {}),
          ...(t.scopes.length ? { scopes: t.scopes } : {}),
        })
        .where(eq(calendarConnections.id, connectionId))
        .returning();
      return { kind: "ok", row: updated ?? row, accessToken: t.accessToken };
    } catch (e) {
      if (isInvalidGrant(e)) return { kind: "reauth", error: "invalid_grant" };
      if (isAppError(e) && e.code === "not_configured") return { kind: "transient", error: "google_oauth_not_configured" };
      const code = e instanceof OAuthProviderError ? e.code : "refresh_failed";
      // invalid_client / unauthorized_client: the server's OAuth client changed; users must reconnect.
      if (code === "invalid_client" || code === "unauthorized_client") return { kind: "reauth", error: code };
      return { kind: "transient", error: code };
    }
  });
  switch (outcome.kind) {
    case "ok":
      return contextOf(outcome.row, outcome.accessToken);
    case "gone":
      throw new ProviderAuthError("This calendar is not connected.", "no_credentials");
    case "reauth":
      await markConnectionBroken(connectionId, { status: "needs_reauth", error: outcome.error });
      throw new ProviderAuthError("The calendar connection needs to be reconnected.", outcome.error === "invalid_grant" ? "invalid_grant" : "no_credentials");
    case "transient":
    default:
      throw new ProviderTransientError(`Could not refresh the calendar token (${outcome.kind === "transient" ? outcome.error : "unknown"})`);
  }
}

/** Decrypted credentials for one connection, refreshed when needed. */
export async function getConnectionContext(connectionId: string): Promise<ConnectionContext> {
  const db = await getDb();
  const [row] = await db.select().from(calendarConnections).where(eq(calendarConnections.id, connectionId)).limit(1);
  if (!row || row.status === "disconnected") throw new ProviderAuthError("This calendar is not connected.", "no_credentials");
  if (row.status === "needs_reauth") throw new ProviderAuthError("The calendar connection needs to be reconnected.", "no_credentials");
  if (row.provider !== "google") throw new ProviderAuthError("This calendar provider is not supported on this server.", "unsupported");
  const access = await decryptOrNull(row.accessTokenEnc);
  if (access && !expiringSoon(row.tokenExpiresAt)) return contextOf(row, access);
  return refreshAccessToken(row.id, { staleToken: access });
}

/**
 * Runs `fn` with the connection's credentials. A 401 refreshes once and retries; credential problems update the
 * connection status before the error propagates.
 */
export async function withConnection<T>(connectionId: string, fn: (ctx: ConnectionContext) => Promise<T>): Promise<T> {
  let ctx = await getConnectionContext(connectionId);
  try {
    return await fn(ctx);
  } catch (e) {
    if (!isProviderAuthError(e)) throw e;
    if (e.reason === "unauthorized") {
      ctx = await refreshAccessToken(connectionId, { staleToken: ctx.accessToken, force: true });
      try {
        return await fn(ctx);
      } catch (e2) {
        if (isProviderAuthError(e2)) await noteAuthFailure(connectionId, e2);
        throw e2;
      }
    }
    await noteAuthFailure(connectionId, e);
    throw e;
  }
}

async function noteAuthFailure(connectionId: string, e: ProviderAuthError): Promise<void> {
  if (e.reason === "api_disabled") {
    await markConnectionBroken(connectionId, { status: "error", error: "Google Calendar API is not enabled for this server's OAuth client." });
    return;
  }
  if (e.reason === "unsupported" || e.reason === "no_credentials") return; // nothing a status change would fix
  await markConnectionBroken(connectionId, { status: "needs_reauth", error: e.reason ?? e.message });
}

/** Encrypts the tokens of an OAuth grant for storage. A null refresh token keeps the stored one (Google). */
export async function encryptedTokenColumns(tokens: { accessToken: string; refreshToken?: string | null; expiresAt?: Date | null; scopes: string[] }) {
  return {
    accessTokenEnc: await encrypt(tokens.accessToken),
    tokenExpiresAt: tokens.expiresAt ?? null,
    ...(tokens.refreshToken ? { refreshTokenEnc: await encrypt(tokens.refreshToken) } : {}),
    scopes: tokens.scopes,
  };
}
