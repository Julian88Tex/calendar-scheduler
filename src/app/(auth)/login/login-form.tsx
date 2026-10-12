// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Login form (SPEC AU-04, walkthrough 3.2): "Continue with Google" and "Continue with Microsoft" (configured providers
// only), divider "or", then the email step ("Email address" and "Continue") and the password step (the email stays
// visible with "Change", "Password" with a show toggle, "Forgot password?" and "Log In"). The email step never asks
// the server (no account enumeration); wrong credentials answer "Incorrect email or password.".
"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FieldError, FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { LoginEmailInput } from "@/lib/auth/schemas";
import { OAuthButtons } from "../_components/oauth-buttons";
import { PasswordInput } from "../_components/password-input";
import { logIn, type LogInState } from "./actions";

export type LoginFormProps = {
  next?: string | null;
  showSignupLink?: boolean;
  providers?: { google: boolean; microsoft: boolean };
  /** Message from the OAuth callback (?error=...). */
  initialError?: string | null;
};

export function LoginForm({ next, providers = { google: false, microsoft: false }, initialError }: LoginFormProps) {
  const [state, action, pending] = useActionState<LogInState, FormData>(logIn, null);
  const [step, setStep] = useState<"email" | "password">("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [seen, setSeen] = useState<LogInState>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const hasOAuth = providers.google || providers.microsoft;

  // A new server answer: clear the password; an email field error sends the visitor back to the email step.
  if (state !== seen) {
    setSeen(state);
    if (state && !state.ok) {
      setPassword("");
      if (state.error.fieldErrors?.email) {
        setStep("email");
        setEmailError(state.error.fieldErrors.email[0] ?? null);
      }
    }
  }

  useEffect(() => {
    if (step === "password") passwordRef.current?.focus();
  }, [step, seen]);

  const fieldErrors = state && !state.ok ? state.error.fieldErrors : undefined;
  const formError = state && !state.ok && !fieldErrors ? state.error.message : null;

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (step === "password") return;
    e.preventDefault();
    const parsed = LoginEmailInput.safeParse({ email });
    if (!parsed.success) {
      setEmailError(parsed.error.issues[0]?.message ?? "Enter a valid email address");
      emailRef.current?.focus();
      return;
    }
    setEmail(parsed.data.email);
    setEmailError(null);
    setStep("password");
  }

  function changeEmail() {
    setStep("email");
    setPassword("");
    requestAnimationFrame(() => emailRef.current?.focus());
  }

  return (
    <div className="flex flex-col gap-6">
      {initialError && !state ? <Banner variant="error">{initialError}</Banner> : null}
      {hasOAuth ? (
        <>
          <OAuthButtons providers={providers} intent="login" next={next} />
          <Separator label="or" />
        </>
      ) : null}
      <form action={action} onSubmit={onSubmit} className="flex flex-col gap-5" noValidate aria-label="Log in with email">
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <div aria-live="polite" className="empty:absolute">{formError ? <Banner variant="error">{formError}</Banner> : null}</div>
        <FormField label="Email address" error={step === "email" ? emailError : fieldErrors?.email?.[0]}>
          {(control) => (
            <div className="relative">
              <Input
                {...control}
                ref={emailRef}
                name="email"
                type="email"
                size="lg"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@example.com"
                value={email}
                readOnly={step === "password"}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                className={step === "password" ? "bg-pebble pr-24 text-ink-2" : undefined}
              />
              {step === "password" ? (
                <button
                  type="button"
                  onClick={changeEmail}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full px-3 py-1.5 text-body-md font-semibold text-primary-text hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
                >
                  Change
                </button>
              ) : null}
            </div>
          )}
        </FormField>

        {step === "password" ? (
          <div className="flex flex-col gap-5 animate-fade-in motion-reduce:animate-none">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="login-password">Password</Label>
                <Link href="/forgot-password" className="text-body-md font-semibold text-primary-text hover:underline">
                  Forgot password?
                </Link>
              </div>
              <PasswordInput
                ref={passwordRef}
                id="login-password"
                name="password"
                size="lg"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={fieldErrors?.password ? true : undefined}
                aria-describedby={fieldErrors?.password ? "login-password-error" : undefined}
              />
              <FieldError id="login-password-error" error={fieldErrors?.password} />
            </div>
            <Button type="submit" size="lg" fullWidth loading={pending}>
              Log In
            </Button>
          </div>
        ) : (
          <Button type="submit" size="lg" fullWidth>
            Continue
          </Button>
        )}
      </form>
    </div>
  );
}
