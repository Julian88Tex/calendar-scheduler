// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Login form (SPEC AU-04). Foundation stub: one step (email and password) with the final copy; foundation-auth adds
// the two-step flow and the Google and Microsoft buttons.
"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { logIn, type LogInState } from "./actions";

export type LoginFormProps = { next?: string | null; showSignupLink?: boolean };

export function LoginForm({ next, showSignupLink = true }: LoginFormProps) {
  const [state, action, pending] = useActionState<LogInState, FormData>(logIn, null);
  const fieldErrors = state && !state.ok ? state.error.fieldErrors : undefined;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <FormField label="Email address" required error={fieldErrors?.email?.[0]}>
        {(control) => <Input {...control} name="email" type="email" autoComplete="email" />}
      </FormField>
      <FormField label="Password" required error={fieldErrors?.password?.[0]}>
        {(control) => <Input {...control} name="password" type="password" autoComplete="current-password" />}
      </FormField>
      <div aria-live="polite" className="min-h-5 text-body-sm text-danger-text">
        {state && !state.ok && !fieldErrors ? <p role="alert">{state.error.message}</p> : null}
      </div>
      <Button type="submit" loading={pending} className="w-full">
        Log In
      </Button>
      <p className="text-body-md">
        <Link href="/forgot-password" className="text-primary-text underline">
          Forgot password?
        </Link>
      </p>
      {showSignupLink ? (
        <p className="text-body-md">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-primary-text underline">
            Sign up for free
          </Link>
        </p>
      ) : null}
    </form>
  );
}
