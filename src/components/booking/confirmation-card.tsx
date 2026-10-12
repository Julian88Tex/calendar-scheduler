// The confirmation page card (SPEC BK-20, BK-22, CR-01; walkthrough 11.5): host avatar, green check and "You are
// scheduled" ("You are rescheduled"), the CAL-12 notification sentence, "Open Invitation" when the provider returned a
// link, the summary box (event, host, time in the invitee's zone and format, zone, location), "Add to calendar"
// (Google, Outlook.com, Office 365, Apple / iCal), cancel and reschedule links, "Schedule another event" and custom
// links, and the optional "Powered by" footer. Canceled bookings show the same summary struck through. Server
// component.
import { CalendarDays, Check, ExternalLink, Globe, User, XCircle } from "lucide-react";
import type * as React from "react";
import type { Route } from "next";
import Link from "next/link";
import { PublicCard } from "@/components/public/public-card";
import { PublicFooterLinks } from "@/components/public/public-footer-links";
import { Avatar } from "@/components/ui/avatar";
import { buttonClassName } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { bt } from "./lib/t";
import { LocationGlyph } from "./location-icon";
import type { ConfirmationView } from "./server/confirmation";

function Row({ icon, children, strike }: { icon: React.ReactNode; children: React.ReactNode; strike?: boolean }) {
  return (
    <div className="flex min-w-0 items-start gap-3 text-[15px] leading-[22px] font-semibold text-ink-2">
      <span aria-hidden="true" className="mt-px inline-flex shrink-0 text-navy [&_svg]:size-5">
        {icon}
      </span>
      <div className={cn("min-w-0 break-words", strike && "line-through")}>{children}</div>
    </div>
  );
}

