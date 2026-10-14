// Loading skeleton of the Meetings page (SPEC GEN-12): the counter, the tab card with a date header and rows in gray
// bars, the same shape as the loaded list. Server and client safe.
import { Skeleton } from "@/components/ui/skeleton";

export function MeetingsSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading meetings" className="flex flex-col gap-3">
      <span className="sr-only">Loading meetings</span>
      <div className="flex justify-end">
        <Skeleton width={220} height={14} />
      </div>
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
        <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <div className="flex gap-6">
            <Skeleton width={80} height={16} />
            <Skeleton width={50} height={16} />
            <Skeleton width={90} height={16} />
          </div>
          <div className="hidden gap-2 sm:flex">
            <Skeleton width={90} height={32} rounded="full" />
            <Skeleton width={90} height={32} rounded="full" />
          </div>
        </div>
        <div className="border-b border-line bg-canvas px-6 py-3">
          <Skeleton width={240} height={16} />
        </div>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-line px-6 py-5 last:border-b-0">
            <Skeleton width={16} height={16} rounded="full" />
            <Skeleton width={130} height={14} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton width="35%" height={16} />
              <Skeleton width="25%" height={12} />
            </div>
            <Skeleton width={72} height={28} rounded="full" />
          </div>
        ))}
      </div>
    </div>
  );
}
