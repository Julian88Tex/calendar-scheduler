// Reschedule page data (SPEC CR-03, CR-08, SCH-24, BK-07, BK-08, BK-09). Server only.
//
// On top of the shared change page (chain redirect, refusals, meeting summary, branding), a reschedulable invitee gets
// the booking flow of the same event type with its CURRENT settings (booking-pages' loadBookingPage builds the event
// view, the host header and the branding exactly like the public booking page), plus:
//   - the "Former Time" of the meeting being moved
//   - the details form prefilled from the stored invitee (name, email, guests, location choice, answers)
//   - the duration picker on the original duration while it is still offered (BK-07)
//   - the slots request flagged with the invitee (SCH-24: the meeting being moved does not block itself); a rebook
//     after "Share new times to meet" (CR-08) starts from a canceled meeting, which blocks nothing
//   - the deep link check of /reschedulings/{id}/{start} with the same exclusion (BK-08)
//   - the cancellation policy of the meeting (CR-05: shown on the cancel and reschedule pages)
import "server-only";
import { getAvailability, loadEventType, type BookingTarget } from "@/lib/booking";
import { loadBookingPage } from "@/components/booking/server/booking-page";
import { parseDate, parseDuration, parseMonth, param, type SearchParamsInput } from "@/components/booking/lib/url-state";
import lifecycleMessages from "@/lib/i18n/messages/en/lifecycle";
import { log } from "@/lib/logger";
import { now } from "@/lib/time/now";
import { isValidTimeZone } from "@/lib/time/zones";
import { changePagePath } from "../lib/state";
import { initialDuration, rescheduleFormValues } from "../lib/prefill";
import type { RescheduleFlowProps } from "../reschedule-types";
import type { ChangePageView } from "../types";
import { loadChangePage } from "./change-page";

const DAY_MS = 86_400_000;

export type ReschedulePageResult =
  | { state: "not_found" }
  | { state: "redirect"; inviteeId: string }
  | { state: "blocked"; view: ChangePageView }
  | { state: "flow"; view: ChangePageView; flow: RescheduleFlowProps };

/** True when the start is a bookable slot for this reschedule right now (errors count as bookable: submit rechecks). */
async function startIsBookable(target: BookingTarget, start: Date, durationMinutes: number, ignoreInviteeId: string | undefined): Promise<boolean> {
  try {
    const r = await getAvailability({
      target,
      start: new Date(start.getTime() - DAY_MS),
      end: new Date(start.getTime() + DAY_MS),
      durationMinutes,
      now: now(),
      ignoreInviteeId,
      freshness: "page",
    });
    return r.slots.some((s) => s.start === start.getTime());
  } catch (e) {
    log.warn("lifecycle.reschedule_deep_link_check_failed", { error: e });
    return true;
  }
}

export type LoadReschedulePageInput = {
  inviteeId: string;
  mode: "calendar" | "details";
  start?: Date | null;
  searchParams: SearchParamsInput;
};

export async function loadReschedulePage(input: LoadReschedulePageInput): Promise<ReschedulePageResult> {
  const r = await loadChangePage(input.inviteeId, "reschedule");
  if (r.state !== "ok") return r;
  const { view, ctx } = r;
  if (view.blocked) return { state: "blocked", view };
  const blocked = (): ReschedulePageResult => ({
    state: "blocked",
    view: { ...view, blocked: { reason: "not_reschedulable", title: lifecycleMessages.changes.notReschedulable, body: null, contact: null, cancelAvailable: ctx.cancelBlock === null } },
  });

  const eventType = await loadEventType(ctx.invitee.eventTypeId);
  if (!eventType) return blocked();
  const target: BookingTarget = { kind: "event_type", eventType };
  const basePath = changePagePath("reschedule", ctx.invitee.id);
  const sp = input.searchParams;
  const page = await loadBookingPage({ target, basePath, landingPath: null, searchParams: {}, mode: "calendar" });
  if (page.state !== "ok") return blocked();
  const p = page.props;

  const m = ctx.meeting.meeting;
  const inv = ctx.invitee;
  const ignoreInviteeId = view.rebook ? undefined : inv.id;
  const original = initialDuration(m.durationMinutes, p.event.durations, p.event.defaultDuration);
  const duration = parseDuration(param(sp, "duration"), p.event.durations) ?? original;
  const start = input.mode === "details" && input.start ? input.start : null;
  const startAvailable = start ? await startIsBookable(target, start, duration, ignoreInviteeId) : null;
  const guests = ctx.meeting.guests.filter((g) => g.inviteeId === inv.id && (view.rebook || !g.canceledAt)).map((g) => g.email);
  const formCtx = { nameFormat: p.event.nameFormat, allowGuests: p.event.allowGuests, locations: p.event.locations, questions: p.event.questions };

  const flow: RescheduleFlowProps = {
    inviteeId: inv.id,
    basePath,
    cancelPath: ctx.cancelBlock === null ? changePagePath("cancel", inv.id) : null,
    rebook: view.rebook,
    rescheduleTarget: ignoreInviteeId ?? null,
    slotsTarget: p.slotsTarget ?? eventType.id,
    event: p.event,
    host: p.host,
    hostName: view.summary.hostName,
    brandHeader: p.brandHeader,
    ribbon: p.ribbon,
    former: { start: m.startAt.toISOString(), end: m.endAt.toISOString() },
    originalDuration: original,
    initial: {
      mode: input.mode === "details" && start ? "details" : "calendar",
      month: parseMonth(param(sp, "month")),
      date: parseDate(param(sp, "date")),
      start: start ? start.toISOString() : null,
      startAvailable,
      duration,
    },
    values: rescheduleFormValues(
      {
        name: inv.name,
        firstName: inv.firstName,
        lastName: inv.lastName,
        email: inv.email,
        marketingConsent: inv.marketingConsent,
        locationAnswer: inv.locationAnswer ? { configId: inv.locationAnswer.configId, value: inv.locationAnswer.value ?? null } : null,
        questionsAndAnswers: inv.questionsAndAnswers ?? null,
      },
      guests,
      formCtx,
    ),
    cancellationPolicy: view.cancellationPolicy,
    inviteeZone: isValidTimeZone(inv.timezone) ? inv.timezone : null,
    inviteeTimeFormat: inv.timeFormat === "24h" || inv.timeFormat === "12h" ? inv.timeFormat : null,
    serverNow: now().getTime(),
    hostZone: p.hostZone,
    weekStart: p.weekStart,
    operatorEmail: p.operatorEmail,
    privacyUrl: p.privacyUrl,
    termsUrl: p.termsUrl,
    appName: p.appName,
    collectMarketing: p.event.collectMarketingConsent,
    trustedDeviceCookie: p.trustedDeviceCookie,
  };
  return { state: "flow", view, flow };
}
