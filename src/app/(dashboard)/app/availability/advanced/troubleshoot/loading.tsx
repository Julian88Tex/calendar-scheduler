// Troubleshoot loading skeleton (SPEC GEN-12): the controls bar, the day summary and the start time rows in gray bars
// while the diagnostics (schedules, calendar busy times, meetings) load.
import { Skeleton } from "@/components/ui/skeleton";

export default function TroubleshootLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col gap-6">
      <span className="sr-only">Loading</span>
      <div className="flex flex-col gap-2">
        <Skeleton width={140} height={16} />
        <Skeleton width={280} height={28} />
        <Skeleton width="50%" height={14} />
      </div>
      <div className="flex flex-wrap gap-3 rounded-[var(--radius-card)] border border-line bg-white p-4">
        <Skeleton width={288} height={40} />
        <Skeleton width={260} height={40} />
      </div>
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-white p-4">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} width={i % 2 ? "60%" : "85%"} height={14} />
          ))}
        </div>
        <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-line bg-white p-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton width={92} height={36} />
              <Skeleton width={90} height={20} rounded="full" />
              <Skeleton width="45%" height={14} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
