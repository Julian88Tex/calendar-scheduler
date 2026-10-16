// The public booking flow (SPEC BK-03 to BK-12, BK-16, BK-17, BK-19, BK-21, BK-24 to BK-26, BK-30, BK-33; owner
// reference .reference/booking-30min.png). One client component renders both steps, so moving between "Select a Date
// & Time" and "Enter Details" is instant and keeps the zone, the time format and the typed answers:
//
// - calendar step: details panel, month calendar (a month of slots per request in the invitee zone, next month
//   prefetched, jump to the first month with availability), the time zone dropdown with the "am/pm | 24h" toggle, and
//   the times column that widens the card ([time][Next] split); phones title the step "Select a Day" and get a separate
//   times view (back arrow, the weekday and date, the time zone picker, "Select a Time" and "Duration: {d}")
// - details step: the URL becomes /{slug}/{eventSlug}/{ISO start} (pushState, Next integrates it), the card keeps its
//   widened size, and the back button (top-left of the details panel, like Calendly) and the browser back button
//   return to the calendar with the same month and date; "Schedule Event" sends one request at a time and none once
//   a booking is made (createSubmitGuard in lib/form.ts), so a double click or a fast double tap never posts twice and
//   the navigation to the confirmation never flashes an error
// - footer: "Cookie settings" and "Privacy Policy" at the bottom of the details panel; phones show only "Cookie
//   settings" at the bottom of the card (docs/research/calendly-live-capture.md items 6 and 20)
// - URL state: ?month, &date, &duration and every other parameter (prefill, UTM, display, embed) persist (BK-08)
// - owners: banner, in-page troubleshoot mode and a link to the availability module's Troubleshoot view (BK-24)
// - editors: live preview of the unsaved draft with booking disabled (ET-29); embeds post calendly.* events (BK-25)
"use client";

import type { Route } from "next";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookingCard, BookingMainSection, BookingPanelHeading, PUBLIC_TEXT_TRACKING } from "@/components/public/booking-card";
import { BackButton } from "@/components/public/back-button";
import { PublicFooterLinks } from "@/components/public/public-footer-links";
import { TimeSlotList, type TimeSlot } from "@/components/public/time-slot-list";
import { Button } from "@/components/ui/button";
import { MonthCalendar } from "@/components/ui/month-calendar";
import { dayLabel, monthName } from "@/components/ui/month-calendar-utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { TimeZoneButton } from "@/components/ui/time-zone-select";
import { useMinuteClock } from "@/components/ui/use-minute-clock";
import { troubleshootHref } from "@/lib/availability/links";
import { fallbackCookieHeaders } from "@/lib/client/embed-cookie";
import { cn } from "@/lib/cn";
import { postEmbedEvent, postPageHeight } from "@/lib/embed-events";
import { formatDuration, formatMeetingWhen, formatTime, isoDateInZone } from "@/lib/time/format";
import { currentLocalTime, friendlyZoneName } from "@/lib/time/zones";
import { getViewerBusy } from "@/app/[handle]/[eventSlug]/actions";
import { DetailsForm } from "./details-form";
import { EventDetailsPanel } from "./event-details-panel";
import { BRAND_BUTTON } from "./form-parts";
import {
  buildBookingBody,
  createSubmitGuard,
  emptyValues,
  fieldOrder,
  interpretBookingResponse,
  validateForm,
  type FieldErrors,
  type FormContext,
  type FormValues,
  type SubmitOutcome,
} from "./lib/form";
import { longDate, weekdayTitle } from "./lib/display";
import { availableDatesOf, hasConflict, monthsBetween, nextMonthOf, type BusyRange, type MonthSlots, type SlotsRequest } from "./lib/slots";
import { FRIENDS_COPY, toneText } from "./lib/friends";
import { bt as baseText, type Vars } from "./lib/t";
import { createTurnstileRunner } from "./lib/turnstile";
import { calendarHref, detailsHref, landingForwardParams, parseDate, parseMonth, startFromPath, withCarried } from "./lib/url-state";
import { OwnerBanner, PreviewBanner } from "./owner-banner";
import type { BookingPageProps, BookingPrefillView, EventView } from "./types";
import {
  forgetAutofill,
  parseAutofill,
  rememberAutofill,
  rememberShowFree,
  rememberTimeFormat,
  useAutofillRaw,
  useBrowserZone,
  useShowFree,
  useTimeFormat,
  type AutofillData,
} from "./use-browser-env";
import { useMonthSlots } from "./use-month-slots";
import { applyDraft, usePreviewDraft } from "./use-preview-draft";
import type { VerifiedBooking } from "./verification-panel";

