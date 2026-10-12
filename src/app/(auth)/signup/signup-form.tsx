// OWNER: foundation-auth. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Signup form (SPEC AU-01, walkthrough 3.1). Step 1: "Enter your email" and "Continue with email" (checked on the
// server: taken email offers "Log in instead.", closed signups show the policy message), divider "or", "Continue with
// Google" and "Continue with Microsoft" (configured providers only) and the helper "Continue with Google to connect
// your calendar." (only Google calendars are in scope, docs/SCOPE.md). Step 2 slides in on the same page: "Enter your
// full name", "Choose a password" with the live rule hint and "Sign up" (no terms microcopy: the marketing pages with
// the Terms and Privacy Policy are outside the reduced scope). The browser time zone goes along for the default
// schedule.
"use client";

import { ArrowLeft, Check, Circle } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useSyncExternalStore, useTransition, type FormEvent, type ReactNode } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/cn";
import { passwordChecks, SignupEmailInput } from "@/lib/auth/schemas";
import { OAuthButtons } from "../_components/oauth-buttons";
import { PasswordInput } from "../_components/password-input";
import { checkSignupEmail, signUp, type SignUpState } from "./actions";

const noop = () => () => {};
const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
};
const serverZone = () => "";

type EmailIssue = { kind: "taken" | "closed" | "other"; message: string } | null;

export type SignupFormProps = { providers?: { google: boolean; microsoft: boolean }; initialError?: string | null };

