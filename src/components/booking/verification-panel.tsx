// "Verify your email" step (SPEC BK-17, GEN-08): the 6-digit code sent to the invitee, "Remember this device" (a 365 day
// embed-safe cookie, mirrored in localStorage when the browser blocks cookies inside iframes), "Didn't get it? Resend
// code" and "Continue". Talks to POST /api/public/bookings/{reservationId}/verify (booking-core); always uses the latest
// reservation id.
"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { fallbackCookieHeaders, rememberFallbackCookie } from "@/lib/client/embed-cookie";
import { cn } from "@/lib/cn";
import { BRAND_BUTTON } from "./details-form";
import { bt } from "./lib/t";

export type VerifiedBooking = { inviteeId: string; scheduledEventId: string | null; redirectUrl: string | null };

export type VerificationPanelProps = {
  reservationId: string;
  email: string;
  embed: boolean;
  trustedDeviceCookie: string;
  onVerified: (b: VerifiedBooking) => void;
  /** The hold is gone or the time was taken: back to the times. */
  onSlotTaken: () => void;
  onChangeEmail: () => void;
};

type VerifyBody = {
  ok?: boolean;
  code?: string;
  error?: string;
  message?: string;
  inviteeId?: string;
  scheduledEventId?: string;
  redirectUrl?: string;
  trustedDevice?: { cookieName: string; value: string; maxAgeSeconds: number };
};

export function VerificationPanel(p: VerificationPanelProps) {
  const base = `vf-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<"verify" | "resend" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const post = async (body: Record<string, unknown>): Promise<{ status: number; data: VerifyBody }> => {
    const res = await fetch(`/api/public/bookings/${encodeURIComponent(p.reservationId)}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...fallbackCookieHeaders([p.trustedDeviceCookie]) },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    const data = ((await res.json().catch(() => ({}))) ?? {}) as VerifyBody;
    return { status: res.status, data };
  };

  const verify = async () => {
    const clean = code.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(clean)) {
      setError(bt("verify.enterCode"));
      inputRef.current?.focus();
      return;
    }
    setBusy("verify");
    setError(null);
    setNotice(null);
    try {
      const { status, data } = await post({ code: clean, rememberDevice: remember, embed: p.embed });
      if (data.ok && data.inviteeId) {
        if (data.trustedDevice) rememberFallbackCookie(data.trustedDevice.cookieName, data.trustedDevice.value, data.trustedDevice.maxAgeSeconds);
        p.onVerified({ inviteeId: data.inviteeId, scheduledEventId: data.scheduledEventId ?? null, redirectUrl: data.redirectUrl ?? null });
        return;
      }
      const c = data.code ?? data.error;
      if (c === "slot_unavailable" || c === "not_found" || c === "link_used") {
        p.onSlotTaken();
        return;
      }
      setError(
        c === "invalid_code"
          ? bt("verify.invalid")
          : c === "expired"
            ? bt("verify.expired")
            : c === "too_many_attempts" || status === 429
              ? bt("verify.tooMany")
              : c === "already_booked"
                ? bt("errors.alreadyBooked")
                : (data.message ?? bt("errors.generic")),
      );
      setBusy(null);
      inputRef.current?.focus();
    } catch {
      setError(bt("errors.network"));
      setBusy(null);
    }
  };

  const resend = async () => {
    setBusy("resend");
    setError(null);
    setNotice(null);
    try {
      const { status, data } = await post({ resend: true });
      if (data.ok) setNotice(bt("verify.resent", { email: p.email }));
      else if (status === 429) setError(bt("errors.rateLimited"));
      else if (data.code === "expired" || data.code === "not_found") setError(bt("verify.holdExpired"));
      else setError(data.message ?? bt("errors.generic"));
    } catch {
      setError(bt("errors.network"));
    } finally {
      setBusy(null);
    }
  };

  const errorId = error ? `${base}-error` : undefined;
  return (
    <form
      noValidate
      aria-labelledby={`${base}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        void verify();
      }}
      className="flex min-w-0 flex-col gap-5"
      data-testid="verification-step"
    >
      <div className="flex flex-col gap-2">
        <h3 id={`${base}-title`} className="text-[18px] leading-6 font-bold text-public-text">
          {bt("verify.title")}
        </h3>
        <p className="text-[14px] leading-5 text-ink-2">{bt("verify.body", { email: p.email })}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${base}-code`} className="text-label text-ink">
          {bt("verify.code")}
        </label>
        <Input
          ref={inputRef}
          id={`${base}-code`}
          size="lg"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
          aria-invalid={error ? true : undefined}
          aria-describedby={errorId}
          className="max-w-[220px] text-[20px] tracking-[0.3em] tabular-nums"
        />
        <FieldError id={errorId} error={error} />
      </div>
      <Checkbox label={bt("verify.remember")} description={bt("verify.rememberHint")} checked={remember} onCheckedChange={setRemember} />
      <div aria-live="polite" className="text-[14px] text-ink-2">
        {notice}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Button type="submit" size="lg" loading={busy === "verify"} disabled={busy === "resend"} className={cn(BRAND_BUTTON)}>
          {bt("verify.continue")}
        </Button>
        <p className="text-[14px] text-ink-2">
          {bt("verify.resendPrompt")}{" "}
          <button type="button" onClick={() => void resend()} disabled={busy !== null} className="font-semibold text-brand-strong hover:underline disabled:opacity-60">
            {bt("verify.resend")}
          </button>
        </p>
      </div>
      <button type="button" onClick={p.onChangeEmail} className="self-start text-[14px] font-semibold text-brand-strong hover:underline">
        {bt("verify.changeEmail")}
      </button>
    </form>
  );
}
