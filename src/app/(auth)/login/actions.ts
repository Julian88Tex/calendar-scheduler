// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Email and password login (SPEC AU-04, AU-06, AU-09, AU-14, GEN-17): the password step of /login. Credentials are
// checked by authenticateWithPassword (no account enumeration, 10 failed attempts per email and 50 per IP per 15
// minutes, the 11th rejected before the password is checked). Any previous session of the browser is revoked, a new
// one created (two_factor_pending when 2FA is on, then /login/two-factor), user.login audited, and the visitor sent to
// the same-site `next` or /app/scheduling.
"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/lib/actions";
import { auditAuth } from "@/lib/auth/flows/audit";
import { currentRequestMeta } from "@/lib/auth/flows/request-context";
import { authenticateWithPassword } from "@/lib/auth/login";
import { LoginInput } from "@/lib/auth/schemas";
import { createSession, getSession, revokeSession } from "@/lib/auth/session";
import { safeNextPath } from "@/lib/url";

export type LogInState = ActionResult<null> | null;

export async function logIn(_prev: LogInState, formData: FormData): Promise<LogInState> {
  return runAction(
    LoginInput,
    formData,
    async (input, { db }) => {
      const meta = await currentRequestMeta();
      const { user, twoFactorRequired } = await authenticateWithPassword({ email: input.email, password: input.password, meta, db });
      const previous = await getSession();
      if (previous) await revokeSession(previous.session.id);
      const next = safeNextPath(input.next);
      if (twoFactorRequired) {
        await createSession(user.id, { twoFactorPending: true });
        redirect(`/login/two-factor?next=${encodeURIComponent(next)}` as Route);
      }
      await createSession(user.id);
      await auditAuth("user.login", { user, details: { method: "password" }, meta });
      redirect(next as Route);
    },
    { auth: "none" },
  );
}