const PILL = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-line px-4 text-[14px] font-semibold text-brand-strong transition-colors hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export function ConfirmationCard({ v, embed }: { v: ConfirmationView; embed?: boolean }) {
  const canceled = v.status === "canceled";
  const sentence =
    v.mode === "calendar_invitation" ? bt("confirmation.sentTo") : bt("confirmation.sentEmail");
  return (
    <PublicCard width="narrow" ribbon={v.ribbon} embed={embed}>
      <div className="flex flex-col items-center px-6 pt-10 pb-2 text-center min-[600px]:px-10" data-testid="confirmation">
        {v.hostAvatar && <Avatar src={v.hostAvatar.src} name={v.hostAvatar.name} alt="" size={64} className="mb-5" />}
        <h1 className="flex items-center justify-center gap-2.5 text-[24px] leading-8 font-bold text-public-text">
          {canceled ? (
            <XCircle aria-hidden="true" className="size-7 shrink-0 text-danger" />
          ) : (
            <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-success text-white">
              <Check className="size-4.5" strokeWidth={3} />
            </span>
          )}
          {canceled ? bt("confirmation.canceledTitle") : v.rescheduled ? bt("confirmation.titleRescheduled") : bt("confirmation.title")}
        </h1>
        {!canceled && v.scheduledWith && (
          <p className="mt-3 text-[16px] leading-6 text-public-text">
            {v.rescheduled ? bt("confirmation.withHostRescheduled", { name: v.scheduledWith }) : bt("confirmation.withHost", { name: v.scheduledWith })}
          </p>
        )}
        <p className="mt-2 max-w-[460px] text-[14px] leading-[22px] text-ink-2">{canceled ? bt("confirmation.canceledBody") : sentence}</p>
        {!canceled && v.invitationUrl && (
          <a href={v.invitationUrl} target="_blank" rel="noopener noreferrer" className={cn(PILL, "mt-5")} data-testid="open-invitation">
            {bt("confirmation.openInvitation")}
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        )}
      </div>

      <section aria-label={bt("confirmation.summary")} className="mx-6 mt-6 flex flex-col gap-3 rounded-[var(--radius-card)] border border-line p-6 min-[600px]:mx-10">
        <h2 className={cn("text-[18px] leading-6 font-bold text-public-text", canceled && "line-through")}>{v.eventName}</h2>
        {v.hostNames.length > 0 && (
          <Row icon={<User />} strike={canceled}>
            <span className="sr-only">{bt("confirmation.host")}: </span>
            {v.hostNames.join(", ")}
          </Row>
        )}
        <Row icon={<CalendarDays />} strike={canceled}>
          <span className="sr-only">{bt("confirmation.when")}: </span>
          <span data-testid="confirmation-when">{v.whenText}</span>
        </Row>
        <Row icon={<Globe />} strike={canceled}>
          <span className="sr-only">{bt("confirmation.zone")}: </span>
          <span data-testid="confirmation-zone">{v.zoneName}</span>
        </Row>
        {v.location && (
          <Row icon={<LocationGlyph icon={v.location.icon} />} strike={canceled}>
            {v.location.href && !canceled ? (
              <a href={v.location.href} target="_blank" rel="noopener noreferrer" className="text-brand-strong underline">
                {v.location.text}
              </a>
            ) : (
              <span className="whitespace-pre-line">{v.location.text}</span>
            )}
            {v.location.detail && <span className="block font-normal break-all whitespace-pre-line">{v.location.detail}</span>}
          </Row>
        )}
        {v.guests.length > 0 && (
          <p className={cn("text-[13px] text-ink-2", canceled && "line-through")}>
            {bt("confirmation.guests")}: {v.guests.join(", ")}
          </p>
        )}
        {canceled && v.canceled?.reason && <p className="text-[14px] text-ink">{bt("confirmation.reason", { reason: v.canceled.reason })}</p>}
      </section>

      <div className="flex flex-col items-center gap-6 px-6 pt-8 pb-8 text-center min-[600px]:px-10">
        {!canceled && (
          <div className="flex flex-col items-center gap-3">
            <h2 className="text-[14px] font-bold text-public-text">{bt("confirmation.addToCalendar")}</h2>
            <ul className="flex flex-wrap justify-center gap-2" data-testid="add-to-calendar">
              {v.calendarLinks.map((l) => (
                <li key={l.id}>
                  <a
                    href={l.url}
                    className={PILL}
                    {...(l.id === "ical" ? { download: "invite.ics" } : { target: "_blank", rel: "noopener noreferrer" })}
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {v.manage && (v.manage.cancel || v.manage.reschedule) && (
          <div className="flex flex-col items-center gap-1.5 text-[14px]" data-testid="manage-links">
            <p className="text-ink-2">{bt("confirmation.needChanges")}</p>
            <p className="flex items-center gap-4">
              {v.manage.reschedule && (
                <Link href={v.manage.reschedule as Route} className="font-semibold text-brand-strong hover:underline">
                  {bt("confirmation.reschedule")}
                </Link>
              )}
              {v.manage.cancel && (
                <Link href={v.manage.cancel as Route} className="font-semibold text-brand-strong hover:underline">
                  {bt("confirmation.cancel")}
                </Link>
              )}
            </p>
          </div>
        )}
        {(v.scheduleAnother || v.customLinks.length > 0) && (
          <ul className="flex flex-col items-center gap-2 text-[14px]">
            {v.scheduleAnother && (
              <li>
                <Link href={v.scheduleAnother.href as Route} className={cn(buttonClassName({ variant: "tertiary" }), "text-brand-strong")} data-testid="schedule-another">
                  {v.scheduleAnother.label}
                </Link>
              </li>
            )}
            {v.customLinks.map((l, i) => (
              <li key={i}>
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-strong hover:underline">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col items-center gap-3 border-t border-line px-6 py-5">
        <PublicFooterLinks operatorEmail={v.operatorEmail} showPrivacyPolicy={Boolean(v.privacyUrl)} privacyUrl={v.privacyUrl} />
        {v.ribbon && <p className="text-[12px] text-ink-2">{bt("confirmation.poweredBy", { appName: v.appName })}</p>}
      </div>
    </PublicCard>
  );
}
