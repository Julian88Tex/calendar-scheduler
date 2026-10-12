// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Second factor form (SPEC AU-09): "Authentication code" (6 digits, one-time-code autofill) and "Verify", with "Use a
// recovery code instead" switching to the recovery code field (and back). Errors are announced; the field keeps focus.
"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { verifyTwoFactor, type TwoFactorState } from "./actions";

export type TwoFactorFormProps = { next: string; loginMethod?: "password" | "google" | "microsoft" | null };

export function TwoFactorForm({ next, loginMethod }: TwoFactorFormProps) {
  const [state, action, pending] = useActionState<TwoFactorState, FormData>(verifyTwoFactor, null);
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [seen, setSeen] = useState<TwoFactorState>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (state !== seen) {
    setSeen(state);
    if (state && !state.ok) setCode("");
  }

  useEffect(() => {
    inputRef.current?.focus();
  }, [method, seen]);

  const fieldError = state && !state.ok ? (state.error.fieldErrors?.code?.[0] ?? null) : null;
  const formError = state && !state.ok && !fieldError ? state.error.message : null;

  return (
    <form action={action} className="flex flex-col gap-5" noValidate>
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="next" value={next} />
      {loginMethod ? <input type="hidden" name="loginMethod" value={loginMethod} /> : null}
      <div aria-live="polite">{formError ? <Banner variant="error">{formError}</Banner> : null}</div>
      {method === "totp" ? (
        <FormField label="Authentication code" hint="Open your authenticator app and enter the 6-digit code." error={fieldError}>
          {(control) => (
            <Input
              {...control}
              ref={inputRef}
              name="code"
              size="lg"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={7}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ""))}
              className="text-center text-title-md tracking-[0.4em]"
            />
          )}
        </FormField>
      ) : (
        <FormField label="Recovery code" hint="Enter one of the recovery codes you saved when you turned on two-factor authentication. Each code works once." error={fieldError}>
          {(control) => (
            <Input
              {...control}
              ref={inputRef}
              name="code"
              size="lg"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="xxxxx-xxxxx"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="text-center font-mono tracking-wider"
            />
          )}
        </FormField>
      )}
      <Button type="submit" size="lg" fullWidth loading={pending}>
        Verify
      </Button>
      <button
        type="button"
        onClick={() => {
          setMethod((m) => (m === "totp" ? "recovery" : "totp"));
          setCode("");
        }}
        className="self-center rounded-full px-3 py-1.5 text-body-md font-semibold text-primary-text hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      >
        {method === "totp" ? "Use a recovery code instead" : "Use your authenticator app instead"}
      </button>
    </form>
  );
}
