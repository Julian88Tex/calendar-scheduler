// The invitee reschedule flow (SPEC CR-03, CR-08, SCH-24, BK-04 to BK-09, BK-30; walkthrough 11.7): the booking
// page's two steps for the same event type with its current settings, rendered with booking-pages' building blocks:
//
// - calendar step: the details panel with the "Former Time" struck through, the duration picker starting on the
//   original duration while it is offered (BK-07), the month calendar with a month of slots per request in the
//   invitee's zone (the meeting being moved does not block itself, SCH-24), the time zone dropdown with the 12h/24h
//   toggle and the times column ([time][Next] split); phones get the separate times view
// - details step: /reschedulings/{id}/{ISO start} (pushState), the new time under the former one, the prefilled form
//   with "Reason for change" and "Update Event"; no email verification for a reschedule
// - outcome: the confirmation page of the new booking ("You are rescheduled"); a taken time shows "Sorry, that time
//   is no longer available." with "View Times"; a refusal (canceled or started meanwhile, cutoff) reloads into the
//   state card
//
// URL state (month, date, duration) uses the booking flow's helpers so back and forward work like the booking page.
"use client";

import type { Route } from "next";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookingCard, BookingMainSection, BookingPanelHeading } from "@/components/public/booking-card";
import { BackButton } from "@/components/public/back-button";
import { PublicFooterLinks } from "@/components/public/public-footer-links";
import { TimeSlotList, type TimeSlot } from "@/components/public/time-slot-list";
import { buildBookingBody, fieldOrder, validateForm, type FieldErrors, type FormContext, type FormValues } from "@/components/booking/lib/form";
import { availableDatesOf, monthsBetween, nextMonthOf, type MonthSlots, type SlotsRequest } from "@/components/booking/lib/slots";
import { bt } from "@/components/booking/lib/t";
import { calendarHref, detailsHref, parseDate, parseMonth, startFromPath } from "@/components/booking/lib/url-state";
import { rememberTimeFormat, useBrowserZone, useTimeFormat } from "@/components/booking/use-browser-env";
import { useMonthSlots } from "@/components/booking/use-month-slots";
import type { VerifiedBooking } from "@/components/booking/verification-panel";
import { Button } from "@/components/ui/button";
import { MonthCalendar } from "@/components/ui/month-calendar";
import { dayLabel, monthName } from "@/components/ui/month-calendar-utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { TimeZoneButton } from "@/components/ui/time-zone-select";
import { useMinuteClock } from "@/components/ui/use-minute-clock";
import type { ActionResult } from "@/lib/actions";
import { cn } from "@/lib/cn";
import { formatMeetingWhen, formatTime, isoDateInZone } from "@/lib/time/format";
import { currentLocalTime, friendlyZoneName } from "@/lib/time/zones";
import { BRAND_PILL } from "./lib/brand";
import type { RescheduleOutcome } from "./lib/outcome";
import { lt } from "./lib/t";
import { RescheduleDetailsForm, RESCHEDULE_REASON_MAX } from "./reschedule-details-form";
import { RescheduleSidePanel } from "./reschedule-side-panel";
import type { RescheduleFlowProps } from "./reschedule-types";

function StepSpinner() {
  return (
    <div className="flex h-40 items-center justify-center">
      <Spinner />
    </div>
  );
}
// A rebook on an event type with email verification is rare: the panel loads on demand (GEN-07).
const VerificationPanel = dynamic(() => import("@/components/booking/verification-panel").then((m) => m.VerificationPanel), { ssr: false, loading: StepSpinner });

const LOCALE = "en-US";
const MAX_JUMP_MONTHS = 12;
const MAX_MONTHS_AHEAD = 24;
const SLOT_LIST_TALL = "min-[1000px]:[@media(min-height:860px)]:[&_ul]:max-h-[596px]";
const NO_CARRY: [string, string][] = [];

export type RescheduleInput = {
  inviteeId: string;
  start: string;
  durationMinutes: number;
  reason: string | null;
  invitee: ReturnType<typeof buildBookingBody>["invitee"];
  guests: string[];
  locationAnswer: ReturnType<typeof buildBookingBody>["locationAnswer"];
  answers: ReturnType<typeof buildBookingBody>["answers"];
  clientRequestId: string;
};

