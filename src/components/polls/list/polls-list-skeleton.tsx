// Loading state of the Meeting polls tab (ARCHITECTURE 26 rule 7). Server and client safe.
import { Skeleton } from "@/components/ui/skeleton";

export function PollsListSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading meeting polls">
      <div className="flex flex-wrap gap-2">
        {[64, 80, 72, 48].map((w) => (
          <Skeleton key={w} width={w} height={36} rounded="full" />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
          <span className="w-1.5 bg-mist" />
          <div className="flex flex-1 flex-col gap-2 p-5">
            <Skeleton width="40%" height={20} />
            <Skeleton width="30%" height={14} />
            <Skeleton width="50%" height={14} />
          </div>
        </div>
      ))}
    </div>
  );
}
