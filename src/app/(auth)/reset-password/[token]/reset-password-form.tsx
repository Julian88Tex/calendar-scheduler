// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// New password form (SPEC AU-07): "New password" (with the AU-01 rule hint) and "Confirm new password", then "Reset
// password". A used or expired token answers "This link has expired. Request a new one." with a link to request one.
"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { passwordChecks } from "@/lib/auth/schemas";
import { cn } from "@/lib/cn";
import { PasswordInput } from "../../_components/password-input";
import { submitNewPassword, type ResetPasswordState } from "./actions";

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<ResetPasswordState, FormData>(submitNewPassword, null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const fieldErrors = state && !state.ok ? state.error.fieldErrors : undefined;
  const expired = state && !state.ok && state.error.code === "not_found";
  const formError = state && !state.ok && !fieldErrors && !expired ? state.error.message : null;
  const checks = passwordChecks(password);

  if (expired) {
    return (
      <div className="flex flex-col gap-5">
        <Banner variant="error">{state.error.message}</Banner>
        <Link href="/forgot-password" className="text-center font-semibold text-primary-text hover:underline">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers save the new password for the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div aria-live="polite">{formError ? <Banner variant="error">{formError}</Banner> : null}</div>
      <div className="flex flex-col gap-1">
        <label htmlFor="reset-password" className="text-label text-ink">
          New password
        </label>
        <PasswordInput
          id="reset-password"
          name="password"
          size="lg"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={cn("reset-password-hint", fieldErrors?.password && "reset-password-error")}
          aria-invalid={fieldErrors?.password ? true : undefined}
        />
        <p id="reset-password-hint" className={cn("text-body-sm text-ink-2", checks.length && checks.letterAndNumber && "text-success-text")}>
          At least 8 characters, with at least one letter and one number.
        </p>
        {fieldErrors?.password ? (
          <p id="reset-password-error" role="alert" className="text-body-sm text-danger-text">
            {fieldErrors.password[0]}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="reset-password-confirm" className="text-label text-ink">
          Confirm new password
        </label>
        <PasswordInput
          id="reset-password-confirm"
          name="confirmPassword"
          size="lg"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-describedby={fieldErrors?.confirmPassword ? "reset-confirm-error" : undefined}
          aria-invalid={fieldErrors?.confirmPassword ? true : undefined}
        />
        {fieldErrors?.confirmPassword ? (
          <p id="reset-confirm-error" role="alert" className="text-body-sm text-danger-text">
            {fieldErrors.confirmPassword[0]}
          </p>
        ) : null}
      </div>
      <Button type="submit" size="lg" fullWidth loading={pending}>
        Reset password
      </Button>
    </form>
  );
}
