// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Forgot password form (SPEC AU-07): "Email address" and "Send reset link"; afterwards the same confirmation for every
// address, with "Back to log in" and a way to try another address.
"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button, buttonClassName } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { sendResetLink, type ForgotPasswordState } from "./actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<ForgotPasswordState, FormData>(sendResetLink, null);
  const [email, setEmail] = useState("");
  const [again, setAgain] = useState(false);
  const [seen, setSeen] = useState<ForgotPasswordState>(null);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) setAgain(false);
  }

  if (state?.ok && !again) {
    return (
      <div className="flex flex-col items-center gap-5 text-center" role="status">
        <span aria-hidden="true" className="inline-flex size-14 items-center justify-center rounded-full bg-success-soft text-success-text">
          <MailCheck className="size-7" />
        </span>
        <p className="text-body text-ink">{state.data.message}</p>
        <p className="text-body-md text-ink-2">The link expires in 60 minutes. Check your spam folder if you don&apos;t see it.</p>
        <Link href="/login" className={buttonClassName({ variant: "primary", size: "lg", fullWidth: true })}>
          Back to log in
        </Link>
        <button
          type="button"
          onClick={() => setAgain(true)}
          className="rounded-full px-3 py-1.5 text-body-md font-semibold text-primary-text hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        >
          Use a different email
        </button>
      </div>
    );
  }

  const fieldErrors = state && !state.ok ? state.error.fieldErrors : undefined;
  const formError = state && !state.ok && !fieldErrors ? state.error.message : null;
  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <div aria-live="polite" className="empty:absolute">{formError ? <Banner variant="error">{formError}</Banner> : null}</div>
      <FormField label="Email address" error={fieldErrors?.email?.[0]}>
        {(control) => (
          <Input
            {...control}
            name="email"
            type="email"
            size="lg"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
      </FormField>
      <Button type="submit" size="lg" fullWidth loading={pending}>
        Send reset link
      </Button>
    </form>
  );
}