// Owner troubleshoot mode and the email verification step are rare: they load on demand to keep the public page's
// JavaScript under the GEN-07 budget.
function StepSpinner() {
  return (
    <div className="flex h-40 items-center justify-center">
      <Spinner />
    </div>
  );
}
const TroubleshootList = dynamic(() => import("./troubleshoot-list").then((m) => m.TroubleshootList), { ssr: false, loading: StepSpinner });
const VerificationPanel = dynamic(() => import("./verification-panel").then((m) => m.VerificationPanel), { ssr: false, loading: StepSpinner });

const LOCALE = "en-US";
/**
 * BK-18: the server refuses bookings sent within 2 seconds of the page render (signed timestamp). Autofill or prefill
 * links make that possible for people too, so a quick submit waits out the rest (plus a margin) behind the spinner
 * instead of failing.
 */
const MIN_FORM_WAIT_MS = 2_300;
const MAX_JUMP_MONTHS = 12;
const MAX_MONTHS_AHEAD = 24;
const EMBED_KEYS = ["embed_type", "embed_domain", "hide_gdpr_banner", "background_color", "text_color", "primary_color"];
/**
 * On tall desktop screens the card is 700px high (BookingCard); the times list then runs down to the card's bottom
 * edge like Calendly's (81px top padding, the 38px date row and 26px below it, 24px at the bottom) instead of stopping
 * at the 450px default.
 */
const SLOT_LIST_TALL = "min-[1000px]:[@media(min-height:860px)]:[&_ul]:max-h-[529px]";
/** Only web pages: the server already refuses other schemes; this keeps a bad value from ever reaching location. */
const WEB_URL = /^https?:\/\//i;

function initialValues(prefill: BookingPrefillView, event: EventView): FormValues {
  const v = emptyValues();
  v.name = prefill.name ?? [prefill.firstName, prefill.lastName].filter(Boolean).join(" ");
  v.firstName = prefill.firstName ?? "";
  v.lastName = prefill.lastName ?? "";
  if (event.nameFormat === "first_last" && !v.firstName && prefill.name) {
    const [first, ...rest] = prefill.name.split(/\s+/);
    v.firstName = first ?? "";
    v.lastName = rest.join(" ");
  }
  v.email = prefill.email ?? "";
  v.guests = event.allowGuests ? prefill.guests : [];
  v.showGuests = v.guests.length > 0;
  v.answers = { ...prefill.answers };
  if (prefill.location && event.locations.length === 1) {
    const kind = event.locations[0]!.kind;
    if (kind === "outbound_call" || kind === "ask_invitee") v.locationValue = prefill.location;
  }
  return v;
}

function withAutofill(v: FormValues, a: AutofillData | null): FormValues {
  if (!a) return v;
  const out = { ...v };
  if (!out.email && a.email) out.email = a.email;
  if (!out.name && a.name) out.name = a.name;
  if (!out.firstName && a.firstName) out.firstName = a.firstName;
  if (!out.lastName && a.lastName) out.lastName = a.lastName;
  return out;
}

/** Fields that still fail after an edit keep their (possibly server) message; fixed ones clear. */
function pruneErrors(prev: FieldErrors, values: FormValues, ctx: FormContext): FieldErrors {
  if (Object.keys(prev).length === 0) return prev;
  const still = validateForm(values, ctx);
  const out: FieldErrors = {};
  for (const [k, msg] of Object.entries(prev)) if (k in still || !(k in fieldsOf(ctx))) out[k] = msg;
  return out;
}

function fieldsOf(ctx: FormContext): Record<string, true> {
  return Object.fromEntries(fieldOrder(ctx).map((k) => [k, true]));
}

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

/** UTC bounds generously covering a local month in any zone (BK-33 busy lookup). */
function busyWindow(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return { start: new Date(Date.UTC(y, m - 1, 1) - 86_400_000).toISOString(), end: new Date(Date.UTC(y, m, 1) + 2 * 86_400_000).toISOString() };
}

