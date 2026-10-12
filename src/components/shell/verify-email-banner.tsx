// OWNER: foundation-ui.
//
// VerifyEmailBanner (SPEC AU-08): "Please verify your email address. Resend email" for unverified accounts; the
// resend action is rate limited server side. Dismissible for the session.
"use client";

import { useState, useTransition } from "react";
import { Banner } from "../ui/banner";
import { Spinner } from "../ui/spinner";
import { toast } from "../ui/toast";
import { useSessionDismissal } from "./dismissal";

export type VerifyEmailBannerProps = {
  email: string;
  /** Server action that re-sends the verification email (foundation-auth). Returning { ok: false, error } shows it. */
  resendAction?: () => Promise<unknown>;
};

export function VerifyEmailBanner({ email, resendAction }: VerifyEmailBannerProps) {
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();
  const [dismissed, dismiss] = useSessionDismissal("verify-email");
  if (dismissed) return null;
  return (
    <Banner
      variant="info"
      role="status"
      dismissible
      onDismiss={dismiss}
      action={
        resendAction && !sent ? (
          <button
            type="button"
            disabled={pending}
            aria-busy={pending || undefined}
            className="inline-flex items-center gap-2 text-[14px] font-bold text-primary-text underline underline-offset-2 disabled:opacity-60"
            onClick={() =>
              startTransition(async () => {
                try {
                  const result = (await resendAction()) as { ok?: boolean; error?: { message?: string } } | undefined;
                  if (result && result.ok === false) {
                    toast.error(result.error?.message ?? "Couldn't send the email. Try again.");
                    return;
                  }
                  setSent(true);
                  toast.success("Verification email sent");
                } catch {
                  toast.error("Couldn't send the email. Try again.");
                }
              })
            }
          >
            {pending && <Spinner size="sm" decorative inheritColor />}
            Resend email
          </button>
        ) : undefined
      }
    >
      {sent ? `We sent a new link to ${email}.` : "Please verify your email address."}
    </Banner>
  );
}
