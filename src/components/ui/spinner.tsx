// OWNER: foundation-ui.
//
// Spinner (ARCHITECTURE 20.2) with an accessible label. Server and client safe.
import { cn } from "@/lib/cn";

export type SpinnerProps = {
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
  /** Inherit the current text color instead of the primary blue (inside buttons). */
  inheritColor?: boolean;
  /** Decorative spinner (no status role), for buttons that already set aria-busy. */
  decorative?: boolean;
};

const SIZES = { sm: "size-4 border-2", md: "size-6 border-2", lg: "size-10 border-[3px]" } as const;

export function Spinner({ size = "md", label = "Loading", className, inheritColor, decorative }: SpinnerProps) {
  const ring = (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block animate-spin rounded-full border-solid border-t-transparent",
        inheritColor ? "border-current" : "border-primary",
        SIZES[size],
      )}
    />
  );
  if (decorative) return <span className={cn("inline-flex items-center", className)}>{ring}</span>;
  return (
    <span role="status" className={cn("inline-flex items-center", className)}>
      {ring}
      <span className="sr-only">{label}</span>
    </span>
  );
}