export function BookingFlow(p: BookingPageProps) {
  // Every string of the flow reads through the page's tone (the friends link swaps some, lib/friends.ts).
  const bt = (key: string, vars?: Vars) => (p.tone ? toneText(p.tone, key, vars) : baseText(key, vars));
  const router = useRouter();
  const draft = usePreviewDraft(p.preview);
  const event = useMemo(() => applyDraft(p.event, draft), [p.event, draft]);
  const browserZone = useBrowserZone();
  const browserFormat = useTimeFormat();
  const showFreeStored = useShowFree();
  const autofillRaw = useAutofillRaw();
  const embed = p.embed.embed;
  const hideSide = p.embed.hideEventTypeDetails;

  // Zone and time format (BK-05, GEN-06).
  const [zoneChoice, setZoneChoice] = useState<string | null>(null);
  const [formatChoice, setFormatChoice] = useState<"12h" | "24h" | null>(null);
  const zone = event.lockedTimeZone ?? zoneChoice ?? browserZone ?? p.hostZone;
  const zoneReady = Boolean(event.lockedTimeZone || zoneChoice || browserZone);
  const timeFormat = formatChoice ?? browserFormat ?? "12h";
  const hour12 = timeFormat === "12h";

  // Steps and selection (BK-06, BK-08).
  const deepLinkUnavailable = p.mode === "details" && p.initial.startAvailable === false;
  const [step, setStep] = useState<"calendar" | "details">(p.mode === "details" && !deepLinkUnavailable ? "details" : "calendar");
  const [start, setStart] = useState<string | null>(p.initial.start);
  const [durationChoice, setDurationChoice] = useState<number>(p.initial.duration ?? p.event.defaultDuration);
  const duration = event.durations.includes(durationChoice) ? durationChoice : event.defaultDuration;
  // Editor previews show real availability for the saved settings (ET-29): a draft duration that is not saved yet
  // queries the saved default instead.
  const slotsDuration = p.preview && !p.event.durations.includes(duration) ? p.event.defaultDuration : duration;
  const [dateChoice, setDateChoice] = useState<{ value: string | null } | null>(null);
  const [monthChoice, setMonthChoice] = useState<string | null>(null);
  const [jumpMonth, setJumpMonth] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [phoneView, setPhoneView] = useState<"main" | "times">(p.initial.date ? "times" : "main");
  const [slotTaken, setSlotTaken] = useState(deepLinkUnavailable);
  const [troubleshoot, setTroubleshoot] = useState(false);
  const [showFreeChoice, setShowFreeChoice] = useState<boolean | null>(null);
  const showFree = p.viewer.mutual && (showFreeChoice ?? showFreeStored);
  const [previewNotice, setPreviewNotice] = useState(false);

  const todayDate = isoDateInZone(p.serverNow, zone);
  const todayMonth = todayDate.slice(0, 7);
  const derivedDate = p.initial.date ?? (deepLinkUnavailable && p.initial.start && zoneReady ? isoDateInZone(p.initial.start, zone) : null);
  const date = dateChoice ? dateChoice.value : derivedDate;
  const autoMonth = !p.initial.month && !p.initial.date && !deepLinkUnavailable;
  const rawMonth = monthChoice ?? p.initial.month ?? (date ? date.slice(0, 7) : null) ?? (autoMonth ? jumpMonth : null) ?? todayMonth;
  const month = rawMonth < todayMonth ? todayMonth : rawMonth;

  // Slots (BK-04, BK-31).
  const slotsReq: SlotsRequest | null =
    p.slotsTarget && zoneReady
      ? { target: p.slotsTarget, month, zone, duration: slotsDuration, troubleshoot, first: autoMonth && !monthChoice && !jumpMonth }
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
  const troubleshootDays = troubleshoot ? data?.troubleshoot?.days : undefined;
  // Troubleshoot mode opens every day of the month from today on (past days have nothing to fix).
  const availableDates = useMemo(
    () =>
      troubleshootDays
        ? Object.keys(troubleshootDays)
            .filter((d) => d.startsWith(`${month}-`) && d >= todayDate)
            .sort()
        : availableDatesOf(data, month),
    [troubleshootDays, data, month, todayDate],
  );
  const dateInMonth = date && date.slice(0, 7) === month ? date : null;
  const effectiveDate = dateInMonth && data && !availableDates.includes(dateInMonth) ? null : dateInMonth;
  const daySlots = useMemo(() => (effectiveDate && data ? (data.days[effectiveDate] ?? []) : []), [effectiveDate, data]);
  const effectiveSelected = selected && (daySlots.some((s) => s.start === selected) || troubleshoot) ? selected : null;

  // Prefetch the next month once this one is shown (BK-04).
  const prefetch = slots.prefetch;
  useEffect(() => {
    if (slotsReq && data) prefetch({ ...slotsReq, month: nextMonthOf(month), first: false });
    // slotsReq is rebuilt every render; its fields are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, month, zone, slotsDuration, troubleshoot, prefetch]);

  // Mutual availability (BK-33): the viewer's own busy times of the visible month.
  const [busyByMonth, setBusyByMonth] = useState<Record<string, BusyRange[] | "error">>({});
  const busyKey = `${month}`;
  const busy = showFree ? busyByMonth[busyKey] : undefined;
  useEffect(() => {
    if (!showFree || busyByMonth[busyKey] !== undefined) return;
    let cancelled = false;
    getViewerBusy(busyWindow(month))
      .then((r) => {
        if (!cancelled) setBusyByMonth((prev) => ({ ...prev, [busyKey]: r.ok ? r.data : "error" }));
      })
      .catch(() => {
        if (!cancelled) setBusyByMonth((prev) => ({ ...prev, [busyKey]: "error" }));
      });
    return () => {
      cancelled = true;
    };
  }, [showFree, busyKey, month, busyByMonth]);

  // Form state (BK-09 to BK-16).
  const ctx: FormContext = useMemo(
    () => ({ nameFormat: event.nameFormat, allowGuests: event.allowGuests, locations: event.locations, questions: event.questions }),
    [event],
  );
  const autofill = useMemo(() => (event.autofill && !p.prefill.email ? parseAutofill(autofillRaw) : null), [event.autofill, p.prefill.email, autofillRaw]);
  const [autofillDismissed, setAutofillDismissed] = useState(false);
  const [materialized, setMaterialized] = useState(false);
  const [rawValues, setValues] = useState<FormValues>(() => initialValues(p.prefill, p.event));
  const activeAutofill = autofillDismissed ? null : autofill;
  const values = materialized ? rawValues : withAutofill(rawValues, activeAutofill);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // One booking request at a time, and none after a booking was made (lib/form.ts createSubmitGuard).
  const [submitGuard] = useState(createSubmitGuard);
  const [verification, setVerification] = useState<{ reservationId: string; email: string } | null>(null);
  const [redirecting, setRedirecting] = useState<string | null>(null);
  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const mountedAt = useRef<number | null>(null);
  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);
  // BK-18: Cloudflare Turnstile when the instance configures it (the script loads with the details step only).
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstile = useMemo(() => (p.turnstileSiteKey && !p.preview ? createTurnstileRunner(p.turnstileSiteKey) : null), [p.turnstileSiteKey, p.preview]);
  useEffect(() => {
    if (turnstile && step === "details") turnstile.preload();
  }, [turnstile, step]);
  useEffect(() => () => turnstile?.dispose(), [turnstile]);

  const changeValues = (update: (v: FormValues) => FormValues) => {
    const wasMaterialized = materialized;
    const fill = activeAutofill;
    const next = update(wasMaterialized ? rawValues : withAutofill(rawValues, fill));
    setMaterialized(true);
    setValues((prev) => update(wasMaterialized ? prev : withAutofill(prev, fill)));
    setErrors((prev) => pruneErrors(prev, next, ctx));
    if (formError) setFormError(null);
  };

  // URL state (BK-08): replaceState keeps the address bar in sync; Next.js integrates native history calls.
  const urlState = { month, date: effectiveDate ?? (step === "details" ? date : null), duration, defaultDuration: event.defaultDuration };
  const currentUrl =
    step === "details" && start ? detailsHref(p.basePath, p.carry, start, urlState) : calendarHref(p.basePath, p.carry, urlState);
  useEffect(() => {
    if (!zoneReady) return;
    if (window.location.pathname + window.location.search === currentUrl) return;
    const state = (window.history.state ?? {}) as { kairosFromCalendar?: boolean };
    window.history.replaceState({ kairosStep: step, kairosFromCalendar: state.kairosFromCalendar === true }, "", currentUrl);
  }, [currentUrl, step, zoneReady]);

  // Browser back and forward between the steps.
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

  // Embeds (BK-25, API-15): page view and height messages for the parent window.
  useEffect(() => {
    if (!embed || p.preview) return;
    postEmbedEvent("calendly.event_type_viewed", {});
  }, [embed, p.preview]);
  useEffect(() => {
    if (!embed || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => postPageHeight());
    ro.observe(document.documentElement);
    postPageHeight();
    return () => ro.disconnect();
  }, [embed]);

  // Move focus to the step heading after a step change (keyboard and screen reader users, GEN-05).
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
    if (p.preview || !p.slotsTarget) {
      setPreviewNotice(true);
      return;
    }
    postEmbedEvent("calendly.date_and_time_selected", {});
    setStart(iso);
    setSlotTaken(false);
    setFormError(null);
    setVerification(null);
    setStep("details");
    const url = detailsHref(p.basePath, p.carry, iso, { month, date: effectiveDate, duration, defaultDuration: event.defaultDuration });
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

  // How the current submit started (see DetailsForm's onSubmit): a pointer press keeps focus on the button.
  const submitByPointer = useRef(false);
  /**
   * After a refused submit, brings the first invalid field into view. Keyboard submits also move focus there (GEN-05);
   * pointer submits leave focus on "Schedule Event", as Calendly does, so no field shows its focus ring (every error is
   * still announced through its role="alert" message).
   */
  const focusFirstError = (errs: FieldErrors) => {
    const first = fieldOrder(ctx).find((k) => errs[k]) ?? Object.keys(errs)[0];
    if (!first) return;
    const moveFocus = !submitByPointer.current;
    window.setTimeout(() => {
      const box = document.querySelector<HTMLElement>(`[data-field="${CSS.escape(first)}"]`);
      if (!box) return;
      if (moveFocus) {
        const focusable = box.querySelector<HTMLElement>("input:not([type=hidden]):not([tabindex='-1']), textarea, select, button[role=radio], button[role=checkbox], button");
        (focusable ?? box).focus();
      }
      const r = box.getBoundingClientRect();
      if (moveFocus || r.top < 0 || r.bottom > window.innerHeight) box.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 0);
  };

  const complete = (b: VerifiedBooking, v: FormValues) => {
    if (event.autofill) {
      rememberAutofill({ name: v.name.trim() || undefined, firstName: v.firstName.trim() || undefined, lastName: v.lastName.trim() || undefined, email: v.email.trim() });
    }
    const origin = window.location.origin;
    postEmbedEvent("calendly.event_scheduled", {
      event: { uri: `${origin}/api/v1/scheduled_events/${b.scheduledEventId ?? ""}` },
      invitee: { uri: `${origin}/api/v1/scheduled_events/${b.scheduledEventId ?? ""}/invitees/${b.inviteeId}` },
    });
    if (b.redirectUrl && WEB_URL.test(b.redirectUrl)) {
      setRedirecting(b.redirectUrl);
      try {
        (window.top ?? window).location.href = b.redirectUrl;
      } catch {
        window.open(b.redirectUrl, "_top");
      }
      return;
    }
    const carry = p.carry.filter(([k]) => EMBED_KEYS.includes(k));
    router.push(withCarried(`${p.confirmationBase}/${encodeURIComponent(b.inviteeId)}`, carry) as Route);
  };

  const handleOutcome = (o: SubmitOutcome, v: FormValues) => {
    switch (o.type) {
      case "ok":
        complete({ inviteeId: o.inviteeId, scheduledEventId: o.scheduledEventId, redirectUrl: o.redirectUrl }, v);
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
      case "link_used":
        setFormError(bt("errors.linkUsed"));
        setSubmitting(false);
        return;
      default:
        setFormError(o.message);
        setSubmitting(false);
    }
  };

  const submit = async (viaPointer: boolean) => {
    if (submitting || submitGuard.state !== "idle" || !start) return;
    submitByPointer.current = viaPointer;
    if (p.preview) {
      setFormError(bt("page.previewDisabled"));
      return;
    }
    const v = values;
    const errs = validateForm(v, ctx);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      setFormError(null);
      focusFirstError(errs);
      return;
    }
    // Taken synchronously, before anything is awaited: a second click or a double tap in flight sends nothing.
    if (!submitGuard.start()) return;
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    const key = `${p.slotsTarget}|${start}|${duration}|${v.email.trim().toLowerCase()}`;
    if (requestRef.current?.key !== key) requestRef.current = { key, id: newRequestId() };
    const early = MIN_FORM_WAIT_MS - (Date.now() - (mountedAt.current ?? 0));
    if (early > 0) await new Promise((resolve) => window.setTimeout(resolve, early));
    let turnstileToken: string | null = null;
    if (turnstile) {
      try {
        turnstileToken = await turnstile.token(turnstileRef.current);
      } catch {
        submitGuard.release();
        setFormError(bt("errors.botCheck"));
        setSubmitting(false);
        return;
      }
    }
    const body = buildBookingBody({
      target: p.target,
      start,
      durationMinutes: duration,
      values: v,
      ctx,
      collectMarketing: event.collectMarketingConsent,
      timezone: dataZone,
      detectedTimezone: browserZone,
      timeFormat,
      locale: LOCALE,
      tracking: p.prefill.tracking,
      routingFormSubmissionId: p.prefill.routingFormSubmissionId ?? null,
      clientRequestId: requestRef.current.id,
      formToken: p.formToken,
      honeypot: honeypotRef.current?.value ?? "",
      turnstileToken,
      embed,
    });
    let outcome: SubmitOutcome;
    try {
      const res = await fetch("/api/public/bookings", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...fallbackCookieHeaders([p.trustedDeviceCookie]) },
        body: JSON.stringify(body),
        credentials: "same-origin",
      });
      outcome = interpretBookingResponse(res.status, await res.json().catch(() => null));
    } catch {
      outcome = { type: "error", message: bt("errors.network") };
    }
    // After a booking the page is navigating to the confirmation: nothing may show an error any more.
    if (!submitGuard.finish(outcome)) return;
    handleOutcome(outcome, v);
  };

  // Rendering helpers. Like Calendly, the card footer has no "Report abuse" link: on this single-owner instance the
  // operator mailbox is the host's own (docs/SCOPE.md, live capture item 6). Phones show only "Cookie settings"; that
  // copy leaves the cookie-settings window event to the panel's copy so one event opens one dialog.
  const footer = <PublicFooterLinks showPrivacyPolicy privacyUrl={p.privacyUrl} />;
  const phoneFooter = (align: "center" | "start") => (
    <PublicFooterLinks
      showPrivacyPolicy={false}
      listenForOpenEvent={false}
      className={cn("px-4", align === "center" ? "justify-center pt-[75px] pb-[22px]" : "justify-start pt-2 pb-[27px]")}
    />
  );
  const lockedZoneName = event.lockedTimeZone ? friendlyZoneName(event.lockedTimeZone) : null;
  const end = start ? new Date(Date.parse(start) + duration * 60_000).toISOString() : null;
  const whenText = start && end && zoneReady ? formatMeetingWhen(start, end, dataZone, LOCALE, hour12) : null;
  const landingBack =
    step === "calendar" && p.initial.back && p.landingPath
      ? { href: withCarried(p.landingPath, landingForwardParams(new URLSearchParams(p.carry))), label: bt("page.backToLanding") }
      : null;
  // Details step: the back arrow sits at the top-left of the details panel on every screen size (live capture item 1).
  const calendarBack = step === "details" ? { onClick: backToCalendar, label: bt("page.backToCalendar") } : null;
  const side = (
    <EventDetailsPanel
      event={event}
      host={p.host}
      brandHeader={p.brandHeader}
      duration={duration}
      onDurationChange={step === "calendar" ? changeDuration : undefined}
      when={step === "details" && whenText ? { text: whenText, zoneName: friendlyZoneName(dataZone) } : null}
      lockedZoneName={lockedZoneName}
      back={calendarBack ?? landingBack}
      footer={footer}
      footerClassName="max-[599px]:hidden"
      step={step}
      namePlaceholder={p.preview ? bt("preview.untitled") : undefined}
    />
  );

  const banners = (
    <>
      {p.preview && <PreviewBanner canonicalUrl={p.canonicalUrl} hasPage={Boolean(p.slotsTarget)} />}
      {p.viewer.isHost && !p.preview && !embed && (
        <OwnerBanner
          email={p.viewer.email}
          troubleshooting={troubleshoot}
          onToggleTroubleshoot={() => {
            setTroubleshoot((t) => !t);
            setSelected(null);
          }}
          editUrl={p.viewer.editUrl}
          canonicalUrl={p.canonicalUrl}
          inactive={!event.active}
        />
      )}
    </>
  );

  if (step === "details" && start) {
    return (
      <div data-booking-flow="details" data-tone={p.tone} className={PUBLIC_TEXT_TRACKING}>
        {banners}
        <BookingCard side={side} wide ribbon={p.ribbon} embed={embed} hideSide={hideSide} phoneFooter={phoneFooter("start")}>
          {/* 25px below the form: the button ends 26px above the card's bottom border, as Calendly's does. */}
          <BookingMainSection className="pt-6 pb-[25px] max-[599px]:px-[15px] min-[600px]:px-[30px]">
            {hideSide && (
              // Without the details panel the back arrow stays above the heading.
              <div className="mb-5">
                <BackButton onClick={backToCalendar} label={bt("page.backToCalendar")} />
              </div>
            )}
            <BookingPanelHeading as={hideSide ? "h1" : "h2"}>
              <span ref={detailsHeadingRef} tabIndex={-1} className="outline-none">
                {bt("details.title")}
              </span>
            </BookingPanelHeading>
            {p.tone === "friends" && (
              <p className="mt-2 mb-4 text-[15px] leading-[22px] text-ink-2" data-testid="friends-details-intro">
                {FRIENDS_COPY.detailsIntro}
              </p>
            )}
            {hideSide && whenText && (
              <p className="mt-2 text-[14px] font-semibold text-ink-2" data-testid="details-when">
                {whenText}, {friendlyZoneName(dataZone)}
              </p>
            )}
            {slotTaken && (
              <div role="alert" className="mt-5 flex flex-col gap-3 rounded-[var(--radius-card)] border border-danger-soft bg-danger-soft px-4 py-3 text-danger-text min-[600px]:flex-row min-[600px]:items-center min-[600px]:justify-between">
                <div className="flex flex-col gap-0.5">
                  <p className="text-[14px] font-bold">{bt("slotTaken.title")}</p>
                  <p className="text-[13px]">{bt("slotTaken.body")}</p>
                </div>
                <Button type="button" size="sm" onClick={viewTimes} className={cn(BRAND_BUTTON, "shrink-0")}>
                  {bt("slotTaken.viewTimes")}
                </Button>
              </div>
            )}
            <div className={redirecting || verification ? "mt-6" : hideSide && whenText ? "mt-5" : "mt-[3px]"}>
              {redirecting ? (
                <div role="status" className="flex flex-col items-start gap-3" data-testid="redirecting">
                  <p className="text-[18px] font-bold text-public-text">{bt("details.redirecting")}</p>
                  <p className="text-[14px] text-ink-2">{bt("details.redirectNotice")}</p>
                  <a href={redirecting} target="_top" rel="noopener" className="text-[14px] font-semibold text-brand-strong hover:underline">
                    {bt("details.redirectManual")}
                  </a>
                </div>
              ) : verification ? (
                <VerificationPanel
                  reservationId={verification.reservationId}
                  email={verification.email}
                  embed={embed}
                  trustedDeviceCookie={p.trustedDeviceCookie}
                  onVerified={(b) => complete(b, values)}
                  onSlotTaken={viewTimes}
                  onChangeEmail={() => setVerification(null)}
                />
              ) : (
                <DetailsForm
                  ctx={ctx}
                  values={values}
                  onChange={changeValues}
                  errors={errors}
                  formError={formError}
                  submitting={submitting}
                  onSubmit={(viaPointer) => void submit(viaPointer)}
                  collectMarketing={event.collectMarketingConsent}
                  honeypotName={p.honeypotName}
                  honeypotRef={honeypotRef}
                  turnstileRef={turnstile ? turnstileRef : undefined}
                  appName={p.appName}
                  termsUrl={p.termsUrl}
                  privacyUrl={p.privacyUrl}
                  autofilledName={activeAutofill && values.email === activeAutofill.email ? (activeAutofill.name ?? activeAutofill.firstName ?? null) : null}
                  onNotYou={() => {
                    forgetAutofill();
                    setAutofillDismissed(true);
                    setMaterialized(true);
                    setValues((v) => ({ ...v, name: "", firstName: "", lastName: "", email: "" }));
                  }}
                  disabledNote={p.preview ? bt("page.previewDisabled") : null}
                  submitLabel={bt("details.schedule")}
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
  const busyRanges = Array.isArray(busy) ? busy : [];
  const timeSlots: TimeSlot[] = daySlots.map((s) => {
    const conflict = showFree && busyRanges.length > 0 && hasConflict(s.start, duration, busyRanges);
    const spots = event.showRemainingSpots ? (s.remaining === 1 ? bt("page.spotLeft") : bt("page.spotsLeft", { count: s.remaining })) : null;
    return { value: s.start, label: fmt(s.start), detail: conflict ? bt("mutual.conflict") : spots };
  });
  const candidates = effectiveDate && troubleshootDays ? (troubleshootDays[effectiveDate] ?? []) : [];
  const nextAllowed = !data?.windowEnd || Date.parse(data.windowEnd) > Date.parse(`${nextMonthOf(month)}-01T00:00:00Z`) - 14 * 3_600_000;
  const showNoTimes = Boolean(p.slotsTarget) && slots.status === "ready" && availableDates.length === 0 && !troubleshoot;
  const maxMonth = (() => {
    const [y, m] = todayMonth.split("-").map(Number) as [number, number];
    const d = new Date(Date.UTC(y, m - 1 + MAX_MONTHS_AHEAD, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  })();
  // The availability module's Troubleshoot view for the day on screen (host only, BK-24, SCOPE priority 4).
  const troubleshootDayUrl = p.troubleshootEventTypeId
    ? troubleshootHref({ eventTypeId: p.troubleshootEventTypeId, date: effectiveDate ?? todayDate, durationMinutes: duration !== event.defaultDuration ? duration : null })
    : null;

  const zonePicker = (className?: string) =>
    event.lockedTimeZone ? (
      <div className={cn("flex flex-col items-start gap-1", className)} data-testid="locked-zone">
        <span className="text-[14px] leading-5 font-[640] text-ink">{bt("page.timeZone")}</span>
        <LockedZone zone={event.lockedTimeZone} hour12={hour12} />
      </div>
    ) : zoneReady ? (
      <TimeZoneButton value={zone} onChange={changeZone} hour12={hour12} onHour12Change={changeFormat} label={bt("page.timeZone")} className={className} />
    ) : (
      <div className={cn("flex flex-col gap-2", className)} aria-hidden="true">
        <Skeleton width={80} height={14} />
        <Skeleton width={260} height={20} />
      </div>
    );

  const times = effectiveDate ? (
    <div className="flex min-w-0 flex-col">
      {/* Phones: Calendly's times screen header (live capture item 20). */}
      <div className="relative min-[600px]:hidden" data-testid="phone-times-header">
        <div className="absolute top-[17px] left-[17px]">
          <BackButton onClick={() => setPhoneView("main")} label={bt("page.backToCalendar")} />
        </div>
        <div className="border-b border-line px-[17px] pt-[23px] pb-[25px] text-center">
          <h2 className="px-12 text-[22px] leading-7 font-bold text-public-text">{weekdayTitle(effectiveDate, LOCALE)}</h2>
          <p className="mt-[5px] text-[14px] leading-5 text-public-text">{longDate(effectiveDate, LOCALE)}</p>
          <div className="mt-[10px] flex justify-center">{zonePicker("max-w-full")}</div>
        </div>
        <div className="px-[17px] pt-4 text-center">
          <p className="text-[21px] leading-7 font-bold text-public-text">{bt("page.selectTimeHeading")}</p>
          <p className="mt-3.5 text-[14px] leading-5 text-public-text">{bt("page.durationLine", { duration: formatDuration(duration) })}</p>
        </div>
      </div>
      {troubleshoot ? (
        <TroubleshootList
          dateLabel={dayLabel(effectiveDate, LOCALE)}
          candidates={candidates}
          formatTime={fmt}
          selected={effectiveSelected}
          onSelect={setSelected}
          onNext={goDetails}
          fullUrl={troubleshootDayUrl}
        />
      ) : (
        <TimeSlotList
          dateLabel={dayLabel(effectiveDate, LOCALE)}
          slots={timeSlots}
          selected={effectiveSelected}
          onSelect={setSelected}
          onNext={goDetails}
          loading={!data}
          stickyHeader
          dateLabelClassName="max-[599px]:hidden"
          className={cn(SLOT_LIST_TALL, "max-[599px]:pt-[21px]")}
          emptyText={bt("page.noTimes")}
          aria-label={bt("page.selectTime")}
        />
      )}
      {previewNotice && (
        <p role="status" className="px-5 pb-5 text-[13px] text-ink-2 min-[1000px]:pr-[18px] min-[1000px]:pl-2.5">
          {bt("page.previewDisabled")}
        </p>
      )}
    </div>
  ) : null;

  return (
    <div data-booking-flow="calendar" data-tone={p.tone} className={PUBLIC_TEXT_TRACKING}>
      {banners}
      <BookingCard
        side={side}
        times={times}
        expanded={Boolean(effectiveDate)}
        mobileView={effectiveDate ? phoneView : "main"}
        ribbon={p.ribbon}
        embed={embed}
        hideSide={hideSide}
        phoneFooter={phoneFooter("center")}
      >
        <BookingMainSection className="pb-[30px] max-[599px]:pt-[26px] max-[599px]:pb-5">
          <BookingPanelHeading as={hideSide ? "h1" : "h2"} className="max-[599px]:text-center">
            {/* Phones title the step "Select a Day" (the times come on their own screen). */}
            <span className="max-[599px]:hidden">{bt("page.selectDateTime")}</span>
            <span className="min-[600px]:hidden">{bt("page.selectDay")}</span>
          </BookingPanelHeading>
          {slotTaken && (
            <p role="alert" className="mt-4 rounded-[var(--radius-card)] border border-danger-soft bg-danger-soft px-4 py-3 text-[14px] font-semibold text-danger-text">
              {bt("slotTaken.title")} <span className="font-normal">{bt("slotTaken.body")}</span>
            </p>
          )}
          {p.viewer.mutual && (
            <div className="mt-4 flex flex-col gap-1.5">
              <Switch
                label={bt("mutual.toggle")}
                checked={showFree}
                onCheckedChange={(on) => {
                  setShowFreeChoice(on);
                  rememberShowFree(on);
                }}
              />
              {showFree && (
                <p className="text-[12px] text-ink-2" aria-live="polite">
                  {busy === "error" ? bt("mutual.loadError") : bt("mutual.legend")}
                </p>
              )}
            </div>
          )}
        </BookingMainSection>
        {/*
          Desktop: Calendly's grid sits 19.25px in from both panel edges, and 18.5px from the left and 20px from the
          right once the times column opens.
        */}
        <div
          className={cn(
            "relative mx-auto w-full max-w-[316px] min-[600px]:max-w-none min-[600px]:px-5",
            effectiveDate ? "min-[1000px]:pl-[18.5px]" : "min-[1000px]:px-[19.25px]",
          )}
        >
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
            loading={Boolean(p.slotsTarget) && slots.status !== "ready" && slots.status !== "error"}
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
        <BookingMainSection className="pt-[28px] max-[599px]:px-[35px] max-[599px]:pt-[21px]">
          {zonePicker()}
          {troubleshootDayUrl && (
            <a href={troubleshootDayUrl} className="mt-4 inline-block text-[14px] font-semibold text-brand-strong hover:underline" data-testid="troubleshoot-link">
              {bt("page.troubleshoot")}
            </a>
          )}
        </BookingMainSection>
      </BookingCard>
    </div>
  );
}

function LockedZone({ zone, hour12 }: { zone: string; hour12: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[14px] leading-5 text-ink">
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4 fill-none stroke-current stroke-2">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20" />
      </svg>
      <ZoneWithTime zone={zone} hour12={hour12} />
    </span>
  );
}

function ZoneWithTime({ zone, hour12 }: { zone: string; hour12: boolean }) {
  const now = useMinuteClock();
  return (
    <span>
      {friendlyZoneName(zone)}
      {now !== null && <span> ({currentLocalTime(zone, { hour12, locale: LOCALE, at: now })})</span>}
    </span>
  );
}
