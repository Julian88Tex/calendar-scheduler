// OWNER: golden-path-qa.
//
// Loading skeleton of /app/settings/email-outbox (SPEC GEN-12): the title, the filters and table rows.
import { Skeleton } from "@/components/ui/skeleton";

export default function EmailOutboxLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex min-w-0 flex-col gap-6">
      <span className="sr-only">Loading</span>
      <Skeleton width={200} height={32} />
      <Skeleton width="60%" height={16} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Skeleton width={240} height={40} />
        <Skeleton width={320} height={40} />
      </div>
      <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-white p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton width={72} height={22} />
            <Skeleton width={i % 2 ? "40%" : "55%"} height={16} />
            <Skeleton width={120} height={16} />
          </div>
        ))}
      </div>
    </div>
  );
}
