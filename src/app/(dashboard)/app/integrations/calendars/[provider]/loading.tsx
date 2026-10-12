// OWNER: calendar-integrations.
//
// Loading skeleton of a calendar integration page.
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading integration">
      <Skeleton width={220} height={32} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <div className="flex gap-4">
            <Skeleton width={56} height={56} rounded="md" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton width={180} height={20} />
              <Skeleton lines={2} />
            </div>
          </div>
        </Card>
        <Card>
          <Skeleton lines={3} />
        </Card>
      </div>
    </div>
  );
}