export function SignupForm({ providers = { google: false, microsoft: false }, initialError }: SignupFormProps) {
  const [state, action, pending] = useActionState<SignUpState, FormData>(signUp, null);
  const [checking, startCheck] = useTransition();
  const [step, setStep] = useState<"email" | "details">("email");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [emailIssue, setEmailIssue] = useState<EmailIssue>(null);
  const [seen, setSeen] = useState<SignUpState>(null);
  const zone = useSyncExternalStore(noop, browserZone, serverZone);
  const emailRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const hasOAuth = providers.google || providers.microsoft;

  // A final submit that failed on the email (taken meanwhile, policy) returns to step 1 with the message.
  if (state !== seen) {
    setSeen(state);
    if (state && !state.ok) {
      if (state.error.code === "conflict") {
        setStep("email");
        setEmailIssue({ kind: "taken", message: state.error.message });
      } else if (state.error.code === "forbidden") {
        setStep("email");
        setEmailIssue({ kind: "closed", message: state.error.message });
      } else if (state.error.fieldErrors?.email) {
        setStep("email");
        setEmailIssue({ kind: "other", message: state.error.fieldErrors.email[0] ?? state.error.message });
      }
    }
  }

  useEffect(() => {
    if (step === "details") nameRef.current?.focus();
  }, [step]);

  function continueWithEmail(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = SignupEmailInput.safeParse({ email });
    if (!parsed.success) {
      setEmailIssue({ kind: "other", message: parsed.error.issues[0]?.message ?? "Enter a valid email address" });
      emailRef.current?.focus();
      return;
    }
    startCheck(async () => {
      const res = await checkSignupEmail({ email: parsed.data.email });
      if (res.ok) {
        setEmail(res.data.email);
        setEmailIssue(null);
        setStep("details");
        return;
      }
      const kind = res.error.code === "conflict" ? "taken" : res.error.code === "forbidden" ? "closed" : "other";
      setEmailIssue({ kind, message: res.error.fieldErrors?.email?.[0] ?? res.error.message });
      emailRef.current?.focus();
    });
  }

  const fieldErrors = state && !state.ok ? state.error.fieldErrors : undefined;
  const detailsError =
    state && !state.ok && !fieldErrors && state.error.code !== "conflict" && state.error.code !== "forbidden" ? state.error.message : null;
  const checks = passwordChecks(password);

  if (step === "details") {
    return (
      <form action={action} className="flex flex-col gap-5 animate-slide-in-x motion-reduce:animate-none" noValidate aria-label="Create your account">
        <input type="hidden" name="email" value={email} />
        <input type="hidden" name="timezone" value={zone} />
        <div className="flex items-center gap-2 rounded-[var(--radius-input)] bg-pebble px-3 py-2 text-body-md text-ink-2">
          <button
            type="button"
            onClick={() => setStep("email")}
            aria-label="Back to email"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-ink hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
          </button>
          <span className="min-w-0 truncate">
            Signing up as <span className="font-semibold text-ink">{email}</span>
          </span>
        </div>
        <div aria-live="polite">{detailsError ? <Banner variant="error">{detailsError}</Banner> : null}</div>
        <FormField label="Enter your full name" error={fieldErrors?.name?.[0]}>
          {(control) => (
            <Input
              {...control}
              ref={nameRef}
              name="name"
              size="lg"
              autoComplete="name"
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
            />
          )}
        </FormField>
        <div className="flex flex-col gap-1">
          <label htmlFor="signup-password" className="text-label text-ink">
            Choose a password
          </label>
          <PasswordInput
            id="signup-password"
            name="password"
            size="lg"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={cn("signup-password-hint", fieldErrors?.password && "signup-password-error")}
            aria-invalid={fieldErrors?.password ? true : undefined}
          />
          <ul id="signup-password-hint" className="mt-1 flex flex-col gap-1 text-body-sm text-ink-2">
            <PasswordRule met={checks.length}>At least 8 characters</PasswordRule>
            <PasswordRule met={checks.letterAndNumber}>At least one letter and one number</PasswordRule>
          </ul>
          {fieldErrors?.password ? (
            <p id="signup-password-error" role="alert" className="text-body-sm text-danger-text">
              {fieldErrors.password[0]}
            </p>
          ) : null}
        </div>
        <Button type="submit" size="lg" fullWidth loading={pending}>
          Sign up
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {initialError && !emailIssue ? <Banner variant="error">{initialError}</Banner> : null}
      <form onSubmit={continueWithEmail} className="flex flex-col gap-4" noValidate aria-label="Sign up with email">
        <FormField label="Enter your email" error={emailIssue?.kind === "other" ? emailIssue.message : null}>
          {(control) => (
            <Input
              {...control}
              ref={emailRef}
              name="email"
              type="email"
              size="lg"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailIssue) setEmailIssue(null);
              }}
              aria-invalid={emailIssue ? true : undefined}
              aria-describedby={emailIssue && emailIssue.kind !== "other" ? "signup-email-issue" : control["aria-describedby"]}
            />
          )}
        </FormField>
        <div aria-live="polite" id="signup-email-issue">
          {emailIssue?.kind === "taken" ? (
            <Banner variant="error">
              An account with this email already exists.{" "}
              <Link href="/login" className="font-semibold underline">
                Log in instead.
              </Link>
            </Banner>
          ) : emailIssue?.kind === "closed" ? (
            <Banner variant="error">{emailIssue.message}</Banner>
          ) : null}
        </div>
        <Button type="submit" size="lg" fullWidth loading={checking}>
          Continue with email
        </Button>
      </form>
      {hasOAuth ? (
        <>
          <Separator label="or" />
          <div className="flex flex-col gap-3">
            <OAuthButtons providers={providers} intent="signup" />
            {providers.google ? (
              <p className="text-center text-body-sm text-ink-2">Continue with Google to connect your calendar.</p>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PasswordRule({ met, children }: { met: boolean; children: ReactNode }) {
  return (
    <li className={cn("flex items-center gap-2", met && "text-success-text")}>
      {met ? <Check aria-hidden="true" className="size-4" /> : <Circle aria-hidden="true" className="size-3.5" />}
      <span>
        {children}
        <span className="sr-only">{met ? " (done)" : " (required)"}</span>
      </span>
    </li>
  );
}
