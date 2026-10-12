// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Email signup (SPEC AU-01, AU-11, AU-13, AU-14). Foundation stub: a minimal working version so the app works end to
// end before foundation-auth builds the two-step page: signup policy (the first account of an instance is always
// allowed and becomes instance admin), 20 signups per IP per hour, createUserAccount (every AU-13 default), a session,
// then /onboarding. The welcome and verification emails (AU-08) come with foundation-auth.
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionResult } from "@/lib/actions";
import { signupPolicyAllows } from "@/lib/auth/policy";
import { createSession } from "@/lib/auth/session";
import { createUserAccount } from "@/lib/auth/signup";
import { hashPassword } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { getClientIp } from "@/lib/http";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { isValidTimeZone } from "@/lib/time/zones";
import { zEmail, zPassword } from "@/lib/validation";

const SignUpInput = z.object({
  email: zEmail,
  name: z.string().trim().min(1, "Enter your full name").max(100, "Name is too long"),
  password: zPassword,
  timezone: z.string().max(64).optional(),
});

export type SignUpState = ActionResult<null> | null;

export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  return runAction(
    SignUpInput,
    formData,
    async (input, { db }) => {
      await assertRateLimit(rateLimitKey("signup", "ip", getClientIp(await headers()) ?? "unknown"), 20, 3600, { db });
      const decision = await signupPolicyAllows(input.email, { db });
      if (!decision.allowed) throw new AppError("forbidden", decision.message);
      const passwordHash = await hashPassword(input.password);
      const user = await db.transaction((tx) =>
        createUserAccount(tx, {
          email: input.email,
          name: input.name,
          passwordHash,
          timezone: input.timezone && isValidTimeZone(input.timezone) ? input.timezone : null,
          isInstanceAdmin: decision.firstUser,
          organizationId: decision.joinOrganizationId,
          role: decision.joinOrganizationId ? "user" : undefined,
        }),
      );
      await createSession(user.id);
      redirect("/onboarding");
    },
    { auth: "none" },
  );
}
