// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// "Forgot password?" (SPEC AU-07, AU-14): always answers "If an account exists for {email}, we sent a link to reset
// your password." (5 requests per address per hour); the email itself is sent after the response.
"use server";

import { runAction, type ActionResult } from "@/lib/actions";
import { currentRequestMeta } from "@/lib/auth/flows/request-context";
import { requestPasswordReset, resetLinkSentMessage } from "@/lib/auth/password-reset";
import { ForgotPasswordInput } from "@/lib/auth/schemas";

export type ForgotPasswordState = ActionResult<{ message: string }> | null;

export async function sendResetLink(_prev: ForgotPasswordState, formData: FormData): Promise<ForgotPasswordState> {
  return runAction(
    ForgotPasswordInput,
    formData,
    async (input, { db }) => {
      const meta = await currentRequestMeta();
      await requestPasswordReset(input.email, { ip: meta.ip, userAgent: meta.userAgent, db });
      return { message: resetLinkSentMessage(input.email) };
    },
    { auth: "none" },
  );
}
