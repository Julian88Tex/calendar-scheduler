// OWNER: calendar-integrations.
//
// Loading skeleton of the Calendar settings tab (the Availability header and tabs come from the section layout).
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex max-w-[880px] flex-col gap-6" aria-busy="true" aria-label="Loading calendar settings">
      <Card>
        <Skeleton width={200} height={22} />
        <Skeleton className="mt-2" width={160} height={14} />
        <div className="mt-6 flex items-center gap-4">
          <Skeleton width={40} height={40} rounded="md" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton width={120} height={16} />
            <Skeleton width={220} height={14} />
          </div>
        </div>
      </Card>
      <Card>
        <Skeleton width={160} height={22} />
        <Skeleton className="mt-4" lines={3} />
        <Skeleton className="mt-6" lines={2} />
      </Card>
    </div>
  );
}
