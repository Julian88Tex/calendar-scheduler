// The visitor's compare connection (booking page "Compare with my calendar"). Server only.
//
// After the visitor allows Google (OAuth intent compare_calendar, scopes calendar.freebusy and
// calendar.calendarlist.readonly, no offline access), their access token is sealed with AES-256-GCM (encrypt() from
// src/lib/crypto.ts) into the httpOnly cookie COMPARE_COOKIE, scoped to COMPARE_API_PATH and living no longer than the
// token (an hour at most). Nothing is written to the database: no token, no calendar, no event. "Disconnect" deletes the
// cookie. The token is not revoked at Google: a revoke ends the whole grant of this app for that Google account, which
// would also cut the host's own calendar and Gmail access if the host tried the compare with their own account; it
// expires within the hour anyway.
//
// E2E mode only: a session may carry fake calendars and busy times instead of a token (POST /api/test/compare), so the
// panel can be tested without Google.
import "server-only";
import { appendEmbedSafeCookie, readEmbedSafeCookie } from "@/lib/cookies";
import { decrypt, encrypt, randomToken } from "@/lib/crypto";
import { isE2eMode } from "@/lib/env";
import { nowMs } from "@/lib/time/now";
import { COMPARE_API_PATH, COMPARE_COOKIE, COMPARE_MAX_AGE_SECONDS } from "./constants";

export type FakeCompareData = {
  calendars: { id: string; name: string; color?: string | null; primary?: boolean; selected?: boolean }[];
  busy: Record<string, { start: string; end: string }[]>;
};

export type CompareSession = {
  v: 1;
  /** Random id of this connection (rate limit key; never the token). */
  id: string;
  accessToken: string;
  email: string;
  /** Epoch ms after which the token no longer works. */
  expiresAt: number;
  fake?: FakeCompareData;
};

/** A new session that ends when the token does, and within COMPARE_MAX_AGE_SECONDS. */
export function newCompareSession(p: { accessToken: string; email: string; expiresAt: Date | null; fake?: FakeCompareData }): CompareSession {
  const cap = nowMs() + COMPARE_MAX_AGE_SECONDS * 1000;
  const expiresAt = Math.min(p.expiresAt?.getTime() ?? cap, cap);
  return { v: 1, id: randomToken(16), accessToken: p.accessToken, email: p.email, expiresAt, ...(p.fake ? { fake: p.fake } : {}) };
}

function isSession(v: unknown): v is CompareSession {
  const o = v as Partial<CompareSession> | null;
  return Boolean(o && o.v === 1 && typeof o.id === "string" && typeof o.accessToken === "string" && typeof o.email === "string" && typeof o.expiresAt === "number");
}

/** The session of a request, or null when missing, expired, tampered with or a fake outside E2E mode. */
export async function readCompareSession(request: Request): Promise<CompareSession | null> {
  const raw = readEmbedSafeCookie(request, COMPARE_COOKIE);
  if (!raw || raw.length > 8192) return null;
  try {
    const parsed = JSON.parse(await decrypt(raw)) as unknown;
    if (!isSession(parsed) || parsed.expiresAt <= nowMs()) return null;
    if (parsed.fake && !isE2eMode()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Sets the session cookie on a hand-built response. */
export async function appendCompareCookie(response: Response, session: CompareSession): Promise<Response> {
  const maxAgeSeconds = Math.max(1, Math.floor((session.expiresAt - nowMs()) / 1000));
  return appendEmbedSafeCookie(response, COMPARE_COOKIE, await encrypt(JSON.stringify(session)), { maxAgeSeconds, path: COMPARE_API_PATH });
}

/** Deletes the session cookie ("Disconnect", or a token Google no longer accepts). */
export function clearCompareCookie(response: Response): Response {
  return appendEmbedSafeCookie(response, COMPARE_COOKIE, "", { maxAgeSeconds: 0, path: COMPARE_API_PATH });
}
