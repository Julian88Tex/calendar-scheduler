// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// /login/two-factor (SPEC AU-09, AU-14): verifies the 6-digit authenticator code or a one-time recovery code for the
// current two_factor_pending session (5 attempts per session per 5 minutes), then replaces the pending session with a
// fresh fully authenticated one (a new token on privilege change) and continues to the same-site `next`.
"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/lib/actions";
import { currentRequestMeta } from "@/lib/auth/flows/request-context";
import { completeTwoFactorChallenge } from "@/lib/auth/flows/two-factor";
import { TwoFactorInput } from "@/lib/auth/schemas";
import { createSession, getSession, revokeSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { safeNextPath } from "@/lib/url";

export type TwoFactorState = ActionResult<null> | null;

export async function verifyTwoFactor(_prev: TwoFactorState, formData: FormData): Promise<TwoFactorState> {
  return runAction(
    TwoFactorInput,
    formData,
    async (input, { db }) => {
      const data = await getSession();
      if (!data || !data.session.twoFactorPending) {
        if (data) redirect(safeNextPath(input.next) as Route);
        throw new AppError("unauthorized", "Your sign in expired. Log in again.");
      }
      await completeTwoFactorChallenge({
        sessionId: data.session.id,
        user: data.user,
        method: input.method,
        code: input.code,
        meta: await currentRequestMeta(),
        loginMethod: input.loginMethod,
        db,
      });
      await revokeSession(data.session.id);
      await createSession(data.user.id);
      redirect(safeNextPath(input.next) as Route);
    },
    { auth: "none" },
  );
}
