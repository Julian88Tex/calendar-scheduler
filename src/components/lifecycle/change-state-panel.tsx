// The main panel of a refused change (SPEC CR-02, CR-03, SCH-23): "This event has already been canceled.", "This event
// has already occurred.", the cutoff sentence with the host's email, or "This event can no longer be rescheduled."
// with the reason and, while canceling still works, a link to the cancel page; then "Schedule another event". A
// meeting the host canceled with "Share new times to meet" (CR-08) also offers "Pick a new time" on the cancel page.
// Server and client safe.
import type { Route } from "next";
import Link from "next/link";
import { BookingMainSection, BookingPanelHeading } from "@/components/public/booking-card";
import { buttonClassName } from "@/components/ui/button";
import { Illustration } from "@/components/ui/illustration";
import { cn } from "@/lib/cn";
import { BRAND_PILL } from "./lib/brand";
import type { BlockedCopy } from "./lib/state";
import { lt } from "./lib/t";

export type ChangeStatePanelProps = {
  copy: BlockedCopy;
  /** The cancel page of this invitee (shown when copy.cancelAvailable). */
  cancelHref?: string | null;
  scheduleAnotherHref?: string | null;
  /** CR-08: the host asked for a new time; the reschedule page of this invitee books again. */
  rebook?: { href: string; hostName: string } | null;
};

export function ChangeStatePanel({ copy, cancelHref, scheduleAnotherHref, rebook }: ChangeStatePanelProps) {
  return (
    <BookingMainSection>
      <div data-testid={`change-blocked-${copy.reason}`} className="flex flex-col items-start gap-4">
        <Illustration name="calendar" />
        <BookingPanelHeading>{copy.title}</BookingPanelHeading>
        {copy.body && <p className="text-[15px] leading-[22px] text-ink-2">{copy.body}</p>}
        {copy.contact && (
          <p className="text-[15px] leading-[22px] text-ink-2">
            <a href={`mailto:${copy.contact.email}`} className="font-semibold text-brand-strong hover:underline">
              {lt("states.contactHost", { hostName: copy.contact.name || copy.contact.email })}
            </a>{" "}
            <span className="break-all">({copy.contact.email})</span>
          </p>
        )}
        {copy.cancelAvailable && cancelHref && (
          <p className="text-[15px] leading-[22px] text-ink-2">
            {lt("reschedule.cancelInstead")}{" "}
            <Link href={cancelHref as Route} className="font-semibold text-brand-strong hover:underline">
              {lt("reschedule.cancelLink")}
            </Link>
          </p>
        )}
        {rebook && (
          <>
            <p className="text-[15px] leading-[22px] text-ink-2">{lt("cancel.rebookNotice", { hostName: rebook.hostName })}</p>
            <Link
              href={rebook.href as Route}
              className={cn(buttonClassName({ size: "lg" }), BRAND_PILL, "mt-2")}
              data-testid="pick-new-time"
            >
              {lt("cancel.pickNewTime")}
            </Link>
          </>
        )}
        {scheduleAnotherHref && !rebook && (
          <Link
            href={scheduleAnotherHref as Route}
            className={cn(buttonClassName({ variant: "secondary", size: "lg" }), "mt-2 border-brand text-brand-strong")}
            data-testid="schedule-another"
          >
            {lt("states.scheduleAnother")}
          </Link>
        )}
      </div>
    </BookingMainSection>
  );
}
