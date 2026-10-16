// Loading skeleton of the settings pages (SPEC GEN-12): the page title and gray cards shaped like the page that is
// loading, inside the settings sub-navigation (which stays visible). Server and client safe.
import { Skeleton } from "@/components/ui/skeleton";

export type SettingsSkeletonProps = {
  /** Cards to draw, each with its number of form rows. */
  cards?: number[];
};

export function SettingsSkeleton({ cards = [5] }: SettingsSkeletonProps) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="flex max-w-3xl min-w-0 flex-col gap-6">
      <span className="sr-only">Loading</span>
      <Skeleton width={200} height={32} />
      {cards.map((rows, i) => (
        <div key={i} className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-line bg-white p-6 sm:p-8">
          <Skeleton width={160} height={22} />
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} className="flex flex-col gap-2">
              <Skeleton width={120} height={14} />
              <Skeleton width={r % 2 ? "60%" : "80%"} height={40} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
