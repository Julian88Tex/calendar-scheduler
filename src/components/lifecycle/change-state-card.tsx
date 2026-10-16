// A refused change on its own page (SPEC CR-02, CR-03, SCH-23): the two-panel card with the meeting summary on the
// left and the state panel on the right ("This event can no longer be rescheduled." with "Schedule another event",
// the cancel link while canceling still works, the host's email inside the cutoff). Server and client safe.
import { BookingCard } from "@/components/public/booking-card";
import { PublicFooterLinks } from "@/components/public/public-footer-links";
import { ChangeStatePanel } from "./change-state-panel";
import { changePagePath } from "./lib/state";
import { MeetingSummaryPanel } from "./meeting-summary-panel";
import type { ChangePageView } from "./types";

export function ChangeStateCard({ view }: { view: ChangePageView }) {
  if (!view.blocked) return null;
  const footer = <PublicFooterLinks operatorEmail={view.shell.operatorEmail} showPrivacyPolicy={Boolean(view.shell.privacyUrl)} privacyUrl={view.shell.privacyUrl} />;
  return (
    <div data-change-page={view.kind}>
      <BookingCard side={<MeetingSummaryPanel summary={view.summary} footer={footer} />} ribbon={view.shell.ribbon}>
        <ChangeStatePanel copy={view.blocked} cancelHref={changePagePath("cancel", view.inviteeId)} scheduleAnotherHref={view.scheduleAnotherHref} />
      </BookingCard>
    </div>
  );
}
