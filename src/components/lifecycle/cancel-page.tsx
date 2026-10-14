// The invitee cancel page card (SPEC CR-02, CR-05, SCH-23; walkthrough 11.6): the two-panel booking card with the
// meeting summary on the left and, on the right, "Cancel Event?", the guests notice ("This event will be canceled for
// {invitee} and {count} guests."), the "Reason for canceling" textarea (required with an asterisk when the event type
// requires a reason), the cancellation policy and the "Cancel Event" pill. After the cancel: "Cancellation Confirmed",
// "Your meeting with {Host} has been canceled." and "Schedule another event", with the summary struck through. Refused
// states (already canceled, already occurred, the cutoff) render the state panel. Client component (the form).
"use client";

import { CircleCheck } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import type * as React from "react";
import { BookingCard, BookingMainSection, BookingPanelHeading } from "@/components/public/booking-card";
import { PublicFooterLinks } from "@/components/public/public-footer-links";
import { Button, buttonClassName } from "@/components/ui/button";
import { FieldError } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions";
import lifecycleMessages from "@/lib/i18n/messages/en/lifecycle";
import { cn } from "@/lib/cn";
import { ChangeStatePanel } from "./change-state-panel";
import { BRAND_PILL } from "./lib/brand";
import { changePagePath, guestsNotice } from "./lib/state";
import { lt } from "./lib/t";
import { MeetingSummaryPanel } from "./meeting-summary-panel";
import type { ChangePageView } from "./types";

export const REASON_MAX = 2000;

export type CancelInviteeAction = (input: { inviteeId: string; reason: string | null }) => Promise<ActionResult<{ meetingCanceled: boolean }>>;

export type CancelPageProps = {
  view: ChangePageView;
  cancelAction: CancelInviteeAction;
};

export function CancelPage({ view, cancelAction }: CancelPageProps) {
  const router = useRouter();
  const s = view.summary;
  const base = `cancel-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const doneRef = useRef<HTMLHeadingElement>(null);

  const footer = <PublicFooterLinks operatorEmail={view.shell.operatorEmail} showPrivacyPolicy={Boolean(view.shell.privacyUrl)} privacyUrl={view.shell.privacyUrl} />;
  const side = <MeetingSummaryPanel summary={s} struck={s.canceled || done} footer={footer} />;

  const submit = async () => {
    if (submitting) return;
    const r = reason.trim();
    if (view.requireReason && !r) {
      setError(lifecycleMessages.changes.reasonRequired);
      reasonRef.current?.focus();
      return;
    }
    if (r.length > REASON_MAX) {
      setError(lt("errors.reasonTooLong"));
      reasonRef.current?.focus();
      return;
    }
    setError(null);
    setFormError(null);
    setSubmitting(true);
    let result: Awaited<ReturnType<CancelInviteeAction>>;
    try {
      result = await cancelAction({ inviteeId: view.inviteeId, reason: r || null });
    } catch {
      setSubmitting(false);
      setFormError(lt("errors.network"));
      return;
    }
    setSubmitting(false);
    if (result.ok) {
      setDone(true);
      window.setTimeout(() => doneRef.current?.focus(), 0);
      return;
    }
    const field = result.error.fieldErrors?.reason?.[0];
    if (field) {
      setError(field);
      reasonRef.current?.focus();
      return;
    }
    setFormError(result.error.message || lt("errors.generic"));
    // Canceled, rescheduled or started meanwhile: show the page's current state.
    if (result.error.code === "conflict" || result.error.code === "not_found") router.refresh();
  };

  let main: React.ReactNode;
  if (done) {
    main = (
      <BookingMainSection>
        <div role="status" className="flex flex-col items-start gap-4" data-testid="cancel-done">
          <h2 ref={doneRef} tabIndex={-1} className="flex items-center gap-2.5 text-[20px] leading-7 font-bold text-public-text outline-none min-[600px]:text-[22px]">
            <CircleCheck aria-hidden="true" className="size-7 shrink-0 text-success" />
            {lt("cancel.done")}
          </h2>
          <p className="text-[15px] leading-[22px] text-public-text">{lt("cancel.doneBody", { hostName: s.hostName })}</p>
          <p className="text-[14px] leading-[22px] text-ink-2">{lt("cancel.doneEmail", { email: s.inviteeEmail })}</p>
          {view.scheduleAnotherHref && (
            <Link
              href={view.scheduleAnotherHref as Route}
              className={cn(buttonClassName({ variant: "secondary", size: "lg" }), "mt-2 border-brand text-brand-strong")}
              data-testid="schedule-another"
            >
              {lt("states.scheduleAnother")}
            </Link>
          )}
        </div>
      </BookingMainSection>
    );
  } else if (view.blocked) {
    main = (
      <ChangeStatePanel
        copy={view.blocked}
        scheduleAnotherHref={view.scheduleAnotherHref}
        rebook={view.rebook ? { href: changePagePath("reschedule", view.inviteeId), hostName: s.hostName } : null}
      />
    );
  } else {
    const notice = guestsNotice(s.inviteeName, s.guestCount);
    const errorId = error ? `${base}-error` : undefined;
    const policyId = view.cancellationPolicy ? `${base}-policy` : undefined;
    main = (
      <BookingMainSection>
        <BookingPanelHeading>{lt("cancel.heading")}</BookingPanelHeading>
        {notice && (
          <p className="mt-3 text-[15px] leading-[22px] text-public-text" data-testid="cancel-guests">
            {notice}
          </p>
        )}
        <form
          noValidate
          aria-label={lt("cancel.title")}
          className="mt-6 flex flex-col gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {formError && (
            <p role="alert" className="rounded-[var(--radius-card)] border border-danger-soft bg-danger-soft px-4 py-3 text-[14px] font-semibold text-danger-text">
              {formError}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${base}-reason`} className="text-label text-ink">
              {lt("cancel.reasonLabel")}
              {view.requireReason && (
                <span aria-hidden="true" className="ml-0.5 text-danger-text">
                  *
                </span>
              )}
            </label>
            <Textarea
              ref={reasonRef}
              id={`${base}-reason`}
              rows={4}
              maxLength={REASON_MAX}
              showCount
              required={view.requireReason}
              invalid={Boolean(error)}
              aria-invalid={error ? true : undefined}
              aria-describedby={[errorId, policyId].filter(Boolean).join(" ") || undefined}
              placeholder={lt("cancel.reasonPlaceholder", { hostName: s.hostName })}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (error) setError(null);
              }}
            />
            <FieldError id={errorId} error={error} />
          </div>
          {view.cancellationPolicy && (
            <section id={policyId} aria-label={lt("cancel.policy")} className="flex flex-col gap-1" data-testid="cancellation-policy">
              <h3 className="text-[14px] font-bold text-ink">{lt("cancel.policy")}</h3>
              <p className="text-[14px] leading-[22px] break-words whitespace-pre-line text-ink-2">{view.cancellationPolicy}</p>
            </section>
          )}
          <div className="max-[599px]:sticky max-[599px]:bottom-0 max-[599px]:-mx-5 max-[599px]:border-t max-[599px]:border-line max-[599px]:bg-public-bg max-[599px]:px-5 max-[599px]:py-3">
            <Button type="submit" size="lg" loading={submitting} className={cn(BRAND_PILL, "max-[599px]:w-full")}>
              {lt("cancel.submit")}
            </Button>
          </div>
        </form>
      </BookingMainSection>
    );
  }

  return (
    <div data-change-page="cancel">
      <BookingCard side={side} ribbon={view.shell.ribbon}>
        {main}
      </BookingCard>
    </div>
  );
}
