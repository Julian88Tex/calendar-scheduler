// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Skeleton (ARCHITECTURE 20.2): loading placeholders for loading.tsx files.
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
  const radius = rounded === "full" ? "rounded-full" : rounded === "sm" ? "rounded-sm" : "rounded";
  if (lines && lines > 1) {
    return (
      <div aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className={cn("animate-pulse bg-mist", radius)} style={{ height, width: i === lines - 1 ? "60%" : width }} />
        ))}
      </div>
    );
  }
  return <div aria-hidden="true" className={cn("animate-pulse bg-mist", radius, className)} style={{ width, height }} />;
}
