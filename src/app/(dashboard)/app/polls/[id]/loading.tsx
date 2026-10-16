// OWNER: polls-ui.
//
// Loading state of the results page (ARCHITECTURE 26 rule 7).
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading meeting poll">
      <Skeleton width={120} height={14} />
      <Skeleton width="40%" height={32} />
      <Skeleton width="60%" height={16} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={84} />
          ))}
        </div>
        <div className="flex flex-col gap-4">
          <Skeleton height={140} />
          <Skeleton height={180} />
        </div>
      </div>
    </div>
  );
}