export type RescheduleInviteeAction = (input: RescheduleInput) => Promise<ActionResult<RescheduleOutcome>>;

export type RescheduleFlowComponentProps = RescheduleFlowProps & { rescheduleAction: RescheduleInviteeAction };

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function fieldsOf(ctx: FormContext): Record<string, true> {
  return Object.fromEntries([...fieldOrder(ctx), "reason"].map((k) => [k, true]));
}

export function RescheduleFlow(p: RescheduleFlowComponentProps) {
  const router = useRouter();
  const event = p.event;
  const browserZone = useBrowserZone();
  const browserFormat = useTimeFormat();

  // Zone and time format (BK-05, GEN-06): the browser's, else the invitee's stored ones.
  const [zoneChoice, setZoneChoice] = useState<string | null>(null);
  const [formatChoice, setFormatChoice] = useState<"12h" | "24h" | null>(null);
  const zone = event.lockedTimeZone ?? zoneChoice ?? browserZone ?? p.inviteeZone ?? p.hostZone;
  const zoneReady = Boolean(event.lockedTimeZone || zoneChoice || browserZone);
  const timeFormat = formatChoice ?? browserFormat ?? p.inviteeTimeFormat ?? "12h";
  const hour12 = timeFormat === "12h";

  // Steps and selection.
  const deepLinkUnavailable = p.initial.mode === "details" && p.initial.startAvailable === false;
  const [step, setStep] = useState<"calendar" | "details">(p.initial.mode === "details" && !deepLinkUnavailable ? "details" : "calendar");
  const [start, setStart] = useState<string | null>(p.initial.start);
  const [durationChoice, setDurationChoice] = useState<number>(p.initial.duration);
  const duration = event.durations.includes(durationChoice) ? durationChoice : event.defaultDuration;
  const [dateChoice, setDateChoice] = useState<{ value: string | null } | null>(null);
  const [monthChoice, setMonthChoice] = useState<string | null>(null);
  const [jumpMonth, setJumpMonth] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [phoneView, setPhoneView] = useState<"main" | "times">(p.initial.date ? "times" : "main");
  const [slotTaken, setSlotTaken] = useState(deepLinkUnavailable);

  const todayDate = isoDateInZone(p.serverNow, zone);
  const todayMonth = todayDate.slice(0, 7);
  const derivedDate = p.initial.date ?? (deepLinkUnavailable && p.initial.start && zoneReady ? isoDateInZone(p.initial.start, zone) : null);
  const date = dateChoice ? dateChoice.value : derivedDate;
  const autoMonth = !p.initial.month && !p.initial.date && !deepLinkUnavailable;
  const rawMonth = monthChoice ?? p.initial.month ?? (date ? date.slice(0, 7) : null) ?? (autoMonth ? jumpMonth : null) ?? todayMonth;
  const month = rawMonth < todayMonth ? todayMonth : rawMonth;

  // Slots (BK-04, SCH-24).
  const slotsReq: SlotsRequest | null = zoneReady
    ? { target: p.slotsTarget, month, zone, duration, reschedule: p.rescheduleTarget, first: autoMonth && !monthChoice && !jumpMonth }
    : null;
  const slots = useMonthSlots(slotsReq, (r, data) => {
    if (!r.first) return;
    const first = data.firstAvailableDate;
    if (!first || availableDatesOf(data, r.month).length > 0) return;
    const target = first.slice(0, 7);
    if (target > r.month && monthsBetween(r.month, target) <= MAX_JUMP_MONTHS) setJumpMonth(target);
  });
  const data: MonthSlots | null = slots.status === "ready" ? slots.data : null;
  const dataZone = data?.timeZone ?? zone;
  const availableDates = useMemo(() => availableDatesOf(data, month), [data, month]);
  const dateInMonth = date && date.slice(0, 7) === month ? date : null;
  const effectiveDate = dateInMonth && data && !availableDates.includes(dateInMonth) ? null : dateInMonth;
  const daySlots = useMemo(() => (effectiveDate && data ? (data.days[effectiveDate] ?? []) : []), [effectiveDate, data]);
  const effectiveSelected = selected && daySlots.some((s) => s.start === selected) ? selected : null;

  const prefetch = slots.prefetch;
  useEffect(() => {
    if (slotsReq && data) prefetch({ ...slotsReq, month: nextMonthOf(month), first: false });
    // slotsReq is rebuilt every render; its fields are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, month, zone, duration, prefetch]);

  // Form state (prefilled, CR-03).
  const ctx: FormContext = useMemo(
    () => ({ nameFormat: event.nameFormat, allowGuests: event.allowGuests, locations: event.locations, questions: event.questions }),
    [event],
  );
  const [values, setValues] = useState<FormValues>(p.values);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [verification, setVerification] = useState<{ reservationId: string; email: string } | null>(null);
  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);

  const changeValues = (update: (v: FormValues) => FormValues) => {
    const next = update(values);
    setValues((prev) => update(prev));
    setErrors((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const still = validateForm(next, ctx);
      const known = fieldsOf(ctx);
      const out: FieldErrors = {};
      for (const [k, msg] of Object.entries(prev)) if (k in still || !(k in known) || k === "reason") out[k] = msg;
      return out;
    });
    if (formError) setFormError(null);
  };

  // URL state (BK-08).
  const urlState = { month, date: effectiveDate ?? (step === "details" ? date : null), duration, defaultDuration: p.originalDuration };
  const currentUrl = step === "details" && start ? detailsHref(p.basePath, NO_CARRY, start, urlState) : calendarHref(p.basePath, NO_CARRY, urlState);
  useEffect(() => {
    if (!zoneReady) return;
    if (window.location.pathname + window.location.search === currentUrl) return;
    const state = (window.history.state ?? {}) as { kairosFromCalendar?: boolean };
    window.history.replaceState({ kairosStep: step, kairosFromCalendar: state.kairosFromCalendar === true }, "", currentUrl);
  }, [currentUrl, step, zoneReady]);

  useEffect(() => {
    const onPop = () => {
      const s = startFromPath(window.location.pathname, p.basePath);
      const q = new URLSearchParams(window.location.search);
      const m = parseMonth(q.get("month"));
      if (m) setMonthChoice(m);
      setDateChoice({ value: parseDate(q.get("date")) });
      if (s) {
        setStart(s);
        setStep("details");
      } else {
        setStep("calendar");
        setVerification(null);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [p.basePath]);

  const lastStep = useRef(step);
  useEffect(() => {
    if (lastStep.current === step) return;
    lastStep.current = step;
    if (step === "details") detailsHeadingRef.current?.focus();
  }, [step]);

  // Handlers.
  const selectDate = (d: string) => {
    setDateChoice({ value: d });
    setSelected(null);
    setPhoneView("times");
  };
  const changeMonth = (m: string) => {
    setMonthChoice(m);
    setDateChoice({ value: null });
    setSelected(null);
  };
  const changeZone = (z: string) => {
    setZoneChoice(z);
    setSelected(null);
  };
  const changeFormat = (h12: boolean) => {
    const f = h12 ? "12h" : "24h";
    setFormatChoice(f);
    rememberTimeFormat(f);
  };
  const changeDuration = (d: number) => {
    setDurationChoice(d);
    setSelected(null);
  };
  const goDetails = (iso: string) => {
    setStart(iso);
    setSlotTaken(false);
    setFormError(null);
    setVerification(null);
    setStep("details");
    const url = detailsHref(p.basePath, NO_CARRY, iso, { month, date: effectiveDate, duration, defaultDuration: p.originalDuration });
    window.history.pushState({ kairosStep: "details", kairosFromCalendar: true }, "", url);
    window.scrollTo({ top: 0 });
  };
  const backToCalendar = () => {
    const state = (window.history.state ?? {}) as { kairosFromCalendar?: boolean };
    if (state.kairosFromCalendar) {
      window.history.back();
      return;
    }
    setStep("calendar");
    setVerification(null);
    if (start && !date) setDateChoice({ value: isoDateInZone(start, zone) });
    setSelected(start);
  };
  const viewTimes = () => {
    const d = start ? isoDateInZone(start, zone) : date;
    setStep("calendar");
    setVerification(null);
    setSlotTaken(true);
    setSelected(null);
    if (d) {
      setMonthChoice(d.slice(0, 7));
      setDateChoice({ value: d });
      setPhoneView("times");
    }
    slots.invalidate();
    window.scrollTo({ top: 0 });
  };

  const focusFirstError = (errs: FieldErrors) => {
    const first = [...fieldOrder(ctx), "reason"].find((k) => errs[k]) ?? Object.keys(errs)[0];
    if (!first) return;
    window.setTimeout(() => {
      const box = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(first)}"]`);
      const focusable = box?.querySelector<HTMLElement>("input:not([type=hidden]):not([tabindex='-1']), textarea, select, button[role=radio], button[role=checkbox], button");
      (focusable ?? box)?.focus();
      box?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  };

  const complete = (b: Pick<VerifiedBooking, "inviteeId">) => {
    router.push(`/booking/${encodeURIComponent(b.inviteeId)}` as Route);
  };

  const handleOutcome = (o: RescheduleOutcome, v: FormValues) => {
    switch (o.type) {
      case "ok":
        complete(o);
        return;
      case "verify":
        setVerification({ reservationId: o.reservationId, email: v.email.trim() });
        setSubmitting(false);
        return;
      case "fields": {
        const known = fieldsOf(ctx);
        const other = Object.entries(o.fieldErrors).find(([k]) => !(k in known));
        setErrors(o.fieldErrors);
        setFormError(other ? other[1] : Object.keys(o.fieldErrors).length === 0 ? (o.message ?? bt("details.formErrors")) : null);
        setSubmitting(false);
        focusFirstError(o.fieldErrors);
        return;
      }
      case "slot_taken":
        setSlotTaken(true);
        setSubmitting(false);
        slots.invalidate();
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      case "blocked":
        setFormError(o.message);
        setSubmitting(false);
        // Canceled, started or inside the cutoff meanwhile: show the page's state card.
        router.refresh();
        return;
      case "link_used":
        setFormError(bt("errors.linkUsed"));
        setSubmitting(false);
        return;
      default:
        setFormError(o.message);
        setSubmitting(false);
    }
  };

  const submit = async () => {
    if (submitting || !start) return;
    const v = values;
    const errs = validateForm(v, ctx);
    if (reason.trim().length > RESCHEDULE_REASON_MAX) errs.reason = lt("errors.reasonTooLong");
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      setFormError(null);
      focusFirstError(errs);
      return;
    }
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    const key = `${start}|${duration}|${v.email.trim().toLowerCase()}`;
    if (requestRef.current?.key !== key) requestRef.current = { key, id: newRequestId() };
    const body = buildBookingBody({
      target: { kind: "event_type", eventTypeId: p.slotsTarget },
      start,
      durationMinutes: duration,
      values: v,
      ctx,
      collectMarketing: p.collectMarketing,
      timezone: dataZone,
      detectedTimezone: browserZone,
      timeFormat,
      locale: LOCALE,
      tracking: {},
      clientRequestId: requestRef.current.id,
      formToken: "",
      honeypot: "",
      embed: false,
    });
    let result: ActionResult<RescheduleOutcome>;
    try {
      result = await p.rescheduleAction({
        inviteeId: p.inviteeId,
        start,
        durationMinutes: duration,
        reason: reason.trim() || null,
        invitee: body.invitee,
        guests: body.guests,
        locationAnswer: body.locationAnswer,
        answers: body.answers,
        clientRequestId: requestRef.current.id,
      });
    } catch {
      setSubmitting(false);
      setFormError(lt("errors.network"));
      return;
    }
    if (!result.ok) {
      setSubmitting(false);
      const fe = result.error.fieldErrors ?? {};
      const reasonError = fe.reason?.[0];
      if (reasonError) {
        setErrors({ reason: reasonError });
        focusFirstError({ reason: reasonError });
        return;
      }
      setFormError(result.error.message || lt("errors.generic"));
      return;
    }
    handleOutcome(result.data, v);
  };

  // Rendering helpers.
  const footer = <PublicFooterLinks operatorEmail={p.operatorEmail} showPrivacyPolicy={Boolean(p.privacyUrl)} privacyUrl={p.privacyUrl} />;
  const end = start ? new Date(Date.parse(start) + duration * 60_000).toISOString() : null;
  const whenText = start && end && zoneReady ? formatMeetingWhen(start, end, dataZone, LOCALE, hour12) : null;
  const formerText = zoneReady ? formatMeetingWhen(p.former.start, p.former.end, dataZone, LOCALE, hour12) : null;
  const notice = p.rebook ? lt("reschedule.rebookNotice", { hostName: p.hostName }) : null;
  const side = (
    <RescheduleSidePanel
      event={event}
      host={p.host}
      brandHeader={p.brandHeader}
      duration={duration}
      onDurationChange={step === "calendar" ? changeDuration : undefined}
      formerText={formerText}
      when={step === "details" && whenText ? { text: whenText, zoneName: friendlyZoneName(dataZone) } : null}
      zoneName={event.lockedTimeZone ? friendlyZoneName(event.lockedTimeZone) : null}
      notice={notice}
      footer={footer}
    />
  );

  if (step === "details" && start) {
    return (
      <div data-booking-flow="reschedule-details">
        <BookingCard side={side} ribbon={p.ribbon}>
          <BookingMainSection>
            <div className="mb-5">
              <BackButton onClick={backToCalendar} label={bt("page.backToCalendar")} />
            </div>
            <BookingPanelHeading>
              <span ref={detailsHeadingRef} tabIndex={-1} className="outline-none">
                {bt("details.title")}
              </span>
            </BookingPanelHeading>
            {slotTaken && (
              <div role="alert" className="mt-5 flex flex-col gap-3 rounded-[var(--radius-card)] border border-danger-soft bg-danger-soft px-4 py-3 text-danger-text min-[600px]:flex-row min-[600px]:items-center min-[600px]:justify-between">
                <div className="flex flex-col gap-0.5">
                  <p className="text-[14px] font-bold">{bt("slotTaken.title")}</p>
                  <p className="text-[13px]">{bt("slotTaken.body")}</p>
                </div>
                <Button type="button" size="sm" onClick={viewTimes} className={cn(BRAND_PILL, "shrink-0")}>
                  {bt("slotTaken.viewTimes")}
                </Button>
              </div>
            )}
            <div className="mt-6">
              {verification ? (
                <VerificationPanel
                  reservationId={verification.reservationId}
                  email={verification.email}
                  embed={false}
                  trustedDeviceCookie={p.trustedDeviceCookie}
                  onVerified={(b) => complete(b)}
                  onSlotTaken={viewTimes}
                  onChangeEmail={() => setVerification(null)}
                />
              ) : (
                <RescheduleDetailsForm
                  ctx={ctx}
                  values={values}
                  onChange={changeValues}
                  reason={reason}
                  onReasonChange={(r) => {
                    setReason(r);
                    if (errors.reason)
                      setErrors((prev) => {
                        const next = { ...prev };
                        delete next.reason;
                        return next;
                      });
                  }}
                  errors={errors}
                  formError={formError}
                  submitting={submitting}
                  onSubmit={() => void submit()}
                  collectMarketing={p.collectMarketing}
                  hostName={p.hostName}
                  cancellationPolicy={p.cancellationPolicy}
                  appName={p.appName}
                  termsUrl={p.termsUrl}
                  privacyUrl={p.privacyUrl}
                />
              )}
            </div>
          </BookingMainSection>
        </BookingCard>
      </div>
    );
  }

  // Calendar step.
  const fmt = (ms: number | string) => formatTime(ms, dataZone, LOCALE, hour12);
  const timeSlots: TimeSlot[] = daySlots.map((s) => ({
    value: s.start,
    label: fmt(s.start),
    detail: event.showRemainingSpots ? (s.remaining === 1 ? bt("page.spotLeft") : bt("page.spotsLeft", { count: s.remaining })) : null,
  }));
  const nextAllowed = !data?.windowEnd || Date.parse(data.windowEnd) > Date.parse(`${nextMonthOf(month)}-01T00:00:00Z`) - 14 * 3_600_000;
  const showNoTimes = slots.status === "ready" && availableDates.length === 0;
  const maxMonth = (() => {
    const [y, m] = todayMonth.split("-").map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + MAX_MONTHS_AHEAD, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  })();

  const times = effectiveDate ? (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-3 px-5 pt-5 min-[600px]:hidden">
        <BackButton onClick={() => setPhoneView("main")} label={bt("page.backToCalendar")} />
        <span className="min-w-0 truncate text-[16px] font-bold text-public-text">{event.name}</span>
      </div>
      <TimeSlotList
        dateLabel={dayLabel(effectiveDate, LOCALE)}
        slots={timeSlots}
        selected={effectiveSelected}
        onSelect={setSelected}
        onNext={goDetails}
        loading={!data}
        stickyHeader
        className={SLOT_LIST_TALL}
        emptyText={bt("page.noTimes")}
        aria-label={bt("page.selectTime")}
      />
    </div>
  ) : null;

  return (
    <div data-booking-flow="reschedule-calendar">
      <BookingCard side={side} times={times} expanded={Boolean(effectiveDate)} mobileView={effectiveDate ? phoneView : "main"} ribbon={p.ribbon}>
        <BookingMainSection className="pb-[32px]">
          <BookingPanelHeading>{bt("page.selectDateTime")}</BookingPanelHeading>
          {slotTaken && (
            <p role="alert" className="mt-4 rounded-[var(--radius-card)] border border-danger-soft bg-danger-soft px-4 py-3 text-[14px] font-semibold text-danger-text">
              {bt("slotTaken.title")} <span className="font-normal">{bt("slotTaken.body")}</span>
            </p>
          )}
        </BookingMainSection>
        <div className="relative px-3 min-[600px]:px-5">
          <MonthCalendar
            month={month}
            onMonthChange={changeMonth}
            selected={effectiveDate}
            onSelect={selectDate}
            availableDates={availableDates}
            today={todayDate}
            minMonth={todayMonth}
            maxMonth={maxMonth}
            weekStart={p.weekStart}
            locale={LOCALE}
            loading={slots.status !== "ready" && slots.status !== "error"}
          />
          {showNoTimes && (
            <div className="pointer-events-none absolute inset-x-0 top-14 bottom-0 flex items-center justify-center px-6">
              <div role="status" className="pointer-events-auto flex flex-col items-center gap-3 rounded-[var(--radius-card)] bg-white px-6 py-5 text-center shadow-[var(--shadow-pop)]">
                <p className="text-[15px] font-bold text-ink">{bt("page.noTimesInMonth", { month: monthName(month, LOCALE) })}</p>
                {nextAllowed && month < maxMonth && (
                  <Button type="button" variant="secondary" size="sm" onClick={() => changeMonth(nextMonthOf(month))} className="border-brand text-brand-strong">
                    {bt("page.viewNextMonth")}
                  </Button>
                )}
              </div>
            </div>
          )}
          {slots.status === "error" && (
            <div role="alert" className="mt-3 flex flex-wrap items-center justify-center gap-3 text-[14px] text-danger-text">
              <span>{bt("page.loadError")}</span>
              <Button type="button" variant="secondary" size="sm" onClick={slots.reload}>
                {bt("page.retry")}
              </Button>
            </div>
          )}
        </div>
        <BookingMainSection className="pt-[29px]">
          {event.lockedTimeZone ? (
            <div className="flex flex-col items-start gap-1" data-testid="locked-zone">
              <span className="text-[14px] leading-5 font-bold text-ink">{bt("page.timeZone")}</span>
              <LockedZone zone={event.lockedTimeZone} hour12={hour12} />
            </div>
          ) : zoneReady ? (
            <TimeZoneButton value={zone} onChange={changeZone} hour12={hour12} onHour12Change={changeFormat} label={bt("page.timeZone")} />
          ) : (
            <div className="flex flex-col gap-2" aria-hidden="true">
              <Skeleton width={80} height={14} />
              <Skeleton width={260} height={20} />
            </div>
          )}
        </BookingMainSection>
      </BookingCard>
    </div>
  );
}

function LockedZone({ zone, hour12 }: { zone: string; hour12: boolean }) {
  const now = useMinuteClock();
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[14px] leading-5 text-ink">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-current stroke-2">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" />
      </svg>
      <span>
        {friendlyZoneName(zone)}
        {now !== null && <span> ({currentLocalTime(zone, { hour12, locale: LOCALE, at: now })})</span>}
      </span>
    </span>
  );
}
