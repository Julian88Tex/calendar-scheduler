// Loading state of the Event types tab (SPEC GEN-12): the toolbar, the personal section header and three cards in gray
// placeholder bars, shown under the Scheduling header and tabs while the list loads. Server and client safe.
import { Skeleton } from "@/components/ui/skeleton";

export function EventTypesSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading event types" className="flex flex-col gap-6">
      <span className="sr-only">Loading event types</span>
      <div className="flex items-center gap-3">
        <Skeleton width={320} height={40} className="max-w-full" />
        <Skeleton width={96} height={40} rounded="full" className="ml-auto" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton width={40} height={40} rounded="full" />
        <div className="flex flex-col gap-2">
          <Skeleton width={140} height={14} />
          <Skeleton width={200} height={12} />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
            <span aria-hidden="true" className="w-1.5 shrink-0 bg-mist" />
            <div className="flex min-w-0 flex-1 items-start gap-4 p-5">
              <Skeleton width={18} height={18} rounded="sm" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton width="35%" height={18} />
                <Skeleton width="50%" height={12} />
                <Skeleton width="30%" height={12} />
              </div>
              <Skeleton width={96} height={32} rounded="full" className="hidden sm:block" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
