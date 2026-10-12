// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// "Resend email" on an expired verification link (SPEC AU-08, AU-14: 5 emails per address per hour).
"use client";

import { useState, useTransition } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { resendVerificationEmailResult } from "@/lib/auth/actions";

export function ResendVerificationButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite" className="empty:absolute">
        {result ? <Banner variant={result.ok ? "success" : "error"}>{result.message}</Banner> : null}
      </div>
      <Button
        size="lg"
        fullWidth
        loading={pending}
        disabled={result?.ok}
        onClick={() =>
          start(async () => {
            const res = await resendVerificationEmailResult();
            setResult(res.ok ? { ok: true, message: `We sent a new link to ${res.data.email}.` } : { ok: false, message: res.error.message });
          })
        }
      >
        Resend email
      </Button>
    </div>
  );
}
