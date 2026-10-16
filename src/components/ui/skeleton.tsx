// OWNER: foundation-ui.
//
// Skeleton (ARCHITECTURE 20.2, SPEC GEN-12): gray rounded placeholder bars for loading.tsx files and async panels
// (decorative: the surrounding region carries aria-busy and a label). Server and client safe.
import { cn } from "@/lib/cn";

export type SkeletonProps = {
  width?: number | string;
  height?: number | string;
  rounded?: "sm" | "md" | "full";
  /** Renders this many text lines instead of one block. */
  lines?: number;
  className?: string;
};

export function Skeleton({ width, height = 16, rounded = "md", lines, className }: SkeletonProps) {
  const radius = rounded === "full" ? "rounded-full" : rounded === "sm" ? "rounded-[3px]" : "rounded-[6px]";
  if (lines && lines > 1) {
    return (
      <div aria-hidden="true" className={cn("flex flex-col gap-2.5", className)}>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className={cn("animate-pulse bg-mist", radius)} style={{ height, width: i === lines - 1 ? "60%" : (width ?? "100%") }} />
        ))}
      </div>
    );
  }
  return <div aria-hidden="true" className={cn("animate-pulse bg-mist", radius, className)} style={{ width: width ?? "100%", height }} />;
}
