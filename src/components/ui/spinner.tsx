// OWNER: foundation-ui. Stub created by foundation; the owner replaces the implementation and must keep these signatures.
//
// Spinner (ARCHITECTURE 20.2) with an accessible label.
import { cn } from "@/lib/cn";

export type SpinnerProps = { size?: "sm" | "md" | "lg"; label?: string; className?: string };

const SIZES = { sm: "size-4", md: "size-6", lg: "size-10" } as const;

export function Spinner({ size = "md", label = "Loading", className }: SpinnerProps) {
  return (
    <span role="status" className={cn("inline-flex items-center", className)}>
      <span aria-hidden="true" className={cn("animate-spin rounded-full border-2 border-primary border-t-transparent", SIZES[size])} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
