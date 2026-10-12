// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// VerifyEmailBanner (SPEC AU-08): "Please verify your email address. Resend email".
"use client";

import { useState } from "react";
import { Banner } from "../ui/banner";

export type VerifyEmailBannerProps = {
  email: string;
  /** Server action that re-sends the verification email (foundation-auth). */
  resendAction?: () => Promise<void>;
};

export function VerifyEmailBanner({ email, resendAction }: VerifyEmailBannerProps) {
  const [sent, setSent] = useState(false);
  return (
    <Banner
      variant="info"
      dismissible
      action={
        resendAction && !sent ? (
          <button
            type="button"
            className="font-semibold underline"
            onClick={async () => {
              await resendAction();
              setSent(true);
            }}
          >
            Resend email
          </button>
        ) : undefined
      }
    >
      {sent ? `We sent a new link to ${email}.` : "Please verify your email address."}
    </Banner>
  );
}
