// Account settings on PGlite (SPEC BR-01 to BR-06, BR-08, BR-10, AU-05, AU-10, GEN-02, GEN-08, GEN-17; docs/SCOPE.md
// item 14): profile persistence, avatar and logo upload, replace and remove (including the route handler with its
// same-origin check and the 5 MB limit), the branding switch, live handle checks and slug changes (old slug released
// and its landing page gone), sessions listing and revocation limited to the user's own sessions, password changes
// through the Server Action, and the audit entries.
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./_request")).nextHeadersMock);
vi.mock("next/cache", async () => (await import("./_request")).nextCacheMock);

import { auditLog, files, handles, sessions, users } from "@/db/schema";
import { loadLanding } from "@/components/booking/server/landing";
import { createSessionRecord, lookupSession, SESSION_COOKIE } from "@/lib/auth/session";
import { loadActorCtx, type ActorCtx } from "@/lib/authz";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { isAppError } from "@/lib/errors";
import { fileUrl } from "@/lib/files";
import {
  avatarUrlOf,
  brandingPreviewEvent,
  changeHandle,
  checkHandle,
  getLoginMethods,
  listUserSessions,
  profileFormValues,
  removeUserImage,
  revokeOtherUserSessions,
  revokeUserSession,
  saveUserImage,
  setShowBranding,
  updateProfile,
} from "@/lib/settings";
import {
  changePasswordAction,
  checkHandleAction,
  removeImageAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
  saveHandleAction,
  saveProfileAction,
  setShowBrandingAction,
} from "@/lib/settings/actions";
import { handleImageUpload } from "@/lib/settings/uploads";
import { createEventType, createUser, type TestUser } from "../factories";
import { useTestDb } from "../helpers/db";
import { fakePng, jar, resetRequest } from "./_request";

const t = useTestDb();

async function actorOf(user: TestUser): Promise<ActorCtx> {
  const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
  return loadActorCtx(t.db, row!);
}

async function freshUser(user: TestUser) {
  const [row] = await t.db.select().from(users).where(eq(users.id, user.id));
  return row!;
}

/** Signs the fake request in as the user (sets the sid cookie) and returns the session id. */
async function signIn(user: TestUser, userAgent?: string): Promise<string> {
  const { token, session } = await createSessionRecord(t.db, user.id, { ip: "203.0.113.9", userAgent: userAgent ?? "Mozilla/5.0 (Macintosh) Chrome/141.0.0.0 Safari/537.36" });
  jar.set(SESSION_COOKIE, token);
  return session.id;
}

async function errorOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return e;
    throw e;
  }
  throw new Error("expected an AppError");
}

const PROFILE = { name: "Julian Joseph", welcomeMessage: "Hello there", timezone: "Europe/Berlin", timeFormat: "24h", dateFormat: "DD/MM/YYYY" } as const;

beforeEach(() => {
  resetRequest();
});

describe("profile (BR-01, BR-03, BR-04)", () => {
  it("saves name, welcome message, zone and formats", async () => {
    const user = await createUser(t.db, { name: "Old Name" });
    const saved = await updateProfile(t.db, user.id, { ...PROFILE });
    expect(saved).toEqual(PROFILE);
    const row = await freshUser(user);
    expect(profileFormValues(row)).toEqual(PROFILE);
  });

  it("shows the new welcome message, or none when cleared, on the landing page", async () => {
    const user = await createUser(t.db);
    await updateProfile(t.db, user.id, { ...PROFILE, welcomeMessage: "Book a time with me" });
    expect((await loadLanding(user.slug!))?.welcomeMessage).toBe("Book a time with me");
    expect((await loadLanding(user.slug!))?.name).toBe("Julian Joseph");
    await updateProfile(t.db, user.id, { ...PROFILE, welcomeMessage: "" });
    expect((await loadLanding(user.slug!))?.welcomeMessage).toBeNull();
  });

  it("validates through the Server Action and returns field errors", async () => {
    const user = await createUser(t.db);
    await signIn(user);
    const bad = await saveProfileAction({ ...PROFILE, welcomeMessage: "x".repeat(266), name: "" });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error("unreachable");
    expect(bad.error.code).toBe("validation");
    expect(bad.error.fieldErrors?.name).toEqual(["Enter your name."]);
    expect(bad.error.fieldErrors?.welcomeMessage).toEqual(["Use 265 characters or fewer."]);
    const good = await saveProfileAction({ ...PROFILE });
    expect(good).toEqual({ ok: true, data: PROFILE });
  });

  it("refuses signed-out callers", async () => {
    const res = await saveProfileAction({ ...PROFILE });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("unauthorized");
  });
});

