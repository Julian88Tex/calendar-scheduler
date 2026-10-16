// OWNER: polls-ui.
//
// Loading state of the edit wizard (ARCHITECTURE 26 rule 7): the same full-screen surface the wizard opens on, so the
// results page skeleton of the parent segment never flashes in between.
import { WizardLoading } from "@/components/polls/wizard/wizard-loading";

export default function Loading() {
  return <WizardLoading />;
}
