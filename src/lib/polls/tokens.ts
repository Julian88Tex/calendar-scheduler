// Voter capability tokens (SPEC MP-06, MP-11, MP-23, MP-30; research meeting-polls.md B15).
//
// Edit and invite tokens are 32 bytes (base64url) derived with HMAC-SHA256 from the instance session secret and the
// participant id, so later emails (reminders, "Review or change your response") can carry them without ever storing a
// plain token: the database keeps only their SHA-256 hashes (meeting_poll_participants.edit_token_hash and
// invite_token_hash, unique indexes used for lookups). A removed participant is soft deleted, so its tokens stop
// working. Unsubscribe tokens are a separate HMAC ("{participantId}.{mac}") checked without a lookup, and never grant
// edit rights (they end up in List-Unsubscribe headers).
//
// The edit token lives in two httpOnly cookies set together, EDIT_COOKIE on /p/{slug} (the voter page and its Server
// Actions) and EDIT_API_COOKIE on /api/public/polls/{slug} (the public routes), through the embed-safe cookie helpers
// (the page mirrors it in localStorage inside embeds and sends it back in the x-kairos-fallback header).
import "server-only";
import { createHmac } from "node:crypto";
import { appendEmbedSafeCookie, readEmbedSafeCookie, readEmbedSafeCookieFromHeaders, setEmbedSafeCookie } from "@/lib/cookies";
import { hashToken, timingSafeEqualStr } from "@/lib/crypto";
import { isUuid } from "@/lib/ids";
import { getSecret } from "@/lib/secrets";
import { absoluteUrl } from "@/lib/url";
import { EDIT_API_COOKIE, EDIT_COOKIE, EDIT_COOKIE_MAX_AGE_SECONDS } from "./constants";

/**
 * Loads the instance keys before a transaction derives tokens or checks codes: PGlite runs one transaction at a time,
 * so a first key read through getDb() from inside a transaction would wait on that transaction forever.
 */
export async function warmPollKeys(): Promise<void> {
  await Promise.all([getSecret("session_secret"), getSecret("encryption_key")]);
}

function macWithKey(key: Buffer, purpose: string, participantId: string): Buffer {
  return createHmac("sha256", key).update(`poll-${purpose}:v1:${participantId}`).digest();
}

async function mac(purpose: string, participantId: string): Promise<Buffer> {
  return macWithKey(await getSecret("session_secret"), purpose, participantId);
}

/** tokenHashesFor with an explicit session key (the seed reads the key inside its own transaction). */
export function tokenHashesWithKey(key: Buffer, participantId: string): { editTokenHash: string; inviteTokenHash: string } {
  return {
    editTokenHash: hashToken(macWithKey(key, "edit", participantId).toString("base64url")),
    inviteTokenHash: hashToken(macWithKey(key, "invite", participantId).toString("base64url")),
  };
}

/** The participant's edit token (32 bytes, base64url). */
export async function editTokenFor(participantId: string): Promise<string> {
  return (await mac("edit", participantId)).toString("base64url");
}

/** The participant's personal invite link token. */
export async function inviteTokenFor(participantId: string): Promise<string> {
  return (await mac("invite", participantId)).toString("base64url");
}

/** SHA-256 hashes stored for a participant (edit always, invite for invited rows). */
export async function tokenHashesFor(participantId: string): Promise<{ editTokenHash: string; inviteTokenHash: string }> {
  return { editTokenHash: hashToken(await editTokenFor(participantId)), inviteTokenHash: hashToken(await inviteTokenFor(participantId)) };
}

/** Hash of a presented token for the unique index lookups (null for obviously invalid input). */
export function presentedTokenHash(token: string | null | undefined): string | null {
  const t = token?.trim();
  if (!t || t.length < 20 || t.length > 200 || !/^[A-Za-z0-9_-]+$/.test(t)) return null;
  return hashToken(t);
}

/** "{participantId}.{mac}" for unsubscribe links and List-Unsubscribe headers. */
export async function unsubscribeTokenFor(participantId: string): Promise<string> {
  return `${participantId}.${(await mac("unsubscribe", participantId)).subarray(0, 18).toString("base64url")}`;
}

