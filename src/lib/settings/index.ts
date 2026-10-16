// Account settings services (SPEC BR-01 to BR-06, BR-08, BR-10, AU-05, GEN-17; docs/SCOPE.md item 14). Server only.
//
// - Profile: name, welcome message (shown on the landing page), time zone, time and date formats.
// - Images: the avatar (BR-02, square 256px, cropped and resized in the browser) and the logo (BR-05, at most 880px)
//   replace the previous file; "Remove" clears it (removing the avatar also drops the provider picture, so initials
//   show, Calendly parity).
// - Branding: the "Use {AppName} branding" switch (users.show_branding) hides the Powered by ribbon and email footer.
// - My Link: live availability of a handle and the change itself (old slug released at once, so /{old} is 404).
// - Login and security: the active sessions of the user, revoking one (only the user's own: the session id must belong
//   to the signed-in user, never trust the id alone) or every other session.
// Slug changes and session revocations are audited (GEN-17); password changes are audited by changePassword.
import "server-only";
import { and, asc, desc, eq, gt, isNull, ne } from "drizzle-orm";
import { getDb, withTx, type DbOrTx } from "@/db";
import { eventTypes, files, oauthAccounts, sessions, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { ActorCtx } from "@/lib/authz";
import { AppError } from "@/lib/errors";
import { deleteFile, fileUrl, saveImageUpload } from "@/lib/files";
import { claimHandle, isHandleAvailable } from "@/lib/slugs";
import { now } from "@/lib/time/now";
import {
  asDateFormat,
  asTimeFormat,
  AVATAR_SIZE,
  HANDLE_MESSAGES,
  localHandleCheck,
  LOGO_MAX_SIZE,
  sanitizeHandleInput,
  type HandleCheck,
  type ImageKind,
  type ProfileFormValues,
  type ProfileInputValue,
  type SessionListItem,
} from "./schemas";
import { parseUserAgent } from "./user-agent";

export * from "./schemas";
export { parseUserAgent, type ParsedUserAgent } from "./user-agent";

type UserRow = typeof users.$inferSelect;
type ImagePurpose = "avatar" | "logo";

const ACCOUNT_GONE = "Your account could not be found.";

async function lockLiveUser(tx: DbOrTx, userId: string): Promise<UserRow> {
  const [user] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .limit(1)
    .for("update");
  if (!user) throw new AppError("not_found", ACCOUNT_GONE);
  return user;
}

// ---------------------------------------------------------------------------------------------------------- Profile

/** The picture shown for a user: the uploaded avatar, else the provider (Google) picture, else null (initials). */
export function avatarUrlOf(user: Pick<UserRow, "avatarFileId" | "avatarUrl">): string | null {
  if (user.avatarFileId) return fileUrl(user.avatarFileId);
  return user.avatarUrl && /^https:\/\//.test(user.avatarUrl) ? user.avatarUrl : null;
}

export function logoUrlOf(user: Pick<UserRow, "logoFileId">): string | null {
  return user.logoFileId ? fileUrl(user.logoFileId) : null;
}

/** The Profile form values of a user. */
export function profileFormValues(user: Pick<UserRow, "name" | "welcomeMessage" | "timezone" | "timeFormat" | "dateFormat">): ProfileFormValues {
  return {
    name: user.name,
    welcomeMessage: user.welcomeMessage ?? "",
    timezone: user.timezone || "UTC",
    timeFormat: asTimeFormat(user.timeFormat),
    dateFormat: asDateFormat(user.dateFormat),
  };
}

/** Saves the Profile form (BR-01, BR-03, BR-04). An empty welcome message shows none on the landing page. */
export async function updateProfile(db: DbOrTx, userId: string, input: ProfileInputValue): Promise<ProfileFormValues> {
  const [row] = await db
    .update(users)
    .set({
      name: input.name,
      welcomeMessage: input.welcomeMessage,
      timezone: input.timezone,
      timeFormat: input.timeFormat,
      dateFormat: input.dateFormat,
      updatedAt: now(),
    })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .returning();
  if (!row) throw new AppError("not_found", ACCOUNT_GONE);
  return profileFormValues(row);
}

// ----------------------------------------------------------------------------------------------- Images (BR-02, BR-05)

const PURPOSE: Record<ImageKind, ImagePurpose> = { avatar: "avatar", logo: "logo" };
const MAX_DIMENSION: Record<ImageKind, number> = { avatar: AVATAR_SIZE, logo: LOGO_MAX_SIZE };

/** Deletes a replaced image, but only a file this user uploaded for the same purpose. */
async function deleteReplacedImage(tx: DbOrTx, fileId: string | null, userId: string, purpose: ImagePurpose): Promise<void> {
  if (!fileId) return;
  const [row] = await tx
    .select({ id: files.id, ownerUserId: files.ownerUserId, purpose: files.purpose })
    .from(files)
    .where(eq(files.id, fileId))
    .limit(1);
  if (row && row.ownerUserId === userId && row.purpose === purpose) await deleteFile(row.id, tx);
}

/**
 * Stores an uploaded avatar or logo (type by magic bytes, at most 5 MB, avatar at most 256px and logo at most 880px on
 * either side: the browser crops and resizes before uploading) and points the user at it, replacing the previous
 * file. Throws AppError("validation") with a `file` field error for unusable images.
 */
export async function saveUserImage(
  db: DbOrTx,
  userId: string,
  kind: ImageKind,
  data: Blob | Uint8Array | ArrayBuffer,
): Promise<{ fileId: string; url: string; width: number; height: number }> {
  return withTx(db, async (tx) => {
    const user = await lockLiveUser(tx, userId);
    const saved = await saveImageUpload(data, PURPOSE[kind], { ownerUserId: userId, maxDimension: MAX_DIMENSION[kind], db: tx });
    const at = now();
    if (kind === "avatar") {
      await tx.update(users).set({ avatarFileId: saved.id, updatedAt: at }).where(eq(users.id, userId));
      await deleteReplacedImage(tx, user.avatarFileId, userId, "avatar");
    } else {
      await tx.update(users).set({ logoFileId: saved.id, updatedAt: at }).where(eq(users.id, userId));
      await deleteReplacedImage(tx, user.logoFileId, userId, "logo");
    }
    return { fileId: saved.id, url: saved.url, width: saved.width, height: saved.height };
  });
}

/** "Remove" (BR-02, BR-05). Removing the avatar also drops the provider picture so the initials show. */
export async function removeUserImage(db: DbOrTx, userId: string, kind: ImageKind): Promise<void> {
  await withTx(db, async (tx) => {
    const user = await lockLiveUser(tx, userId);
    const at = now();
    if (kind === "avatar") {
      await tx.update(users).set({ avatarFileId: null, avatarUrl: null, updatedAt: at }).where(eq(users.id, userId));
      await deleteReplacedImage(tx, user.avatarFileId, userId, "avatar");
    } else {
      await tx.update(users).set({ logoFileId: null, updatedAt: at }).where(eq(users.id, userId));
      await deleteReplacedImage(tx, user.logoFileId, userId, "logo");
    }
  });
}

// ---------------------------------------------------------------------------------------------------- Branding (BR-06)

/** "Use {AppName} branding": off hides the Powered by ribbon on public pages and the footer in emails. */
export async function setShowBranding(db: DbOrTx, userId: string, showBranding: boolean): Promise<boolean> {
  const [row] = await db
    .update(users)
    .set({ showBranding, updatedAt: now() })
    .where(and(eq(users.id, userId), isNull(users.deletedAt)))
    .returning({ showBranding: users.showBranding });
  if (!row) throw new AppError("not_found", ACCOUNT_GONE);
  return row.showBranding;
}

/** The event type the Branding preview shows: the user's first active, public personal event type, if any. */
export async function brandingPreviewEvent(userId: string, db?: DbOrTx): Promise<{ name: string; durationMinutes: number } | null> {
  const d = db ?? (await getDb());
  const [row] = await d
    .select({ name: eventTypes.name, durationMinutes: eventTypes.durationMinutes })
    .from(eventTypes)
    .where(
      and(
        eq(eventTypes.ownerUserId, userId),
        eq(eventTypes.scope, "personal"),
        eq(eventTypes.type, "standard"),
        isNull(eventTypes.teamId),
        eq(eventTypes.active, true),
        isNull(eventTypes.deletedAt),
      ),
    )
    .orderBy(asc(eventTypes.position), asc(eventTypes.createdAt))
    .limit(1);
  return row ?? null;
}

// ----------------------------------------------------------------------------------------------------- My Link (BR-08)

/** Live availability of a handle for this user (the input is normalized first, GEN-02). */
export async function checkHandle(db: DbOrTx, userId: string, raw: string): Promise<HandleCheck> {
  const slug = sanitizeHandleInput(raw);
  const local = localHandleCheck(slug);
  if (local) return local;
  const [user] = await db.select({ slug: users.slug }).from(users).where(eq(users.id, userId)).limit(1);
  if (user?.slug === slug) return { slug, status: "current", message: HANDLE_MESSAGES.current };
  const available = await isHandleAvailable(db, slug, { userId });
  return available ? { slug, status: "available", message: HANDLE_MESSAGES.available } : { slug, status: "taken", message: HANDLE_MESSAGES.taken };
}

function handleError(check: HandleCheck): AppError {
  const code = check.status === "empty" || check.status === "invalid" ? "validation" : "conflict";
  return new AppError(code, check.message, { fieldErrors: { slug: [check.message] } });
}

/**
 * Changes the user's URL (BR-08): the old slug stops working at once (no redirect, Calendly parity) and is released
 * for anyone to take; the change is audited. Taken, reserved or invalid slugs throw with a `slug` field error.
 */
export async function changeHandle(db: DbOrTx, actor: ActorCtx, raw: string): Promise<{ slug: string; previous: string | null; changed: boolean }> {
  const slug = sanitizeHandleInput(raw);
  const local = localHandleCheck(slug);
  if (local) throw handleError(local);
  return withTx(db, async (tx) => {
    const user = await lockLiveUser(tx, actor.user.id);
    if (user.slug === slug) return { slug, previous: user.slug, changed: false };
    if (!(await isHandleAvailable(tx, slug, { userId: user.id }))) throw handleError({ slug, status: "taken", message: HANDLE_MESSAGES.taken });
    await claimHandle(tx, slug, { userId: user.id });
    await tx.update(users).set({ updatedAt: now() }).where(eq(users.id, user.id));
    await audit(
      {
        action: "user.slug_changed",
        namespace: "settings",
        targetType: "user",
        targetId: user.id,
        details: { from: user.slug, to: slug },
        actor,
      },
      tx,
    );
    return { slug, previous: user.slug, changed: true };
  });
}

// ------------------------------------------------------------------------------------- Login and security (BR-10, AU-05)

const MAX_LISTED_SESSIONS = 50;

/**
 * The user's live sessions (not revoked, not expired), the current one first, then by last activity. At most 50 are
 * listed; the current session is always among them.
 */
export async function listUserSessions(db: DbOrTx, userId: string, currentSessionId: string | null): Promise<SessionListItem[]> {
  const columns = {
    id: sessions.id,
    ip: sessions.ip,
    userAgent: sessions.userAgent,
    createdAt: sessions.createdAt,
    lastSeenAt: sessions.lastSeenAt,
  };
  const live = and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now()));
  const rows = await db.select(columns).from(sessions).where(live).orderBy(desc(sessions.lastSeenAt)).limit(MAX_LISTED_SESSIONS);
  if (currentSessionId && !rows.some((r) => r.id === currentSessionId)) {
    const [current] = await db.select(columns).from(sessions).where(and(live, eq(sessions.id, currentSessionId))).limit(1);
    if (current) {
      if (rows.length >= MAX_LISTED_SESSIONS) rows.pop();
      rows.push(current);
    }
  }
  const items = rows.map((r): SessionListItem => {
    const ua = parseUserAgent(r.userAgent);
    return {
      id: r.id,
      current: r.id === currentSessionId,
      label: ua.label,
      browser: ua.browser,
      os: ua.os,
      device: ua.device,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
    };
  });
  return items.sort((a, b) => Number(b.current) - Number(a.current));
}

