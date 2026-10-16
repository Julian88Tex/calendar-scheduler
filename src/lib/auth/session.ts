// Sessions core (ARCHITECTURE section 18.3, SPEC AU-05, AU-06, GEN-08).
//
// - A random 32-byte token lives in the `sid` cookie (httpOnly, SameSite=Lax, Secure on https, path /); the database
//   stores only its SHA-256 (sessions.token_hash), with user, last seen, expiry (30 days), IP and user agent.
// - Sliding expiry: when last_seen_at is older than 24 hours the session's expires_at moves to now() + 30 days. The
//   database write never happens during RSC render: getSession() schedules it with after() (runs once the response is
//   sent) and touchSession() does it directly in Server Actions and Route Handlers. The cookie itself is long lived
//   (400 days, the browser cap) so the database expiry is the only clock; revoked or expired sessions are rejected.
// - two_factor_pending sessions only reach /login/two-factor (AU-09): requireUser() sends them there.
// - All expiry comparisons use the business clock now() as $now (fake time aware).
import "server-only";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import type { Route } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { cache } from "react";
import { getDb, type DbOrTx } from "@/db";
import { sessions, users } from "@/db/schema";
import { hashToken, randomToken } from "../crypto";
import { AppError } from "../errors";
import { log } from "../logger";
import { now, nowMs } from "../time/now";
import { appUsesHttps, safeNextPath } from "../url";

export const SESSION_COOKIE = "sid";
/** Database lifetime of a session (sliding). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** last_seen_at older than this extends the session. */
export const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
/** Cookie lifetime (browser cap); the database expiry decides validity. */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
/** Request header set by src/proxy.ts with the current path and query (for ?next= on login redirects). */
export const PATHNAME_HEADER = "x-kairos-url";

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type SessionData = { session: SessionRow; user: UserRow };

/** Cookie attributes for the session cookie. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: appUsesHttps() || process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  };
}

/** Inserts a session row and returns the plaintext token (set it as the `sid` cookie). */
export async function createSessionRecord(
  db: DbOrTx,
  userId: string,
  opts: { twoFactorPending?: boolean; ip?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; session: SessionRow }> {
  const token = randomToken(32);
  const at = now();
  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(at.getTime() + SESSION_TTL_MS),
      lastSeenAt: at,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ? opts.userAgent.slice(0, 512) : null,
      twoFactorPending: opts.twoFactorPending ?? false,
    })
    .returning();
  if (!session) throw new Error("session insert returned no row");
  return { token, session };
}

/** The live session and user for a plaintext token, or null (unknown, revoked, expired, or deleted user). */
export async function lookupSession(db: DbOrTx, token: string | null | undefined): Promise<SessionData | null> {
  if (!token || token.length > 200) return null;
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now()),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/** True when the session should slide (last seen more than 24 hours ago). */
export function sessionNeedsRefresh(session: Pick<SessionRow, "lastSeenAt">, atMs: number = nowMs()): boolean {
  return atMs - session.lastSeenAt.getTime() > SESSION_REFRESH_AFTER_MS;
}

/** Extends a session (last_seen_at = now, expires_at = now + 30 days) and records user activity. */
export async function touchSessionRecord(db: DbOrTx, sessionId: string, userId?: string): Promise<void> {
  const at = now();
  await db
    .update(sessions)
    .set({ lastSeenAt: at, expiresAt: new Date(at.getTime() + SESSION_TTL_MS) })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt), gt(sessions.expiresAt, at)));
  if (userId) await db.update(users).set({ lastActiveAt: at }).where(eq(users.id, userId));
}

async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const fwd = h.get("x-vercel-forwarded-for") ?? h.get("x-forwarded-for") ?? h.get("x-real-ip");
    return { ip: fwd?.split(",")[0]?.trim() || null, userAgent: h.get("user-agent") };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * Creates a session for the user and sets the `sid` cookie. Only callable in Server Actions and Route Handlers (Next
 * forbids setting cookies during render). Returns the new session id.
 */
export async function createSession(
  userId: string,
  opts: { twoFactorPending?: boolean } = {},
): Promise<{ sessionId: string; expiresAt: Date }> {
  const db = await getDb();
  const meta = await requestMeta();
  const { token, session } = await createSessionRecord(db, userId, { ...meta, twoFactorPending: opts.twoFactorPending });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions());
  if (!opts.twoFactorPending) await db.update(users).set({ lastLoginAt: now(), lastActiveAt: now() }).where(eq(users.id, userId));
  return { sessionId: session.id, expiresAt: session.expiresAt };
}