describe("avatar and logo (BR-02, BR-05)", () => {
  it("stores an avatar, replaces it (deleting the old file) and removes it back to initials", async () => {
    const user = await createUser(t.db, { overrides: { avatarUrl: "https://lh3.googleusercontent.com/a/photo" } });
    expect(avatarUrlOf(await freshUser(user))).toBe("https://lh3.googleusercontent.com/a/photo");

    const first = await saveUserImage(t.db, user.id, "avatar", fakePng(256, 256));
    expect(first.url).toBe(fileUrl(first.fileId));
    expect(avatarUrlOf(await freshUser(user))).toBe(first.url);
    const [file] = await t.db.select().from(files).where(eq(files.id, first.fileId));
    expect(file).toMatchObject({ purpose: "avatar", ownerUserId: user.id, width: 256, height: 256, contentType: "image/png" });

    const second = await saveUserImage(t.db, user.id, "avatar", fakePng(200, 200));
    expect((await t.db.select().from(files).where(eq(files.id, first.fileId))).length).toBe(0);
    expect((await freshUser(user)).avatarFileId).toBe(second.fileId);
    expect((await loadLanding(user.slug!))?.avatarUrl).toBe(second.url);

    await removeUserImage(t.db, user.id, "avatar");
    const row = await freshUser(user);
    expect(row.avatarFileId).toBeNull();
    expect(row.avatarUrl).toBeNull();
    expect(avatarUrlOf(row)).toBeNull();
    expect((await t.db.select().from(files).where(eq(files.id, second.fileId))).length).toBe(0);
  });

  it("rejects avatars larger than 256px and logos larger than 880px", async () => {
    const user = await createUser(t.db);
    const avatar = await errorOf(saveUserImage(t.db, user.id, "avatar", fakePng(300, 300)));
    expect(avatar.code).toBe("validation");
    expect(avatar.fieldErrors?.file?.[0]).toMatch(/at most 256 by 256 pixels/);
    const logo = await errorOf(saveUserImage(t.db, user.id, "logo", fakePng(900, 400)));
    expect(logo.fieldErrors?.file?.[0]).toMatch(/at most 880 by 880 pixels/);
    const notImage = await errorOf(saveUserImage(t.db, user.id, "logo", new TextEncoder().encode("<svg onload=alert(1)>")));
    expect(notImage.fieldErrors?.file?.[0]).toBe("Upload a PNG, JPG, WebP or GIF image.");
    expect((await freshUser(user)).logoFileId).toBeNull();
  });

  it("stores the logo, shows it on the landing page and removes it", async () => {
    const user = await createUser(t.db);
    const logo = await saveUserImage(t.db, user.id, "logo", fakePng(880, 480));
    expect((await freshUser(user)).logoFileId).toBe(logo.fileId);
    expect((await loadLanding(user.slug!))?.logoUrl).toBe(logo.url);
    await removeUserImage(t.db, user.id, "logo");
    expect((await freshUser(user)).logoFileId).toBeNull();
    expect((await t.db.select().from(files).where(eq(files.id, logo.fileId))).length).toBe(0);
  });

  it("never deletes a file another user uploaded", async () => {
    const owner = await createUser(t.db);
    const other = await createUser(t.db);
    const foreign = await saveUserImage(t.db, owner.id, "avatar", fakePng(64, 64));
    await t.db.update(users).set({ avatarFileId: foreign.fileId }).where(eq(users.id, other.id));
    await removeUserImage(t.db, other.id, "avatar");
    expect((await t.db.select().from(files).where(eq(files.id, foreign.fileId))).length).toBe(1);
  });

  it("uploads through the route handler: same-origin only, 5 MB limit", async () => {
    const user = await createUser(t.db);
    await signIn(user);
    const post = (body: FormData, origin = "http://localhost:3000") =>
      handleImageUpload(new Request("http://localhost:3000/app/settings/profile/avatar", { method: "POST", body, headers: { origin } }), "avatar");
    const form = (bytes: Uint8Array<ArrayBuffer>) => {
      const fd = new FormData();
      fd.append("file", new File([bytes], "me.png", { type: "image/png" }));
      return fd;
    };

    const ok = await post(form(fakePng(256, 256)));
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { url: string; fileId: string };
    expect((await freshUser(user)).avatarFileId).toBe(body.fileId);

    const tooBig = await errorOf(post(form(fakePng(256, 256, 6 * 1024 * 1024))));
    expect(tooBig.status).toBe(413);
    expect(tooBig.fieldErrors?.file).toEqual(["Images must be smaller than 5 MB."]);

    const crossSite = await errorOf(post(form(fakePng(256, 256)), "https://evil.example"));
    expect(crossSite.code).toBe("forbidden");

    jar.clear();
    const signedOut = await errorOf(post(form(fakePng(256, 256))));
    expect(signedOut.code).toBe("unauthorized");
  });

  it("removes images through the Server Action", async () => {
    const user = await createUser(t.db);
    await signIn(user);
    await saveUserImage(t.db, user.id, "logo", fakePng(440, 240));
    expect(await removeImageAction({ kind: "logo" })).toEqual({ ok: true, data: { kind: "logo" } });
    expect((await freshUser(user)).logoFileId).toBeNull();
    const bad = await removeImageAction({ kind: "banner" });
    expect(bad.ok).toBe(false);
  });
});