/**
 * "Log out" of one session (BR-10). The session must belong to the actor (another user's session id is "not found",
 * never revoked) and must not be the current one (that is the account menu's Log out).
 */
export async function revokeUserSession(db: DbOrTx, actor: ActorCtx, sessionId: string, currentSessionId: string | null): Promise<void> {
  if (sessionId === currentSessionId) {
    throw new AppError("validation", "This is the session you are using. Use Log out in the account menu to end it.");
  }
  await withTx(db, async (tx) => {
    const [row] = await tx
      .update(sessions)
      .set({ revokedAt: now() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, actor.user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, now())))
      .returning({ id: sessions.id, userAgent: sessions.userAgent });
    if (!row) throw new AppError("not_found", "This session has already ended.");
    await audit(
      {
        action: "user.session_revoked",
        namespace: "auth",
        targetType: "session",
        targetId: row.id,
        details: { device: parseUserAgent(row.userAgent).label },
        actor,
      },
      tx,
    );
  });
}

/**
 * "Log out of all other sessions" (AU-05, BR-10): every live session of the actor except the current one. Returns how
 * many were ended (expired sessions are already unusable and are neither touched nor counted).
 */
export async function revokeOtherUserSessions(db: DbOrTx, actor: ActorCtx, currentSessionId: string): Promise<number> {
  return withTx(db, async (tx) => {
    const at = now();
    const rows = await tx
      .update(sessions)
      .set({ revokedAt: at })
      .where(and(eq(sessions.userId, actor.user.id), ne(sessions.id, currentSessionId), isNull(sessions.revokedAt), gt(sessions.expiresAt, at)))
      .returning({ id: sessions.id });
    if (rows.length > 0) {
      await audit({ action: "user.other_sessions_revoked", namespace: "auth", targetType: "user", targetId: actor.user.id, details: { count: rows.length }, actor }, tx);
    }
    return rows.length;
  });
}

export type LoginMethods = { email: string; hasPassword: boolean; providers: ("google" | "microsoft")[] };

/**
 * How the user signs in: the login email, whether a password is set ("Change password") or not ("Set password" for
 * accounts created with Google), and the linked sign-in providers.
 */
export async function getLoginMethods(userId: string, db?: DbOrTx): Promise<LoginMethods> {
  const d = db ?? (await getDb());
  const [user] = await d.select({ email: users.email, passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError("not_found", ACCOUNT_GONE);
  const linked = await d.select({ provider: oauthAccounts.provider }).from(oauthAccounts).where(eq(oauthAccounts.userId, userId));
  const providers = [...new Set(linked.map((r) => r.provider))].sort();
  return { email: user.email, hasPassword: Boolean(user.passwordHash), providers };
}
