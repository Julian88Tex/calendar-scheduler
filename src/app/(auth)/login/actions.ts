// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Email and password login (SPEC AU-04, AU-14). Foundation stub: a minimal working version so the app works end to end
// before foundation-auth builds the two-step page: credential check without account enumeration ("Incorrect email
// or password."), failed attempts limited per email (10 per 15 minutes) and per IP (50 per 15 minutes), 2FA users
// continue on /login/two-factor, `next` is honored for same-site relative paths only.
"use server";

import type { Route } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { INCORRECT_CREDENTIALS_MESSAGE, verifyLoginCredentials } from "@/lib/auth/login";
import { createSession } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { getClientIp } from "@/lib/http";
import { assertNotRateLimited, rateLimit, rateLimitKey, resetRateLimit } from "@/lib/rate-limit";
import { safeNextPath } from "@/lib/url";
import { normalizeEmail } from "@/lib/validation";

const LogInInput = z.object({
  email: z.string().trim().min(1, "Enter your email address").max(254, "Email address is too long"),
  password: z.string().min(1, "Enter your password").max(256, "Password is too long"),
  next: z.string().max(2048).optional(),
});

export type LogInState = ActionResult<null> | null;

const WINDOW_SECONDS = 15 * 60;

export async function logIn(_prev: LogInState, formData: FormData): Promise<LogInState> {
  return runAction(
    LogInInput,
    formData,
    async (input, { db }) => {
      const emailKey = rateLimitKey("login", "email", normalizeEmail(input.email));
      const ipKey = rateLimitKey("login", "ip", getClientIp(await headers()) ?? "unknown");
      // AU-14: the 11th failed attempt is rejected before the password is checked.
      await assertNotRateLimited(emailKey, 10, WINDOW_SECONDS, { db });
      await assertNotRateLimited(ipKey, 50, WINDOW_SECONDS, { db });
      const user = await verifyLoginCredentials(input.email, input.password, db);
      if (!user) {
        await rateLimit(emailKey, 10, WINDOW_SECONDS, { db });
        await rateLimit(ipKey, 50, WINDOW_SECONDS, { db });
        throw new AppError("unauthorized", INCORRECT_CREDENTIALS_MESSAGE);
      }
      await resetRateLimit(emailKey, { db });
      const next = safeNextPath(input.next);
      if (user.twoFactorEnabled) {
        await createSession(user.id, { twoFactorPending: true });
        redirect(`/login/two-factor?next=${encodeURIComponent(next)}` as Route);
      }
      await createSession(user.id);
      redirect(next as Route);
    },
    { auth: "none" },
  );
}
