// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// FormField and FieldError (ARCHITECTURE 20.2): label, hint, error and required asterisk, wired with
// aria-describedby. Children may be a render function receiving the ids to spread on the control.
"use client";

import { useId } from "react";
import type * as React from "react";
import { cn } from "@/lib/cn";
import { Label } from "./label";

export type FieldControlProps = { id: string; "aria-describedby": string | undefined; "aria-invalid": boolean | undefined; required?: boolean };

export type FormFieldProps = {
  label: React.ReactNode;
  /** Id of the control (generated when omitted; render-function children receive it). */
  htmlFor?: string;
  hint?: React.ReactNode;
  /** One message, a list (first shown) or nothing. */
  error?: string | string[] | null;
  required?: boolean;
  /** Visually hide the label (it stays the accessible name). */
  hideLabel?: boolean;
  className?: string;
  children: React.ReactNode | ((control: FieldControlProps) => React.ReactNode);
};

function firstError(error: string | string[] | null | undefined): string | null {
  if (!error) return null;
  return Array.isArray(error) ? (error[0] ?? null) : error;
}

export function FormField({ label, htmlFor, hint, error, required, hideLabel, className, children }: FormFieldProps) {
  const generated = useId();
  const id = htmlFor ?? `field-${generated}`;
  const message = firstError(error);
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = message ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const control: FieldControlProps = { id, "aria-describedby": describedBy, "aria-invalid": message ? true : undefined, required };
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label htmlFor={id} required={required} className={hideLabel ? "sr-only" : undefined}>
        {label}
      </Label>
      {typeof children === "function" ? children(control) : children}
      {hint && (
        <p id={hintId} className="text-body-sm text-ink-2">
          {hint}
        </p>
      )}
      <FieldError id={errorId} error={message} />
    </div>
  );
}

export type FieldErrorProps = { id?: string; error?: string | string[] | null; children?: React.ReactNode; className?: string };

export function FieldError({ id, error, children, className }: FieldErrorProps) {
  const message = children ?? firstError(error);
  if (!message) return null;
  return (
    <p id={id} role="alert" className={cn("text-body-sm text-danger-text", className)}>
      {message}
    </p>
  );
}
