// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Signup form (SPEC AU-01). Foundation stub: one step (email, full name, password) with the final copy; foundation-auth
// adds the animated two-step flow and the Google and Microsoft buttons.
"use client";

import Link from "next/link";
import { useActionState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { signUp, type SignUpState } from "./actions";

const noop = () => () => {};
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
const serverZone = () => "";

export function SignupForm() {
  const [state, action, pending] = useActionState<SignUpState, FormData>(signUp, null);
  const zone = useSyncExternalStore(noop, browserZone, serverZone);
  const fieldErrors = state && !state.ok ? state.error.fieldErrors : undefined;
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="timezone" value={zone} />
      <FormField label="Enter your email" required error={fieldErrors?.email?.[0]}>
        {(control) => <Input {...control} name="email" type="email" autoComplete="email" />}
      </FormField>
      <FormField label="Enter your full name" required error={fieldErrors?.name?.[0]}>
        {(control) => <Input {...control} name="name" autoComplete="name" />}
      </FormField>
      <FormField
        label="Choose a password"
        required
        hint="At least 8 characters, with at least one letter and one number."
        error={fieldErrors?.password?.[0]}
      >
        {(control) => <Input {...control} name="password" type="password" autoComplete="new-password" />}
      </FormField>
      <p className="text-body-sm text-ink-2">
        By creating an account, you agree to the{" "}
        <Link href="/terms" className="text-primary-text underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" className="text-primary-text underline">
          Privacy Policy
        </Link>
      </p>
      <div aria-live="polite" className="min-h-5 text-body-sm text-danger-text">
        {state && !state.ok && !fieldErrors ? <p role="alert">{state.error.message}</p> : null}
      </div>
      <Button type="submit" loading={pending} className="w-full">
        Sign up
      </Button>
      <p className="text-body-md">
        Already have an account?{" "}
        <Link href="/login" className="text-primary-text underline">
          Log In
        </Link>
      </p>
    </form>
  );
}
