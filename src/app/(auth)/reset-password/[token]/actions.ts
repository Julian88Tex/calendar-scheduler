// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Reset password submit (SPEC AU-07, AU-06, GEN-08): the only place a reset token is consumed. Sets the new password,
// logs the user in (two_factor_pending when 2FA is on), revokes every other session of the user, then Scheduling.
"use server";

import { eq } from "drizzle-orm";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { users } from "@/db/schema";
import { runAction, type ActionResult } from "@/lib/actions";
import { auditAuth } from "@/lib/auth/flows/audit";
import { currentRequestMeta } from "@/lib/auth/flows/request-context";
import { resetPassword } from "@/lib/auth/password-reset";
import { ResetPasswordInput } from "@/lib/auth/schemas";
import { createSession, getSession, revokeOtherSessions, revokeSession } from "@/lib/auth/session";

export type ResetPasswordState = ActionResult<null> | null;

export async function submitNewPassword(_prev: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  return runAction(
    ResetPasswordInput,
    formData,
    async (input, { db }) => {
      const meta = await currentRequestMeta();
      const { userId } = await resetPassword(input.token, input.password, { db, meta });
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      const previous = await getSession();
      if (previous) await revokeSession(previous.session.id);
      const twoFactorPending = Boolean(user?.twoFactorEnabled);
      const { sessionId } = await createSession(userId, { twoFactorPending });
      await revokeOtherSessions(userId, sessionId);
      if (twoFactorPending) redirect("/login/two-factor?next=%2Fapp%2Fscheduling" as Route);
      if (user) await auditAuth("user.login", { user, details: { method: "password_reset" }, meta });
      redirect("/app/scheduling");
    },
    { auth: "none" },
  );
}
