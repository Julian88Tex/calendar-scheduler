// Advanced settings loading skeleton (SPEC GEN-12): the meeting limits card and the troubleshoot card in gray bars,
// under the Availability header and tabs.
import { Skeleton } from "@/components/ui/skeleton";

export default function AdvancedSettingsLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex max-w-4xl flex-col gap-6">
      <span className="sr-only">Loading</span>
      <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-white p-6">
        <Skeleton width={180} height={22} />
        <Skeleton width="70%" height={14} />
        <Skeleton width={260} height={40} />
        <Skeleton width={160} height={16} />
      </div>
      <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-white p-6">
        <Skeleton width={220} height={22} />
        <Skeleton width="60%" height={14} />
      </div>
    </div>
  );
}
