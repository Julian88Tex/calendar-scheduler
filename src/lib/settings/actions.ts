"use server";

// Account settings Server Actions (ARCHITECTURE section 26 rule 3; SPEC BR-01 to BR-06, BR-08, BR-10, AU-05, AU-10):
// thin wrappers that validate, authorize through runAction (the signed-in user only ever edits their own account),
// rate limit the guessable or chatty ones, call the services in ./index.ts and revalidate the dashboard. Image uploads
// go through route handlers instead (see ./uploads.ts: request bodies above 1 MB).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { changePassword } from "@/lib/auth/flows/password";
import { currentRequestMeta } from "@/lib/auth/flows/request-context";
import { getSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { absoluteUrl } from "@/lib/url";
import {
  changeHandle,
  checkHandle,
  getLoginMethods,
  removeUserImage,
  revokeOtherUserSessions,
  revokeUserSession,
  setShowBranding,
  updateProfile,
} from "./index";
import {
  BrandingInput,
  CURRENT_PASSWORD_REQUIRED_MESSAGE,
  HandleInput,
  PasswordChangeInput,
  ProfileInput,
  SessionInput,
  type HandleCheck,
  type ProfileFormValues,
} from "./schemas";

const ImageKindInput = z.object({ kind: z.enum(["avatar", "logo"]) });
const NoInput = z.object({}).optional();

async function currentSessionId(): Promise<string | null> {
  const data = await getSession();
  return data && !data.session.twoFactorPending ? data.session.id : null;
}

/** Profile: name, welcome message, time zone, time and date formats (BR-01, BR-03, BR-04). */
export async function saveProfileAction(raw: unknown): Promise<ActionResult<ProfileFormValues>> {
  return runAction(ProfileInput, raw, async (input, { actor, db }) => {
    const saved = await updateProfile(db, actor.user.id, input);
    revalidatePath("/app", "layout");
    return saved;
  });
}

/** "Remove" for the profile picture or the logo (BR-02, BR-05). */
export async function removeImageAction(raw: unknown): Promise<ActionResult<{ kind: "avatar" | "logo" }>> {
  return runAction(ImageKindInput, raw, async ({ kind }, { actor, db }) => {
    await removeUserImage(db, actor.user.id, kind);
    revalidatePath("/app", "layout");
    return { kind };
  });
}

/** "Use {AppName} branding" (BR-06). */
export async function setShowBrandingAction(raw: unknown): Promise<ActionResult<{ showBranding: boolean }>> {
  return runAction(BrandingInput, raw, async ({ showBranding }, { actor, db }) => {
    const saved = await setShowBranding(db, actor.user.id, showBranding);
    revalidatePath("/app/settings/branding");
    return { showBranding: saved };
  });
}

/** Live "Available" / "This URL is taken" check for My Link (BR-08). */
export async function checkHandleAction(raw: unknown): Promise<ActionResult<HandleCheck>> {
  return runAction(HandleInput, raw, async ({ slug }, { actor, db }) => {
    await assertRateLimit(rateLimitKey("settings-handle-check", actor.user.id), 300, 15 * 60, {
      message: "Too many checks. Wait a moment and try again.",
    });
    return checkHandle(db, actor.user.id, slug);
  });
}

/** Saves a new URL (BR-08): the old one stops working at once. */
export async function saveHandleAction(raw: unknown): Promise<ActionResult<{ slug: string; url: string; changed: boolean }>> {
  return runAction(HandleInput, raw, async ({ slug }, { actor, db }) => {
    await assertRateLimit(rateLimitKey("settings-handle-save", actor.user.id), 20, 60 * 60, {
      message: "You changed your URL too many times. Try again in an hour.",
    });
    const result = await changeHandle(db, actor, slug);
    revalidatePath("/app", "layout");
    return { slug: result.slug, url: absoluteUrl(`/${result.slug}`), changed: result.changed };
  });
}

/**
 * "Change password" (current and new) or "Set password" for accounts created with Google (AU-10). Every other session
 * is logged out; the current one stays. Attempts are limited per account (current password guessing).
 */
export async function changePasswordAction(raw: unknown): Promise<ActionResult<{ otherSessionsEnded: true }>> {
  return runAction(PasswordChangeInput, raw, async (input, { actor, db }) => {
    await assertRateLimit(rateLimitKey("settings-password", actor.user.id), 10, 15 * 60, {
      message: "Too many attempts. Try again in 15 minutes.",
    });
    const methods = await getLoginMethods(actor.user.id, db);
    if (methods.hasPassword && !input.currentPassword) {
      throw new AppError("validation", CURRENT_PASSWORD_REQUIRED_MESSAGE, {
        fieldErrors: { currentPassword: [CURRENT_PASSWORD_REQUIRED_MESSAGE] },
      });
    }
    await changePassword({
      userId: actor.user.id,
      currentPassword: methods.hasPassword ? input.currentPassword : null,
      newPassword: input.newPassword,
      keepSessionId: await currentSessionId(),
      meta: await currentRequestMeta(),
      db,
    });
    revalidatePath("/app/settings/login");
    return { otherSessionsEnded: true as const };
  });
}

/** "Log out" of one other session (BR-10): only the user's own sessions. */
export async function revokeSessionAction(raw: unknown): Promise<ActionResult<{ sessionId: string }>> {
  return runAction(SessionInput, raw, async ({ sessionId }, { actor, db }) => {
    await revokeUserSession(db, actor, sessionId, await currentSessionId());
    revalidatePath("/app/settings/login");
    return { sessionId };
  });
}

/** "Log out of all other sessions" (AU-05). */
export async function revokeOtherSessionsAction(): Promise<ActionResult<{ count: number }>> {
  return runAction(NoInput, {}, async (_input, { actor, db }) => {
    const current = await currentSessionId();
    if (!current) throw new AppError("unauthorized");
    const count = await revokeOtherUserSessions(db, actor, current);
    revalidatePath("/app/settings/login");
    return { count };
  });
}
