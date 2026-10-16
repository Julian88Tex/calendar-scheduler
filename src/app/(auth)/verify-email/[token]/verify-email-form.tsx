// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// "Verify email" button (SPEC AU-08): a POST form; success replaces it with the confirmation and a link onward.
"use client";

import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button, buttonClassName } from "@/components/ui/button";
import { confirmEmail, type VerifyEmailState } from "./actions";

export function VerifyEmailForm({ token, signedIn }: { token: string; signedIn: boolean }) {
  const [state, action, pending] = useActionState<VerifyEmailState, FormData>(confirmEmail, null);
  if (state?.ok) {
    return (
      <div className="flex flex-col items-center gap-5 text-center" role="status">
        <span aria-hidden="true" className="inline-flex size-14 items-center justify-center rounded-full bg-success-soft text-success-text">
          <CheckCircle2 className="size-7" />
        </span>
        <p className="text-body text-ink">Your email address is verified. Thanks!</p>
        <Link href={signedIn ? "/app/scheduling" : "/login"} className={buttonClassName({ size: "lg", fullWidth: true })}>
          {signedIn ? "Go to Scheduling" : "Log In"}
        </Link>
      </div>
    );
  }
  const error = state && !state.ok ? state.error : null;
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />
      <div aria-live="polite" className="empty:absolute">
        {error ? (
          <Banner variant="error">
            {error.message}{" "}
            {error.code === "not_found" && signedIn ? (
              <Link href="/app/settings/profile" className="font-semibold underline">
                Go to your account
              </Link>
            ) : null}
          </Banner>
        ) : null}
      </div>
      <Button type="submit" size="lg" fullWidth loading={pending}>
        Verify email
      </Button>
    </form>
  );
}