describe("branding (BR-06)", () => {
  it("hides and shows the Powered by ribbon", async () => {
    const user = await createUser(t.db);
    expect((await loadLanding(user.slug!))?.ribbon).toBe(true);
    expect(await setShowBranding(t.db, user.id, false)).toBe(false);
    expect((await freshUser(user)).showBranding).toBe(false);
    await signIn(user);
    expect(await setShowBrandingAction({ showBranding: true })).toEqual({ ok: true, data: { showBranding: true } });
    expect((await freshUser(user)).showBranding).toBe(true);
  });

  it("previews the first active public event type", async () => {
    const user = await createUser(t.db);
    expect(await brandingPreviewEvent(user.id)).toBeNull();
    await createEventType(t.db, { owner: user, name: "Second", slug: "second", overrides: { position: 2, durationMinutes: 60 } });
    await createEventType(t.db, { owner: user, name: "First", slug: "first", overrides: { position: 1, durationMinutes: 45 } });
    expect(await brandingPreviewEvent(user.id)).toEqual({ name: "First", durationMinutes: 45 });
  });
});

describe("My Link (BR-08, GEN-02)", () => {
  it("reports every availability state", async () => {
    const me = await createUser(t.db, { slug: `me-${Date.now()}` });
    const other = await createUser(t.db, { slug: `taken-${Date.now()}` });
    expect((await checkHandle(t.db, me.id, "")).status).toBe("empty");
    expect((await checkHandle(t.db, me.id, "bad-")).status).toBe("invalid");
    expect(await checkHandle(t.db, me.id, "API")).toEqual({ slug: "api", status: "reserved", message: "This URL is not available." });
    expect(await checkHandle(t.db, me.id, other.slug!)).toEqual({ slug: other.slug, status: "taken", message: "This URL is taken" });
    expect((await checkHandle(t.db, me.id, me.slug!)).status).toBe("current");
    expect(await checkHandle(t.db, me.id, "Brand New Name")).toEqual({ slug: "brand-new-name", status: "available", message: "Available" });
  });

  it("changes the slug, releases the old one at once and audits the change", async () => {
    const old = `old-${Date.now()}`;
    const user = await createUser(t.db, { slug: old });
    const actor = await actorOf(user);
    expect(await loadLanding(old)).not.toBeNull();

    const result = await changeHandle(t.db, actor, "New Handle");
    expect(result).toEqual({ slug: "new-handle", previous: old, changed: true });
    expect((await freshUser(user)).slug).toBe("new-handle");
    expect(await t.db.select().from(handles).where(eq(handles.slug, old))).toEqual([]);
    expect((await t.db.select().from(handles).where(eq(handles.slug, "new-handle")))[0]?.userId).toBe(user.id);

    expect(await loadLanding(old)).toBeNull();
    expect((await loadLanding("new-handle"))?.handle).toBe("new-handle");

    const [entry] = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "user.slug_changed"), eq(auditLog.targetId, user.id)));
    expect(entry).toMatchObject({ namespace: "settings", actorUserId: user.id, details: { from: old, to: "new-handle" } });

    // Someone else can take the released slug right away.
    const next = await createUser(t.db, { withoutHandle: true, slug: undefined });
    const claimed = await changeHandle(t.db, await actorOf(next), old);
    expect(claimed.slug).toBe(old);
  });

  it("refuses taken, reserved and invalid slugs with a slug field error", async () => {
    const user = await createUser(t.db);
    const other = await createUser(t.db);
    const actor = await actorOf(user);
    const taken = await errorOf(changeHandle(t.db, actor, other.slug!));
    expect(taken.code).toBe("conflict");
    expect(taken.fieldErrors?.slug).toEqual(["This URL is taken"]);
    const reserved = await errorOf(changeHandle(t.db, actor, "Settings"));
    expect(reserved.fieldErrors?.slug).toEqual(["This URL is not available."]);
    const invalid = await errorOf(changeHandle(t.db, actor, "-"));
    expect(invalid.code).toBe("validation");
    expect((await freshUser(user)).slug).toBe(user.slug);
  });

  it("is a no-op for the current slug and works through the Server Actions", async () => {
    const user = await createUser(t.db);
    const actor = await actorOf(user);
    expect((await changeHandle(t.db, actor, user.slug!)).changed).toBe(false);
    await signIn(user);
    const check = await checkHandleAction({ slug: "My Fresh Link" });
    expect(check).toEqual({ ok: true, data: { slug: "my-fresh-link", status: "available", message: "Available" } });
    const saved = await saveHandleAction({ slug: "My Fresh Link" });
    expect(saved).toEqual({ ok: true, data: { slug: "my-fresh-link", url: "http://localhost:3000/my-fresh-link", changed: true } });
    const again = await saveHandleAction({ slug: "app" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.fieldErrors?.slug).toEqual(["This URL is not available."]);
  });
});

