// OWNER: conferencing.
//
// Loading skeleton of the Google Meet integration page.
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-busy="true" aria-label="Loading integration">
      <Skeleton width={200} height={32} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-6">
          <Card>
            <div className="flex gap-4">
              <Skeleton width={56} height={56} rounded="md" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton width={160} height={20} />
                <Skeleton lines={2} />
              </div>
            </div>
          </Card>
          <Card>
            <Skeleton lines={3} />
          </Card>
        </div>
        <Card>
          <Skeleton lines={4} />
        </Card>
      </div>
    </div>
  );
}
