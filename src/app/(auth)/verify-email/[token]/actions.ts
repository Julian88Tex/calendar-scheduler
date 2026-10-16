// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// "Verify email" button (SPEC AU-08, GEN-08): the POST that consumes the verification token and sets
// users.email_verified_at; the dashboard banner disappears on the next page load (dashboard pages render per request,
// so no revalidation is needed, and the form keeps its success state).
"use server";

import { runAction, type ActionResult } from "@/lib/actions";
import { currentRequestMeta } from "@/lib/auth/flows/request-context";
import { VerifyEmailInput } from "@/lib/auth/schemas";
import { verifyEmailToken } from "@/lib/auth/verify-email";

export type VerifyEmailState = ActionResult<{ verified: true }> | null;

export async function confirmEmail(_prev: VerifyEmailState, formData: FormData): Promise<VerifyEmailState> {
  return runAction(
    VerifyEmailInput,
    formData,
    async (input, { db }) => {
      await verifyEmailToken(input.token, { db, meta: await currentRequestMeta() });
      return { verified: true as const };
    },
    { auth: "none" },
  );
}
