// Settings > Login and security, "Login" card (SPEC BR-10, AU-10; docs/SCOPE.md item 14): the login email and the
// password. "Change password" asks for the current password and the new one (twice); accounts created with Google get
// "Set password" instead, which needs no current password. Saving logs out every other session (the current one
// stays) and is audited.
"use client";

import { KeyRound, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { changePasswordAction } from "@/lib/settings/actions";
import { CURRENT_PASSWORD_REQUIRED_MESSAGE, PASSWORD_RULES_HINT, PasswordChangeInput } from "@/lib/settings/schemas";

export type PasswordCardProps = {
  email: string;
  hasPassword: boolean;
  /** Linked sign-in providers ("google"). */
  providers: string[];
};

type Fields = { currentPassword: string; newPassword: string; confirmPassword: string };
type Errors = Partial<Record<keyof Fields | "_form", string>>;

const EMPTY: Fields = { currentPassword: "", newPassword: "", confirmPassword: "" };
const PROVIDER_NAMES: Record<string, string> = { google: "Google", microsoft: "Microsoft" };

export function PasswordCard({ email, hasPassword, providers }: PasswordCardProps) {
  const router = useRouter();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [pending, startTransition] = useTransition();
  const providerNames = providers.map((p) => PROVIDER_NAMES[p] ?? p);
  const verb = hasPassword ? "Change password" : "Set password";

  const ids = { currentPassword: `${id}-current`, newPassword: `${id}-new`, confirmPassword: `${id}-confirm` };

  const openDialog = () => {
    setFields(EMPTY);
    setErrors({});
    setOpen(true);
  };

  const set = (key: keyof Fields, value: string) => {
    setFields((f) => ({ ...f, [key]: value }));
    if (errors[key] || errors._form) setErrors((e) => ({ ...e, [key]: undefined, _form: undefined }));
  };

  const focusFirst = (errs: Errors) => {
    const first = (["currentPassword", "newPassword", "confirmPassword"] as const).find((k) => errs[k]);
    if (first) requestAnimationFrame(() => document.getElementById(ids[first])?.focus());
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Errors = {};
    if (hasPassword && !fields.currentPassword) errs.currentPassword = CURRENT_PASSWORD_REQUIRED_MESSAGE;
    const parsed = PasswordChangeInput.safeParse(fields);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "_form") as keyof Errors;
        errs[key] ??= issue.message;
      }
    }
    if (Object.keys(errs).length || !parsed.success) {
      setErrors(errs);
      focusFirst(errs);
      return;
    }
    startTransition(async () => {
      let res: Awaited<ReturnType<typeof changePasswordAction>>;
      try {
        // FormData, not a plain object: passwords never show up in the dev server's Server Action logs.
        const body = new FormData();
        body.set("currentPassword", parsed.data.currentPassword);
        body.set("newPassword", parsed.data.newPassword);
        body.set("confirmPassword", parsed.data.confirmPassword);
        res = await changePasswordAction(body);
      } catch {
        setErrors({ _form: "Couldn't save your password. Try again." });
        return;
      }
      if (!res.ok) {
        const next: Errors = {};
        for (const [key, messages] of Object.entries(res.error.fieldErrors ?? {})) {
          const k = (key in ids ? key : "_form") as keyof Errors;
          next[k] ??= messages[0];
        }
        if (!Object.keys(next).length) next._form = res.error.message;
        setErrors(next);
        focusFirst(next);
        return;
      }
      setOpen(false);
      setFields(EMPTY);
      toast.success(hasPassword ? "Password changed" : "Password set", { description: "You were logged out of your other sessions." });
      router.refresh();
    });
  };

  return (
    <Card padding="lg" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-title-md font-bold text-ink">
        Login
      </h2>
      <p className="mt-1 text-body-md text-ink-2">How you log in to your account.</p>
      <dl className="mt-5 flex flex-col divide-y divide-line border-y border-line">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
          <dt className="flex w-40 shrink-0 items-center gap-2 text-label text-ink">
            <Mail aria-hidden="true" className="size-4 text-ink-2" />
            Email address
          </dt>
          <dd className="min-w-0 flex-1 text-body-md break-all text-ink">
            {email}
            {providerNames.length > 0 && <span className="block text-body-sm text-ink-2">You can also log in with {providerNames.join(" or ")}.</span>}
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
          <dt className="flex w-40 shrink-0 items-center gap-2 text-label text-ink">
            <KeyRound aria-hidden="true" className="size-4 text-ink-2" />
            Password
          </dt>
          <dd className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
            <span className="text-body-md text-ink-2">
              {hasPassword ? (
                <>
                  <span aria-hidden="true">••••••••</span>
                  <span className="sr-only">A password is set</span>
                </>
              ) : (
                `No password yet. You log in with ${providerNames.join(" or ") || "a sign-in provider"}.`
              )}
            </span>
            <Button variant="secondary" size="sm" onClick={openDialog}>
              {verb}
            </Button>
          </dd>
        </div>
      </dl>

      <Dialog
        open={open}
        onOpenChange={(v) => !pending && setOpen(v)}
        title={verb}
        description={hasPassword ? "Enter your current password, then choose a new one." : "Choose a password to also log in with your email address."}
        size="sm"
        preventOutsideClose
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" form={`${id}-form`} loading={pending}>
              {verb}
            </Button>
          </>
        }
      >
        <form id={`${id}-form`} noValidate onSubmit={submit} className="flex flex-col gap-4">
          <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
          {hasPassword && (
            <FormField label="Current password" htmlFor={ids.currentPassword} error={errors.currentPassword} required>
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  name="currentPassword"
                  autoComplete="current-password"
                  value={fields.currentPassword}
                  onChange={(e) => set("currentPassword", e.target.value)}
                />
              )}
            </FormField>
          )}
          <FormField label="New password" htmlFor={ids.newPassword} hint={PASSWORD_RULES_HINT} error={errors.newPassword} required>
            {(control) => (
              <Input
                {...control}
                type="password"
                name="newPassword"
                autoComplete="new-password"
                value={fields.newPassword}
                onChange={(e) => set("newPassword", e.target.value)}
              />
            )}
          </FormField>
          <FormField label="Confirm new password" htmlFor={ids.confirmPassword} error={errors.confirmPassword} required>
            {(control) => (
              <Input
                {...control}
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                value={fields.confirmPassword}
                onChange={(e) => set("confirmPassword", e.target.value)}
              />
            )}
          </FormField>
          {errors._form && (
            <p role="alert" className="text-body-sm font-semibold text-danger-text">
              {errors._form}
            </p>
          )}
          <p className="text-body-sm text-ink-2">Saving logs you out on every other browser and device.</p>
        </form>
      </Dialog>
    </Card>
  );
}
