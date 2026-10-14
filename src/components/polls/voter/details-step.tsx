// "Share your preferred times" (SPEC MP-09, MP-10; research B5.3, B5.4): Name (required), Email (required unless the
// poll allows name-only votes; read-only for invite links, signed-in users and an edit of an earlier response),
// Comment when comments are on, "Get updates when others vote" when others' votes are visible, the hidden honeypot,
// the Turnstile widget when the instance requires it, the 6-digit code when "Verify email" is on, and "Share times".
// The decline variant ("None of these work for me") asks for the same details. Client component.
"use client";

import { ArrowLeft } from "lucide-react";
import type * as React from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MAX_COMMENT_LENGTH, MAX_EMAIL_LENGTH, MAX_NAME_LENGTH } from "@/lib/polls/constants";
import { pt } from "../lib/t";

export type DetailsValues = { name: string; email: string; comment: string; subscribe: boolean; code: string };

export type DetailsStepProps = {
  declining: boolean;
  values: DetailsValues;
  onChange: (v: Partial<DetailsValues>) => void;
  errors: Partial<Record<keyof DetailsValues | "form", string>>;
  emailRequired: boolean;
  /** The email can't change (invite link, signed-in user, earlier response). */
  emailLocked: boolean;
  /** The name can't change (invite link or signed-in user). */
  nameLocked: boolean;
  lockedNote: string | null;
  allowComment: boolean;
  canSubscribe: boolean;
  codeStep: { sentTo: string } | null;
  onResendCode: () => void;
  resending: boolean;
  submitting: boolean;
  preview: boolean;
  formExpired: boolean;
  summary: React.ReactNode;
  onBack: () => void;
  onSubmit: () => void;
  honeypotRef: React.RefObject<HTMLInputElement | null>;
  turnstileRef: React.RefObject<HTMLDivElement | null>;
  showTurnstile: boolean;
};

export function DetailsStep({ honeypotRef, turnstileRef, ...p }: DetailsStepProps) {
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    p.onSubmit();
  };
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5" data-testid="vote-details">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={p.onBack}
          aria-label={pt("voter.back")}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line text-brand-strong hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </button>
        <h2 className="text-[20px] leading-7 font-bold text-public-text outline-none min-[600px]:text-[22px]" tabIndex={-1} data-autofocus>
          {p.declining ? pt("voter.declineHeading") : pt("voter.detailsHeading")}
        </h2>
      </div>

      {p.declining ? <p className="text-body-md text-ink-2">{pt("voter.declineNote")}</p> : p.summary}

      {p.errors.form && (
        <Banner variant="error" action={p.formExpired ? <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>{pt("voter.formExpiredRefresh")}</Button> : undefined}>
          {p.errors.form}
        </Banner>
      )}

      {p.lockedNote && <p className="text-body-md text-ink-2">{p.lockedNote}</p>}

      <FormField label={pt("voter.name")} required error={p.errors.name}>
        {(control) => (
          <Input
            {...control}
            size="lg"
            value={p.values.name}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="name"
            readOnly={p.nameLocked}
            onChange={(e) => p.onChange({ name: e.target.value })}
            invalid={Boolean(p.errors.name)}
          />
        )}
      </FormField>

      <FormField label={p.emailRequired ? pt("voter.email") : pt("voter.emailOptional")} required={p.emailRequired} error={p.errors.email}>
        {(control) => (
          <Input
            {...control}
            size="lg"
            type="email"
            inputMode="email"
            value={p.values.email}
            maxLength={MAX_EMAIL_LENGTH}
            autoComplete="email"
            readOnly={p.emailLocked}
            onChange={(e) => p.onChange({ email: e.target.value })}
            invalid={Boolean(p.errors.email)}
          />
        )}
      </FormField>

      {p.codeStep && (
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-pebble p-4">
          <p className="text-label text-public-text">{pt("voter.verifyHeading")}</p>
          <p className="text-body-md text-ink-2">{pt("voter.verifyBody", { email: p.codeStep.sentTo })}</p>
          <FormField label={pt("voter.verifyCode")} required error={p.errors.code}>
            {(control) => (
              <Input
                {...control}
                size="lg"
                value={p.values.code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                onChange={(e) => p.onChange({ code: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                invalid={Boolean(p.errors.code)}
                className="max-w-[200px] tracking-[0.3em]"
              />
            )}
          </FormField>
          <div>
            <Button type="button" variant="tertiary" size="sm" loading={p.resending} onClick={p.onResendCode}>
              {pt("voter.verifyResend")}
            </Button>
          </div>
        </div>
      )}

      {p.allowComment && !p.declining && (
        <FormField label={pt("voter.comment")} error={p.errors.comment}>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={p.values.comment}
              maxLength={MAX_COMMENT_LENGTH}
              placeholder={pt("voter.commentPlaceholder")}
              onChange={(e) => p.onChange({ comment: e.target.value })}
              invalid={Boolean(p.errors.comment)}
            />
          )}
        </FormField>
      )}

      {p.canSubscribe && !p.declining && (
        <Checkbox label={pt("voter.subscribe")} checked={p.values.subscribe} onCheckedChange={(on) => p.onChange({ subscribe: on })} />
      )}

      {/* Honeypot (MP-30, BK-18 pattern): invisible to people and assistive technology, filled only by bots. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="poll-website">Website</label>
        <input ref={honeypotRef} id="poll-website" type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      {p.showTurnstile && <div ref={turnstileRef} data-testid="turnstile" className="empty:hidden" />}

      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" loading={p.submitting} disabled={p.preview} className="w-full min-[600px]:w-auto min-[600px]:self-start" data-testid="submit-vote">
          {p.declining ? pt("voter.declineSubmit") : pt("voter.shareTimes")}
        </Button>
        {p.preview && <p className="text-body-sm text-ink-2">{pt("voter.previewBanner")}</p>}
      </div>
    </form>
  );
}