describe("sessions (BR-10, AU-05)", () => {
  it("lists only the user's live sessions, the current one first", async () => {
    const user = await createUser(t.db);
    const other = await createUser(t.db);
    const older = await createSessionRecord(t.db, user.id, { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1", ip: "198.51.100.1" });
    const current = await createSessionRecord(t.db, user.id, { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36", ip: "198.51.100.2" });
    const revoked = await createSessionRecord(t.db, user.id, {});
    await t.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, revoked.session.id));
    await createSessionRecord(t.db, other.id, {});

    const list = await listUserSessions(t.db, user.id, current.session.id);
    expect(list.map((s) => s.id)).toEqual([current.session.id, older.session.id]);
    expect(list[0]).toMatchObject({ current: true, label: "Chrome on Windows", device: "desktop", ip: "198.51.100.2" });
    expect(list[1]).toMatchObject({ current: false, label: "Safari on iPhone", device: "mobile" });
  });

  it("revokes one of the user's own sessions but never another user's", async () => {
    const user = await createUser(t.db);
    const victim = await createUser(t.db);
    const actor = await actorOf(user);
    const mine = await createSessionRecord(t.db, user.id, {});
    const theirs = await createSessionRecord(t.db, victim.id, {});
    const current = await createSessionRecord(t.db, user.id, {});

    const foreign = await errorOf(revokeUserSession(t.db, actor, theirs.session.id, current.session.id));
    expect(foreign.code).toBe("not_found");
    expect(await lookupSession(t.db, theirs.token)).not.toBeNull();

    const self = await errorOf(revokeUserSession(t.db, actor, current.session.id, current.session.id));
    expect(self.code).toBe("validation");

    await revokeUserSession(t.db, actor, mine.session.id, current.session.id);
    expect(await lookupSession(t.db, mine.token)).toBeNull();
    expect(await lookupSession(t.db, current.token)).not.toBeNull();
    const again = await errorOf(revokeUserSession(t.db, actor, mine.session.id, current.session.id));
    expect(again.code).toBe("not_found");

    const audits = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "user.session_revoked"), eq(auditLog.targetId, mine.session.id)));
    expect(audits).toHaveLength(1);
  });

  it("logs out of all other sessions, keeping the current one and other users' sessions", async () => {
    const user = await createUser(t.db);
    const other = await createUser(t.db);
    const a = await createSessionRecord(t.db, user.id, {});
    const b = await createSessionRecord(t.db, user.id, {});
    const theirs = await createSessionRecord(t.db, other.id, {});
    const current = await createSessionRecord(t.db, user.id, {});
    expect(await revokeOtherUserSessions(t.db, await actorOf(user), current.session.id)).toBe(2);
    expect(await lookupSession(t.db, a.token)).toBeNull();
    expect(await lookupSession(t.db, b.token)).toBeNull();
    expect(await lookupSession(t.db, current.token)).not.toBeNull();
    expect(await lookupSession(t.db, theirs.token)).not.toBeNull();
  });

  it("works through the Server Actions for the signed-in user only", async () => {
    const user = await createUser(t.db);
    const victim = await createUser(t.db);
    const theirs = await createSessionRecord(t.db, victim.id, {});
    const mine = await createSessionRecord(t.db, user.id, {});
    const currentId = await signIn(user);

    const foreign = await revokeSessionAction({ sessionId: theirs.session.id });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe("not_found");
    expect(await lookupSession(t.db, theirs.token)).not.toBeNull();

    const current = await revokeSessionAction({ sessionId: currentId });
    expect(current.ok).toBe(false);

    expect(await revokeSessionAction({ sessionId: mine.session.id })).toEqual({ ok: true, data: { sessionId: mine.session.id } });
    await createSessionRecord(t.db, user.id, {});
    expect(await revokeOtherSessionsAction()).toEqual({ ok: true, data: { count: 1 } });
    const live = await t.db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
    expect(live.map((s) => s.id)).toEqual([currentId]);
  });
});

