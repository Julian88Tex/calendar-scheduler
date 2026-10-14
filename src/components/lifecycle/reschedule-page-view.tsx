// Server rendering of /reschedulings/{inviteeId} and /reschedulings/{inviteeId}/{start} (SPEC CR-03, CR-08, BK-08):
// the public shell with the host's branding around the reschedule flow, or the state card of a refusal. Server
// component (receives the page's Server Action and hands it to the client flow).
import { PublicPageShell } from "@/components/public/public-page-shell";
import { ChangeStateCard } from "./change-state-card";
import { RescheduleFlow, type RescheduleInviteeAction } from "./reschedule-flow";
import type { ReschedulePageResult } from "./server/reschedule-page";

export function ReschedulePageView({ result, rescheduleAction }: { result: Extract<ReschedulePageResult, { state: "flow" | "blocked" }>; rescheduleAction: RescheduleInviteeAction }) {
  const v = result.view;
  return (
    <PublicPageShell branding={v.shell.branding} showFooterLinks={false} operatorEmail={v.shell.operatorEmail} privacyUrl={v.shell.privacyUrl}>
      {result.state === "flow" ? <RescheduleFlow {...result.flow} rescheduleAction={rescheduleAction} /> : <ChangeStateCard view={v} />}
    </PublicPageShell>
  );
}