/** The participant id of a valid unsubscribe token, else null. */
export async function verifyUnsubscribeToken(token: string | null | undefined): Promise<string | null> {
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,40})$/i.exec(token?.trim() ?? "");
  if (!m || !isUuid(m[1])) return null;
  const expected = (await mac("unsubscribe", m[1]!)).subarray(0, 18).toString("base64url");
  return timingSafeEqualStr(expected, m[2]!) ? m[1]! : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Links

/** The personal invite link /p/{slug}?i={token} (MP-06). */
export async function inviteLink(slug: string, participantId: string): Promise<string> {
  return absoluteUrl(`/p/${encodeURIComponent(slug)}?i=${encodeURIComponent(await inviteTokenFor(participantId))}`);
}

/** The magic edit link: sets the edit cookie and opens the poll (setting a cookie changes no vote, MP-11). */
export async function editLink(slug: string, participantId: string): Promise<string> {
  return absoluteUrl(`/api/public/polls/${encodeURIComponent(slug)}/edit?t=${encodeURIComponent(await editTokenFor(participantId))}`);
}

/** The unsubscribe page (GET shows a button, POST unsubscribes; GEN-08). */
export async function unsubscribePageUrl(slug: string, participantId: string): Promise<string> {
  return absoluteUrl(`/p/${encodeURIComponent(slug)}/unsubscribe?t=${encodeURIComponent(await unsubscribeTokenFor(participantId))}`);
}

/** The one-click List-Unsubscribe POST endpoint (RFC 8058). */
export async function unsubscribePostUrl(slug: string, participantId: string): Promise<string> {
  return absoluteUrl(`/api/public/polls/${encodeURIComponent(slug)}/unsubscribe?t=${encodeURIComponent(await unsubscribeTokenFor(participantId))}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Edit cookie

/** Paths the edit cookies are scoped to: [voter page, public routes]. */
export function editCookiePaths(slug: string): [string, string] {
  const s = encodeURIComponent(slug);
  return [`/p/${s}`, `/api/public/polls/${s}`];
}

/** Sets the edit cookies on the current Server Action or Route Handler response (both scopes). */
export async function setEditCookie(slug: string, token: string, opts: { embed?: boolean } = {}): Promise<void> {
  const [page, api] = editCookiePaths(slug);
  await setEmbedSafeCookie(EDIT_COOKIE, token, { maxAgeSeconds: EDIT_COOKIE_MAX_AGE_SECONDS, path: page, embed: opts.embed });
  await setEmbedSafeCookie(EDIT_API_COOKIE, token, { maxAgeSeconds: EDIT_COOKIE_MAX_AGE_SECONDS, path: api, embed: opts.embed });
}

/** Appends the edit cookies to a hand-built Response (redirects). */
export function appendEditCookie(response: Response, slug: string, token: string, opts: { embed?: boolean } = {}): Response {
  const [page, api] = editCookiePaths(slug);
  appendEmbedSafeCookie(response, EDIT_COOKIE, token, { maxAgeSeconds: EDIT_COOKIE_MAX_AGE_SECONDS, path: page, embed: opts.embed });
  appendEmbedSafeCookie(response, EDIT_API_COOKIE, token, { maxAgeSeconds: EDIT_COOKIE_MAX_AGE_SECONDS, path: api, embed: opts.embed });
  return response;
}

/**
 * The edit token sent with a request: the route cookie, else the page cookie, else the embed localStorage fallback
 * header (x-kairos-fallback-kairos_poll_edit).
 */
export function readEditToken(request: Request | { headers: Headers }): string | null {
  return readEmbedSafeCookie(request, EDIT_API_COOKIE) ?? readEmbedSafeCookie(request, EDIT_COOKIE);
}

/** The edit token in a Server Action or Server Component (next/headers). */
export async function readEditTokenFromHeaders(): Promise<string | null> {
  return readEmbedSafeCookieFromHeaders(EDIT_COOKIE);
}