/**
 * The current request's session and user (includes two_factor_pending sessions; check session.twoFactorPending), or
 * null. Cached per request with React cache(). Read only: a stale session is extended after the response via after().
 */
export const getSession = cache(async (): Promise<SessionData | null> => {
  let token: string | undefined;
  try {
    token = (await cookies()).get(SESSION_COOKIE)?.value;
  } catch {
    return null; // outside a request scope
  }
  if (!token) return null;
  const db = await getDb();
  const data = await lookupSession(db, token);
  if (data && !data.session.twoFactorPending && sessionNeedsRefresh(data.session)) {
    const { id } = data.session;
    const userId = data.user.id;
    try {
      after(() =>
        touchSessionRecord(db, id, userId).catch((e: unknown) => log.warn("session.touch_failed", { error: e })),
      );
    } catch {
      // after() is unavailable outside a request: the next action or route handler extends the session instead.
    }
  }
  return data;
});

/** The signed-in user (fully authenticated, not 2FA pending), or null. For public pages that show owner tools. */
export async function getCurrentUser(): Promise<UserRow | null> {
  const data = await getSession();
  return data && !data.session.twoFactorPending ? data.user : null;
}

async function currentPath(): Promise<string | null> {
  try {
    return (await headers()).get(PATHNAME_HEADER);
  } catch {
    return null;
  }
}

export type RequireUserOptions = {
  /** "redirect" (default): Server Components and Server Actions redirect to /login?next=...; "throw": AppError(401). */
  onMissing?: "redirect" | "throw";
  /** Return path for the login redirect (defaults to the current path from the proxy header). */
  next?: string;
};

/** The full session of a signed-in user; see requireUser(). */
export async function requireSession(opts: RequireUserOptions = {}): Promise<SessionData> {
  const data = await getSession();
  if (data && !data.session.twoFactorPending) return data;
  if (opts.onMissing === "throw") throw new AppError("unauthorized");
  if (data?.session.twoFactorPending) redirect("/login/two-factor" as Route);
  const next = safeNextPath(opts.next ?? (await currentPath()), "");
  redirect((next ? `/login?next=${encodeURIComponent(next)}` : "/login") as Route);
}

/**
 * The signed-in user. Server Components (and actions) redirect to /login?next=... when signed out and to
 * /login/two-factor for a pending second factor; route handlers pass { onMissing: "throw" } to get AppError(401).
 */
export async function requireUser(opts: RequireUserOptions = {}): Promise<UserRow> {
  return (await requireSession(opts)).user;
}

/**
 * Extends the current session when it is older than 24 hours. For Server Actions and Route Handlers (runAction calls
 * it); a no-op outside a request or without a session.
 */
export async function touchSession(): Promise<void> {
  const data = await getSession();
  if (!data || data.session.twoFactorPending || !sessionNeedsRefresh(data.session)) return;
  await touchSessionRecord(await getDb(), data.session.id, data.user.id);
}

/**
 * Revokes one session (logout, sign-in replacing the previous session). Pass `userId` whenever the id comes from user
 * input (Settings > Login): only a session of that user is revoked, so a foreign id is a no-op. Without it the caller
 * must hold the id of the request's own session (getSession()).
 */
export async function revokeSession(id: string, opts: { userId?: string } = {}): Promise<void> {
  const db = await getDb();
  const owned = opts.userId === undefined ? undefined : eq(sessions.userId, opts.userId);
  await db.update(sessions).set({ revokedAt: now() }).where(and(eq(sessions.id, id), owned, isNull(sessions.revokedAt)));
}

/** "Log out of all other sessions" (AU-05) and password resets (AU-07). */
export async function revokeOtherSessions(userId: string, keepSessionId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(sessions)
    .set({ revokedAt: now() })
    .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId), isNull(sessions.revokedAt)));
}

/** Revokes every session of a user (account deletion, admin removal). */
export async function revokeAllSessions(userId: string, db?: DbOrTx): Promise<void> {
  const d = db ?? (await getDb());
  await d.update(sessions).set({ revokedAt: now() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/** Logout: revokes the current session server side and clears the cookie (Server Actions and Route Handlers). */
export async function destroySession(): Promise<void> {
  const data = await getSession();
  if (data) await revokeSession(data.session.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
}

/** Marks the second factor as passed for a pending session (AU-09, after a valid TOTP or recovery code). */
export async function completeTwoFactor(sessionId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(sessions)
    .set({ twoFactorPending: false, lastSeenAt: now() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/** Active sessions of a user, newest first (Settings > Login). */
export async function listSessions(userId: string): Promise<SessionRow[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now())));
  return rows.sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
}
