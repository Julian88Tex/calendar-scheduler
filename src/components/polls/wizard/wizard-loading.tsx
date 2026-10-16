// The poll wizard's full-screen loading surface (route loading states and the wizard's first client render). Server
// and client safe.
import { Spinner } from "@/components/ui/spinner";
import { pt } from "../lib/t";

export function WizardLoading() {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-canvas" aria-busy="true">
      <Spinner size="lg" label={pt("common.loading")} />
    </div>
  );
}
