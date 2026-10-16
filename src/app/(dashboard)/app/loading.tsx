// OWNER: foundation-ui.
//
// Dashboard loading skeleton (SPEC GEN-12): a page title bar, a tab row and list rows in gray rounded bars, inside the
// shell (the sidebar and header stay interactive).
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex flex-col gap-6 pt-2">
      <span className="sr-only">Loading</span>
      <div className="flex items-center justify-between gap-4">
        <Skeleton width={220} height={32} />
        <Skeleton width={110} height={40} rounded="full" />
      </div>
      <div className="flex gap-6 border-b border-line pb-3">
        <Skeleton width={90} height={16} />
        <Skeleton width={110} height={16} />
        <Skeleton width={100} height={16} />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-[var(--radius-card)] border border-line bg-white p-5">
            <Skeleton width={6} height={44} rounded="sm" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton width="40%" height={16} />
              <Skeleton width="25%" height={12} />
            </div>
            <Skeleton width={96} height={32} rounded="full" />
          </div>
        ))}
      </div>
    </div>
  );
}
