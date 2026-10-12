// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// New password form (SPEC AU-07): "New password" (with the AU-01 rule hint) and "Confirm new password", then "Reset
// password". A used or expired token answers "This link has expired. Request a new one." with a link to request one.
"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/form-field";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import { PasswordInput } from "../../_components/password-input";
import { PasswordRules } from "../../_components/password-rules";
import { submitNewPassword, type ResetPasswordState } from "./actions";

export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<ResetPasswordState, FormData>(submitNewPassword, null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const fieldErrors = state && !state.ok ? state.error.fieldErrors : undefined;
  const expired = state && !state.ok && state.error.code === "not_found";
  const formError = state && !state.ok && !fieldErrors && !expired ? state.error.message : null;

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
      <div aria-live="polite" className="empty:absolute">{formError ? <Banner variant="error">{formError}</Banner> : null}</div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-password">New password</Label>
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
        <PasswordRules id="reset-password-hint" password={password} />
        <FieldError id="reset-password-error" error={fieldErrors?.password} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reset-password-confirm">Confirm new password</Label>
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
        <FieldError id="reset-confirm-error" error={fieldErrors?.confirmPassword} />
      </div>
      <Button type="submit" size="lg" fullWidth loading={pending}>
        Reset password
      </Button>
    </form>
  );
}
