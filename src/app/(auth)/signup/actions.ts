// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Email signup (SPEC AU-01, AU-08, AU-11, AU-13, AU-14, GEN-17):
// - checkSignupEmail: step 1 "Continue with email" ("An account with this email already exists. Log in instead.",
//   "Sign ups are closed. Ask an admin for an invitation.");
// - signUp: step 2 "Sign up": 20 signups per IP per hour, the signup policy evaluated inside the account transaction
//   under the signup advisory lock (the first account becomes instance admin and org owner), createUserAccount with
//   every AU-13 default, the welcome and verification emails, a session, then Scheduling (POST_SIGNUP_PATH; the
//   onboarding wizard is outside the reduced scope, docs/SCOPE.md).
"use server";

import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/lib/actions";
import { currentRequestMeta } from "@/lib/auth/flows/request-context";
import { POST_SIGNUP_PATH, checkSignupEmail as checkSignupEmailService, signUpWithPassword } from "@/lib/auth/flows/signup-flow";
import { SignupEmailInput, SignupInput } from "@/lib/auth/schemas";
import { createSession, getSession, revokeSession } from "@/lib/auth/session";

export type SignUpState = ActionResult<null> | null;
export type CheckEmailResult = ActionResult<{ email: string }>;

export async function checkSignupEmail(raw: { email: string }): Promise<CheckEmailResult> {
  return runAction(
    SignupEmailInput,
    raw,
    async (input, { db }) => {
      await checkSignupEmailService({ email: input.email, meta: await currentRequestMeta(), db });
      return { email: input.email };
    },
    { auth: "none" },
  );
}

export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  return runAction(
    SignupInput,
    formData,
    async (input, { db }) => {
      const { user } = await signUpWithPassword({
        email: input.email,
        name: input.name,
        password: input.password,
        timezone: input.timezone,
        meta: await currentRequestMeta(),
        db,
      });
      const previous = await getSession();
      if (previous) await revokeSession(previous.session.id);
      await createSession(user.id);
      redirect(POST_SIGNUP_PATH);
    },
    { auth: "none" },
  );
}
