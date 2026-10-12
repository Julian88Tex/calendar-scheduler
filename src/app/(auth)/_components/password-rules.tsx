// OWNER: foundation-auth.
//
// The AU-01 password rule hint shown under "Choose a password" (signup) and "New password" (reset): "At least 8
// characters" and "At least one letter and one number", each turning green with a check as it is met. The list is the
// field's description (pass `id` to aria-describedby); screen readers hear "(done)" or "(required)" after each rule.
"use client";

import { Check, Circle } from "lucide-react";
import type { ReactNode } from "react";
import { passwordChecks } from "@/lib/auth/schemas";

export function PasswordRules({ id, password }: { id: string; password: string }) {
  const checks = passwordChecks(password);
  return (
    <ul id={id} className="mt-1 flex flex-col gap-1 text-body-sm text-ink-2">
      <PasswordRule met={checks.length}>At least 8 characters</PasswordRule>
      <PasswordRule met={checks.letterAndNumber}>At least one letter and one number</PasswordRule>
    </ul>
  );
}

function PasswordRule({ met, children }: { met: boolean; children: ReactNode }) {
  return (
    <li className={`flex items-center gap-2${met ? " text-success-text" : ""}`}>
      {met ? <Check aria-hidden="true" className="size-4" /> : <Circle aria-hidden="true" className="size-3.5" />}
      <span>
        {children}
        <span className="sr-only">{met ? " (done)" : " (required)"}</span>
      </span>
    </li>
  );
}