describe("password (AU-10)", () => {
  it("changes the password with the current one and logs out the other sessions", async () => {
    const user = await createUser(t.db, { passwordHash: await hashPassword("password123") });
    const other = await createSessionRecord(t.db, user.id, {});
    const currentId = await signIn(user);

    const missing = await changePasswordAction({ newPassword: "password456", confirmPassword: "password456" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.fieldErrors?.currentPassword).toEqual(["Enter your current password."]);

    const wrong = await changePasswordAction({ currentPassword: "nope12345", newPassword: "password456", confirmPassword: "password456" });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.fieldErrors?.currentPassword).toEqual(["Your current password is incorrect."]);

    const mismatch = await changePasswordAction({ currentPassword: "password123", newPassword: "password456", confirmPassword: "password789" });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error.fieldErrors?.confirmPassword).toEqual(["Passwords don't match."]);

    // The form posts FormData (passwords stay out of Server Action logs).
    const body = new FormData();
    body.set("currentPassword", "password123");
    body.set("newPassword", "password456");
    body.set("confirmPassword", "password456");
    const ok = await changePasswordAction(body);
    expect(ok).toEqual({ ok: true, data: { otherSessionsEnded: true } });
    expect(await verifyPassword("password456", (await freshUser(user)).passwordHash!)).toBe(true);
    expect(await lookupSession(t.db, other.token)).toBeNull();
    const [current] = await t.db.select().from(sessions).where(eq(sessions.id, currentId));
    expect(current?.revokedAt).toBeNull();
    const audits = await t.db.select().from(auditLog).where(and(eq(auditLog.action, "user.password_changed"), eq(auditLog.targetId, user.id)));
    expect(audits).toHaveLength(1);
  });

  it("lets an account created with Google set a first password without a current one", async () => {
    const user = await createUser(t.db, { passwordHash: null });
    await signIn(user);
    expect((await getLoginMethods(user.id)).hasPassword).toBe(false);
    const res = await changePasswordAction({ newPassword: "firstpass1", confirmPassword: "firstpass1" });
    expect(res.ok).toBe(true);
    expect((await getLoginMethods(user.id)).hasPassword).toBe(true);
  });
});
