"use server";

// Shared auth Server Actions (ARCHITECTURE section 26 rule 3):
// - resendVerificationEmail(): the VerifyEmailBanner "Resend email" action (AU-08), shape () => Promise<void> as the
//   banner expects; limits and failures are logged, never thrown at the banner.
// - resendVerificationEmailResult(): the same with an ActionResult (rate limit message) for richer UIs.
// - logOut(): revokes the session, audits user.logout and redirects to /login (AU-05) for forms that prefer an action
//   over POST /api/auth/logout.
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { log } from "@/lib/logger";
import { auditAuth } from "./flows/audit";
import { currentRequestMeta } from "./flows/request-context";
import { destroySession, getSession } from "./session";
import { sendVerificationEmail } from "./verify-email";

const NoInput = z.object({}).optional();

export async function resendVerificationEmailResult(): Promise<ActionResult<{ email: string }>> {
  return runAction(NoInput, {}, async (_input, { actor, db }) => {
    await sendVerificationEmail(actor.user.id, { db });
    return { email: actor.user.email };
  });
}

export async function resendVerificationEmail(): Promise<void> {
  const res = await resendVerificationEmailResult();
  if (!res.ok) log.warn("auth.resend_verification_failed", { code: res.error.code });
}

export async function logOut(): Promise<ActionResult<null>> {
  return runAction(
    NoInput,
    {},
    async () => {
      const current = await getSession().catch(() => null);
      await destroySession();
      if (current && !current.session.twoFactorPending) {
        await auditAuth("user.logout", { user: current.user, meta: await currentRequestMeta() }).catch(() => undefined);
      }
      redirect("/login");
    },
    { auth: "none" },
  );
}
